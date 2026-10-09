"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";
import { FullscreenTasbih } from "@/components/FullscreenTasbih";
import { TodoDialog } from "@/components/TodoDialog";
import { SectionHeader } from "@/components/SectionHeader";
import { getTransientCounts, setTransientCounts } from "@/lib/transientCounters";
import { readLocalReaderPrefs, scopedBoolean, writeLocalReaderPrefs } from "@/lib/readerPrefs";
import { getCachedContentByDocument } from "@/lib/localContentDb";
import { offlineGetRows, offlineHasPending, offlinePutRows, offlineUpdate, offlineUpsert } from "@/lib/offlineDb";
import { getOfflineOwnerId } from "@/lib/offlineIdentity";

type Item = {
  id: string;
  title: string;
  subtitle?: string | null;
  metadata?: Record<string, unknown> | null;
};

type Node = {
  id: string;
  kind: string;
  title: string | null;
  text_content: string | null;
  secondary_text: string | null;
  translation: string | null;
  metadata: Record<string, unknown> | null;
  sort_order: number;
};

type MemoryState = {
  content_node_id: string;
  repeat_count: number;
  repeat_target: number;
  playback_rate: number;
  is_memorized: boolean;
};

type Todo = {
  id: string;
  notes: string | null;
  related_content_node_id: string | null;
  related_library_item_id: string | null;
};

type TodoMeta = {
  description?: string;
  schedule?: {
    mode?: "single" | "range" | "days" | "forever";
    startDate?: string;
    endDate?: string | null;
    durationDays?: number | null;
    target?: number;
    history?: Record<string, { count?: number; completedAt?: string | null }>;
  };
};

type TodoInfo = { todo: Todo; meta: TodoMeta; target: number; count: number; done: boolean };

function parseMeta(notes: string | null): TodoMeta {
  try { return JSON.parse(notes || "{}") as TodoMeta; } catch { return {}; }
}

function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function occurs(meta: TodoMeta, key: string) {
  const s = meta.schedule;
  if (!s?.startDate) return true;
  if (key < s.startDate) return false;
  if (s.mode === "single") return key === s.startDate;
  if (s.mode === "range") return !s.endDate || key <= s.endDate;
  if (s.mode === "days") {
    const start = new Date(s.startDate + "T00:00:00");
    const current = new Date(key + "T00:00:00");
    const diff = Math.floor((current.getTime() - start.getTime()) / 86400000);
    return diff >= 0 && diff < Math.max(1, s.durationDays || 1);
  }
  return true;
}

export function MemorizationView({
  item,
  onBack,
  onMenu,
  categoryTitle = "",
  initialIndex = 0,
}: {
  item: Item | null;
  onBack?: () => void;
  onMenu?: () => void;
  categoryTitle?: string;
  initialIndex?: number;
}) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [states, setStates] = useState<Record<string, MemoryState>>({});
  const [todos, setTodos] = useState<Todo[]>([]);
  const [active, setActive] = useState(initialIndex);
  const [segmentListOpen,setSegmentListOpen] = useState(true);
  const [visibleLanguages,setVisibleLanguages] = useState({arabic:true,latin:true,translation:true});
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [counterArmed, setCounterArmed] = useState(true);
  const [counterPos, setCounterPos] = useState<{x:number;y:number}|null>(null);
  const [resetMenu, setResetMenu] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const [editTodo, setEditTodo] = useState<TodoInfo | null>(null);
  const [editMenu, setEditMenu] = useState<{todo: TodoInfo; x:number; y:number}|null>(null);
  const [message, setMessage] = useState("");
  const [showPlayControl,setShowPlayControl] = useState<boolean | null>(() => {
    const local=readLocalReaderPrefs();
    return Object.keys(local).length ? scopedBoolean(local,"ezber","ShowPlay",true) : null;
  });
  const [resolvedMeta, setResolvedMeta] = useState<Record<string, any>>((item?.metadata ?? {}) as Record<string, any>);
  const [resolvedCategoryTitle, setResolvedCategoryTitle] = useState(categoryTitle);

  const counterDragging = useRef(false);
  const counterStart = useRef({x:0,y:0});
  const counterOrigin = useRef({x:0,y:0});
  const counterPressed = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetLongPress = useRef(false);
  const resetRef = useRef<HTMLButtonElement | null>(null);
  const counterRef = useRef<HTMLButtonElement | null>(null);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = localDateKey();

  const itemMeta = resolvedMeta;
  const isEsmaDetail = itemMeta.category_key === "asma" || String(itemMeta.legacy_id || "").startsWith("esma-");
  const invocation = String(itemMeta.invocation || item?.subtitle || "");

  useEffect(() => {
    setResolvedMeta((item?.metadata ?? {}) as Record<string, any>);
    setResolvedCategoryTitle(categoryTitle || "");
    if (!item?.id) return;

    let cancelled = false;
    (async () => {
      const { data: freshItem } = await supabase
        .from("library_items")
        .select("parent_id,metadata")
        .eq("id", item.id)
        .maybeSingle();

      if (cancelled || !freshItem) return;
      const freshMeta = (freshItem.metadata ?? {}) as Record<string, any>;
      setResolvedMeta(freshMeta);

      const esma = freshMeta.category_key === "asma" || String(freshMeta.legacy_id || "").startsWith("esma-");
      if (!esma || !freshItem.parent_id) return;

      const { data: parent } = await supabase
        .from("library_items")
        .select("title")
        .eq("id", freshItem.parent_id)
        .maybeSingle();

      if (!cancelled && parent?.title) setResolvedCategoryTitle(parent.title);
    })();

    return () => { cancelled = true; };
  }, [item?.id, categoryTitle]);

  const loadTodos = useCallback(async () => {
    if (!item) return;
    const ownerId=await getOfflineOwnerId();
    if(!ownerId) return;

    const local=await offlineGetRows<Todo>("todos",ownerId,row=>row.related_library_item_id===item.id);
    if(local.length) setTodos(local);
    if(!navigator.onLine){
      if(!local.length) setTodos([]);
      return;
    }

    const { data, error } = await supabase
      .from("todos")
      .select("id,owner_id,title,notes,is_completed,due_at,sort_order,related_content_node_id,related_library_item_id,created_at,updated_at")
      .eq("related_library_item_id", item.id);
    if (error) {
      if(!local.length) setMessage(error.message);
      return;
    }
    const rows=(data ?? []) as any[];
    if(rows.length) await offlinePutRows("todos",rows);
    setTodos(rows);
  }, [item]);

  const load = useCallback(async () => {
    if (!item) {
      setNodes([]);
      return;
    }

    const ownerId=await getOfflineOwnerId();
    const cachedNodes=await getCachedContentByDocument(item.id).catch(()=>[]);
    if(cachedNodes.length){
      const loaded=cachedNodes as Node[];
      setNodes(loaded);
      setActive(Math.min(initialIndex,Math.max(0,loaded.length-1)));

      if(ownerId){
        const memoryRows=await offlineGetRows<MemoryState & {owner_id?:string}>(
          "memorization_state",
          ownerId,
          row=>loaded.some(node=>node.id===row.content_node_id)
        );
        const map:Record<string,MemoryState>={};
        memoryRows.forEach(row=>{map[row.content_node_id]=row;});
        setStates(map);
      }
      await loadTodos();
    }

    if(!navigator.onLine) {
      if(!cachedNodes.length) setMessage("Offline: Bu içerik bu cihazda henüz senkronize edilmemiş.");
      return;
    }

    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
      .eq("document_id", item.id)
      .order("sort_order");

    if (error) {
      if(!cachedNodes.length) setMessage(error.message);
      return;
    }

    const loaded = data ?? [];
    setNodes(loaded);
    setActive(Math.min(initialIndex, Math.max(0, loaded.length - 1)));

    const ids = loaded.map(node => node.id);
    if (ids.length && ownerId) {
      const { data: memoryData } = await supabase
        .from("memorization_state")
        .select("id,owner_id,content_node_id,repeat_count,repeat_target,playback_rate,is_memorized,last_practiced_at,updated_at")
        .in("content_node_id", ids);
      const rows=(memoryData ?? []) as any[];
      if(rows.length) await offlinePutRows("memorization_state",rows);
      const map: Record<string, MemoryState> = {};
      rows.forEach(row => { map[row.content_node_id] = row; });
      setStates(map);
    } else if(!ids.length) {
      setStates({});
    }
    await loadTodos();
  }, [item, initialIndex, loadTodos]);

  useEffect(() => {
    let cancelled=false;

    const apply=(prefs:Record<string,unknown>)=>{
      if(cancelled) return;
      setShowPlayControl(scopedBoolean(prefs,"ezber","ShowPlay",true));
    };

    let local=readLocalReaderPrefs();

    void (async()=>{
      if(!Object.keys(local).length){
        const ownerId=await getOfflineOwnerId();
        if(ownerId){
          const cached=await offlineGetRows<any>("user_preferences",ownerId);
          const prefs=cached[0]?.preferences;
          if(prefs && typeof prefs==="object"){
            local={...(prefs as Record<string,unknown>)};
            writeLocalReaderPrefs(local);
          }
        }
      }

      if(Object.keys(local).length) apply(local);

      if(navigator.onLine){
        try{
          const {data}=await supabase.from("user_preferences").select("preferences").maybeSingle();
          const remote=(data?.preferences ?? {}) as Record<string,unknown>;
          const current=readLocalReaderPrefs();
          const pending=await offlineHasPending("user_preferences");
          const merged=pending ? {...remote,...current} : remote;
          writeLocalReaderPrefs(merged);
          apply(merged);
        }catch{
          if(!Object.keys(local).length && !cancelled) setShowPlayControl(false);
        }
      }else if(!Object.keys(local).length){
        setShowPlayControl(false);
      }
    })();

    const onPrefs=(event:Event)=>{
      const detail=(event as CustomEvent<Record<string,unknown>>).detail;
      if(!detail || detail.scope!=="ezber") return;
      if(typeof detail.showPlay==="boolean") setShowPlayControl(detail.showPlay);
    };
    window.addEventListener("lumen-library-prefs",onPrefs);
    return()=>{
      cancelled=true;
      window.removeEventListener("lumen-library-prefs",onPrefs);
    };
  }, []);

  useEffect(() => {
    try {
      const stored=localStorage.getItem("lumen-memorize-visible-languages");
      if(stored){
        const saved=JSON.parse(stored);
        setVisibleLanguages({
          arabic:saved.arabic!==false,
          latin:saved.latin!==false,
          translation:saved.translation!==false,
        });
      }
    } catch {}
  }, []);

  function toggleLanguage(language:"arabic"|"latin"|"translation"){
    setVisibleLanguages(old=>{
      const updated={...old,[language]:!old[language]};
      localStorage.setItem("lumen-memorize-visible-languages",JSON.stringify(updated));
      return updated;
    });
  }

  useEffect(() => {
    const saved = localStorage.getItem("lumen-counter-pos");
    if (saved) { try { setCounterPos(JSON.parse(saved)); } catch {} }
    load();
  }, [load]);

  useEffect(() => {
    setSelectedTodoId(null);
    setCounterArmed(true);
    setResetMenu(false);
    setEditMenu(null);
  }, [active]);

  useEffect(() => {
    if (!resetMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target && resetRef.current?.contains(target)) return;
      if (target && counterRef.current?.contains(target)) return;
      setResetMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [resetMenu]);

  const node = nodes[active];

  const configuredTarget = useMemo(() => {
    if (!node) return 0;
    const raw = node.metadata?.target ?? item?.metadata?.target;
    const number = Number(raw ?? 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }, [node, item]);

  const memory = node
    ? states[node.id] ?? {
        content_node_id: node.id,
        repeat_count: 0,
        repeat_target: configuredTarget,
        playback_rate: 1,
        is_memorized: false,
      }
    : null;

  const todoInfos = useMemo<TodoInfo[]>(() => {
    if (!node) return [];
    return todos
      .filter(todo => todo.related_content_node_id === node.id)
      .map(todo => {
        const meta = parseMeta(todo.notes);
        if (!occurs(meta, today)) return null;
        const target = Math.max(1, Number(meta.schedule?.target || 1));
        const count = Math.min(target, Number(meta.schedule?.history?.[today]?.count || 0));
        return { todo, meta, target, count, done: count >= target };
      })
      .filter((x): x is TodoInfo => x !== null);
  }, [todos, node, today]);

  useEffect(() => {
    const activeTodos = todoInfos.filter(info => !info.done);
    if (activeTodos.length) {
      if (!selectedTodoId || !activeTodos.some(info => info.todo.id === selectedTodoId)) {
        setSelectedTodoId(activeTodos[0].todo.id);
      }
      setCounterArmed(true);
      return;
    }
    setSelectedTodoId(null);
    setCounterArmed(configuredTarget > 0);
  }, [active, todos, configuredTarget]);

  const selectedTodo = selectedTodoId
    ? todoInfos.find(info => info.todo.id === selectedTodoId && !info.done) ?? null
    : null;

  const transient = item && node ? (getTransientCounts(item.id)[node.id] ?? 0) : 0;
  const effectiveTarget = selectedTodo ? selectedTodo.target : configuredTarget;
  const effectiveCount = selectedTodo
    ? selectedTodo.count
    : configuredTarget > 0
      ? transient
      : (memory?.repeat_count ?? 0);

  async function updateTodoCount(info: TodoInfo, nextCount: number) {
    const history = { ...(info.meta.schedule?.history || {}) };
    const count = Math.min(info.target, Math.max(0, nextCount));
    history[today] = { count, completedAt: count >= info.target ? new Date().toISOString() : null };
    const nextMeta = { ...info.meta, schedule: { ...info.meta.schedule, history } };
    setTodos(current => current.map(todo => todo.id === info.todo.id ? { ...todo, notes: JSON.stringify(nextMeta) } : todo));
    const ownerId=await getOfflineOwnerId();
    if(!ownerId) return;
    const result=await offlineUpdate("todos",ownerId,{id:info.todo.id},{
      notes:JSON.stringify(nextMeta),
      updated_at:new Date().toISOString(),
    });
    if(result.error && navigator.onLine) setMessage(result.error.message);
  }

  async function updateMemory(nextCount: number) {
    if (!node || !memory) return;
    const next: MemoryState = {
      ...memory,
      repeat_count: nextCount,
      repeat_target: configuredTarget || memory.repeat_target || 1,
      is_memorized: configuredTarget > 0 && nextCount >= configuredTarget,
    };
    setStates(current => ({ ...current, [node.id]: next }));
    if (configuredTarget > 0 && item) {
      const all = { ...getTransientCounts(item.id), [node.id]: nextCount };
      setTransientCounts(item.id, all);
      return;
    }
    const ownerId=await getOfflineOwnerId();
    if(!ownerId) return;
    const now=new Date().toISOString();
    const result=await offlineUpsert("memorization_state",ownerId,{
      ...((memory as any)?.id ? {id:(memory as any).id} : {}),
      owner_id:ownerId,
      content_node_id:node.id,
      repeat_count:next.repeat_count,
      repeat_target:next.repeat_target,
      playback_rate:next.playback_rate,
      is_memorized:next.is_memorized,
      last_practiced_at:now,
      updated_at:now,
    },{onConflict:"owner_id,content_node_id"});
    if(result.error && navigator.onLine) setMessage(result.error.message);
  }

  async function increment() {
    if (effectiveTarget > 0 && !counterArmed) return;
    if (selectedTodo) return updateTodoCount(selectedTodo, selectedTodo.count + 1);
    const next = effectiveTarget > 0 ? Math.min(effectiveTarget, effectiveCount + 1) : effectiveCount + 1;
    await updateMemory(next);
  }

  async function decrement() {
    if (selectedTodo) return updateTodoCount(selectedTodo, selectedTodo.count - 1);
    await updateMemory(Math.max(0, effectiveCount - 1));
  }

  async function resetCounter() {
    if (selectedTodo) await updateTodoCount(selectedTodo, 0);
    else await updateMemory(0);
    setResetMenu(false);
  }

  function clampCounter(next: {x:number;y:number}) {
    const size = 78;
    return {
      x: Math.min(Math.max(8, next.x), window.innerWidth - size - 8),
      y: Math.min(Math.max(8, next.y), window.innerHeight - size - 8),
    };
  }

  function counterDown(e: React.PointerEvent<HTMLButtonElement>) {
    counterPressed.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    counterDragging.current = false;
    resetLongPress.current = false;
    counterStart.current = {x:e.clientX,y:e.clientY};
    const rect = e.currentTarget.getBoundingClientRect();
    counterOrigin.current = {x:rect.left,y:rect.top};
    resetTimer.current = setTimeout(() => {
      if (!counterDragging.current) {
        resetLongPress.current = true;
        setResetMenu(true);
      }
    }, 650);
  }

  function counterMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!counterPressed.current) return;
    const dx = e.clientX - counterStart.current.x;
    const dy = e.clientY - counterStart.current.y;
    if (Math.hypot(dx,dy) < 6) return;
    counterDragging.current = true;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setCounterPos(clampCounter({x:counterOrigin.current.x+dx,y:counterOrigin.current.y+dy}));
  }

  function counterUp(e: React.PointerEvent<HTMLButtonElement>) {
    counterPressed.current = false;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (counterDragging.current) {
      if (counterPos) localStorage.setItem("lumen-counter-pos", JSON.stringify(counterPos));
      return;
    }
    if (!resetLongPress.current) void increment();
  }

  function startEdit(info: TodoInfo, e: React.PointerEvent<HTMLButtonElement>) {
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => setEditMenu({ todo: info, x: e.clientX, y: e.clientY }), 650);
  }

  function stopEdit() {
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = null;
  }

  if (!item) return <section className="legacyEmpty"><h2>Ezber</h2></section>;

  return (
    <div
      className="legacyApp"
      onPointerDown={e => {
        if (e.target === e.currentTarget) {
          setSelectedTodoId(null);
          setCounterArmed(false);
          setEditMenu(null);
        }
      }}
    >
      <SectionHeader
        title={isEsmaDetail ? (resolvedCategoryTitle || categoryTitle || item.title) : item.title}
        invocation={!isEsmaDetail ? invocation || null : null}
        progress={nodes.length ? active + 1 + " / " + nodes.length : "0 / 0"}
        showTodo={true}
        showMemorize={true}
        memorizeActive={true}
        onMenu={onMenu}
        onBack={onBack}
        onTodo={() => setTodoOpen(true)}
        showFullscreen={true}
        onFullscreen={() => window.dispatchEvent(new Event("lumen-open-fullscreen-tasbih"))}
        onSettings={() => window.dispatchEvent(new Event("lumen-open-library-settings"))}
      />

      <div className="memorizeSegmentControls" style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",padding:"12px 16px"}}>
        <button type="button" className="v2HeaderButton" onClick={()=>setSegmentListOpen(value=>!value)}>
          {segmentListOpen ? "Cümle listesini gizle" : "☷ Numaralı cümleler"}
        </button>
        <button type="button" className="v2HeaderButton" aria-pressed={visibleLanguages.arabic} onClick={()=>toggleLanguage("arabic")}>Arapça {visibleLanguages.arabic ? "✓" : "○"}</button>
        <button type="button" className="v2HeaderButton" aria-pressed={visibleLanguages.latin} onClick={()=>toggleLanguage("latin")}>Latin {visibleLanguages.latin ? "✓" : "○"}</button>
        <button type="button" className="v2HeaderButton" aria-pressed={visibleLanguages.translation} onClick={()=>toggleLanguage("translation")}>Meal {visibleLanguages.translation ? "✓" : "○"}</button>
      </div>
      {segmentListOpen && nodes.length>0 && (
        <div className="memorizeSegmentIndex" style={{padding:"0 16px 12px",display:"grid",gap:6,maxHeight:260,overflowY:"auto"}}>
          {nodes.map((part,index)=>(
            <button
              type="button"
              key={part.id}
              className={"legacyCategoryRow " + (active===index ? "active" : "")}
              aria-current={active===index ? "step" : undefined}
              onClick={()=>{setActive(index);setSegmentListOpen(false);}}
              style={{display:"flex",textAlign:"left",alignItems:"center",gap:12,width:"100%",padding:"9px 12px"}}
            >
              <strong style={{minWidth:32}}>{index+1}.</strong>
              <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(visibleLanguages.latin && part.text_content) || (visibleLanguages.arabic && part.secondary_text) || (visibleLanguages.translation && part.translation) || part.title || "Cümle "+(index+1)}</span>
              <span>›</span>
            </button>
          ))}
        </div>
      )}
      <main
        className={"legacyMemorize " + (isEsmaDetail ? "v2EsmaDetail" : "")}
        onPointerDown={e => {
          if (e.target === e.currentTarget) {
            setSelectedTodoId(null);
            setEditMenu(null);
          }
        }}
      >
        {isEsmaDetail && (
          <div className="v2EsmaIdentity">
            <div className="v2EsmaName">{item.title}</div>
            {invocation && <div className="v2EsmaInvocation">{invocation}</div>}
          </div>
        )}

        {node ? (
          <>
            {typeof node.metadata?.note === "string" && node.metadata.note && <div className="legacyNote">{node.metadata.note}</div>}
            {visibleLanguages.arabic && node.secondary_text && <div className="legacyArabic" dir="rtl">{node.secondary_text}</div>}
            {visibleLanguages.latin && node.text_content && <div className={node.metadata?.instruction ? "legacyInstruction" : "legacySegment"}>{node.text_content}</div>}
            {visibleLanguages.translation && node.translation && <div className="legacyTurkish">{node.translation}</div>}

            <div className="memorizeTodoTargets">
              {todoInfos.filter(x => !x.done).map(info => (
                <button
                  key={info.todo.id}
                  className={"segmentTargetButton memorizeTodoTarget " + (selectedTodoId === info.todo.id ? " active" : "")}
                  onPointerDown={e => startEdit(info, e)}
                  onPointerUp={stopEdit}
                  onPointerCancel={stopEdit}
                  onContextMenu={e => e.preventDefault()}
                  onClick={e => {
                    e.stopPropagation();
                    setSelectedTodoId(info.todo.id);
                    setCounterArmed(true);
                  }}
                >
                  {info.target}/{info.count}
                </button>
              ))}
              {!todoInfos.filter(x => !x.done).length && configuredTarget > 0 && (
                <button
                  className={"segmentTargetButton memorizeTodoTarget " + (effectiveCount >= configuredTarget ? "done " : "") + (counterArmed ? "active" : "")}
                  onClick={e => {
                    e.stopPropagation();
                    setSelectedTodoId(null);
                    setCounterArmed(true);
                  }}
                >
                  {configuredTarget}/{effectiveCount}
                </button>
              )}
            </div>
          </>
        ) : <p className="muted">Bu eserde henüz bölüm yok.</p>}
      </main>

      <nav className="legacyNavigation">
        <button disabled={active === 0} onClick={() => setActive(value => Math.max(0, value - 1))}>‹ Önceki</button>
        <button disabled={!nodes.length || active >= nodes.length - 1} onClick={() => setActive(value => Math.min(nodes.length - 1, value + 1))}>Sonraki ›</button>
      </nav>

      {node && resetMenu && (
        <button ref={resetRef} className="counterResetPopover" onClick={() => void resetCounter()}>Sıfırla</button>
      )}

      {node && (
        <button
          ref={counterRef}
          className="legacyCounter"
          style={counterPos ? {left:counterPos.x,top:counterPos.y,right:"auto",bottom:"auto"} : undefined}
          onPointerDown={counterDown}
          onPointerMove={counterMove}
          onPointerUp={counterUp}
          title="Dokun: say • Basılı tut: sıfırla • Sürükle: taşı"
        >
          <span>{effectiveCount}</span>
          <small>{effectiveTarget > 0 ? "/ " + effectiveTarget : "tekrar"}</small>
        </button>
      )}

      {node && (
        <FullscreenTasbih
          title={item.subtitle || node.text_content || node.title || item.title}
          count={effectiveCount}
          target={effectiveTarget}
          onIncrement={() => void increment()}
          onDecrement={() => void decrement()}
        />
      )}

      {showPlayControl === true && <FloatingPlaybackButton />}

      {node && (
        <TodoDialog
          open={todoOpen}
          onClose={() => setTodoOpen(false)}
          onSaved={loadTodos}
          title={node.text_content || node.title || item.title}
          defaultTarget={configuredTarget || 1}
          libraryItemId={item.id}
          contentNodeId={node.id}
        />
      )}

      {editMenu && (
        <button
          className="counterResetPopover todoEditPopover"
          style={{left:Math.max(8,editMenu.x-42),top:Math.max(8,editMenu.y-58),right:"auto",bottom:"auto"}}
          onClick={() => { setEditTodo(editMenu.todo); setEditMenu(null); }}
        >
          Düzenle
        </button>
      )}

      {editTodo && node && (
        <TodoDialog
          open={true}
          onClose={() => setEditTodo(null)}
          onSaved={async () => { await loadTodos(); setEditTodo(null); }}
          title={node.text_content || node.title || item.title}
          defaultTarget={editTodo.target}
          libraryItemId={item.id}
          contentNodeId={node.id}
          editTodo={{id:editTodo.todo.id,notes:editTodo.todo.notes}}
        />
      )}

      {message && <div className="legacyMessage">{message}</div>}
    </div>
  );
}
