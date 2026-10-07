"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";
import { FloatingCounterButton } from "@/components/FloatingCounterButton";
import { FullscreenTasbih } from "@/components/FullscreenTasbih";
import { TodoDialog } from "@/components/TodoDialog";
import { EzberSharedHeader } from "@/components/EzberSharedHeader";
import { clearTransientCounts, getTransientCounts, setTransientCounts } from "@/lib/transientCounters";

type Item = {
  id: string;
  kind: string;
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

type Todo = {
  id: string;
  notes: string | null;
  related_content_node_id: string | null;
  related_library_item_id: string | null;
};

type TodoInfo = { todo: Todo; meta: TodoMeta; target: number; count: number; done: boolean };

type TodoMeta = {
  schedule?: {
    mode?: "single" | "range" | "days" | "forever";
    startDate?: string;
    endDate?: string | null;
    durationDays?: number | null;
    target?: number;
    history?: Record<string, { count?: number; completedAt?: string | null }>;
  };
};

function parseMeta(notes: string | null): TodoMeta {
  if (!notes) return {};
  try { return JSON.parse(notes) as TodoMeta; } catch { return {}; }
}

function localDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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


export function ReaderView({
  item,
  onBack,
  onMenu,
  onMemorize,
  categoryTitle = "",
  initialFocusIndex = 0,
  onPreviousItem,
  onNextItem,
  hasPreviousItem,
  hasNextItem,
}: {
  item: Item;
  onBack?: () => void;
  onMenu?: () => void;
  onMemorize?: (index?: number) => void;
  categoryTitle?: string;
  initialFocusIndex?: number;
  onPreviousItem?: () => void;
  onNextItem?: () => void;
  hasPreviousItem?: boolean;
  hasNextItem?: boolean;
}) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [localCounts, setLocalCounts] = useState<Record<string, number>>({});
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [todoTarget, setTodoTarget] = useState<{title:string;nodeId?:string;defaultTarget:number}|null>(null);
  const [activeTodoId, setActiveTodoId] = useState<string | null>(null);
  const [documentTodoOpen, setDocumentTodoOpen] = useState(false);
  const [activeDocumentTodoId, setActiveDocumentTodoId] = useState<string | null>(null);
  const [counterArmed, setCounterArmed] = useState(true);
  const [editTodo, setEditTodo] = useState<TodoInfo | null>(null);
  const [editMenu, setEditMenu] = useState<{ todo: TodoInfo; x: number; y: number } | null>(null);
  const editPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRestored = useRef(false);

  const today = localDateKey();

  const itemTarget = Number(item.metadata?.target || 0);
  const itemMeta = (item.metadata ?? {}) as Record<string, any>;
  const sourceType = String(itemMeta.source || "");
  const quranSurahNo = Number(itemMeta.surah_no || 0);
  const isQuranDocument = sourceType === "quran_api" && quranSurahNo >= 1 && quranSurahNo <= 114;
  const isRisaleExternal = sourceType === "risale_external";
  const isEsmaDetail = itemMeta.category_key === "asma" || String(itemMeta.legacy_id || "").startsWith("esma-");
  const invocation = String(itemMeta.invocation || item.subtitle || "");

  const targetForIntrinsic = useCallback((node: Node) => {
    const own = Number(node.metadata?.target || 0);
    return own > 0 ? own : (nodes.length === 1 && itemTarget > 0 ? itemTarget : 0);
  }, [itemTarget, nodes.length]);

  const loadTodos = useCallback(async () => {
    const { data, error } = await supabase
      .from("todos")
      .select("id,notes,related_content_node_id,related_library_item_id")
      .eq("related_library_item_id", item.id);

    if (error) {
      setMessage(error.message);
      return;
    }
    setTodos(data ?? []);
  }, [item.id]);

  const load = useCallback(async () => {
    let { data, error } = await supabase
      .from("content_nodes")
      .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
      .eq("document_id", item.id)
      .order("sort_order");

    if (error) {
      setMessage(error.message);
      return;
    }

    let loaded = data ?? [];

    if (!loaded.length && isQuranDocument) {
      try {
        setMessage("Sûre metni hazırlanıyor…");
        const response = await fetch(`/api/library/quran/surah?number=${quranSurahNo}`);
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Sûre metni alınamadı.");

        const rows = (json.ayahs || []).map((ayah: any) => ({
          document_id: item.id,
          kind: "verse",
          title: `${quranSurahNo}:${Number(ayah.numberInSurah)}`,
          text_content: null,
          secondary_text: String(ayah.text || ""),
          translation: String(ayah.translation || ""),
          sort_order: Number(ayah.numberInSurah || 0),
          metadata: {
            source: "alquran.cloud",
            arabic_edition: "quran-uthmani",
            translation_edition: "tr.diyanet",
            surah_no: quranSurahNo,
            ayah_no: Number(ayah.numberInSurah || 0),
            global_ayah_no: Number(ayah.number || 0),
            juz: Number(ayah.juz || 0),
            page: Number(ayah.page || 0),
            hizb_quarter: Number(ayah.hizbQuarter || 0),
            sajda: Boolean(ayah.sajda),
          },
        }));

        if (rows.length) {
          const { error: insertError } = await supabase.from("content_nodes").insert(rows);
          if (insertError) {
            const { data: existingAfterRace } = await supabase
              .from("content_nodes")
              .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
              .eq("document_id", item.id)
              .order("sort_order");
            if (!existingAfterRace?.length) throw insertError;
            loaded = existingAfterRace;
          } else {
            const { data: hydrated, error: hydrateError } = await supabase
              .from("content_nodes")
              .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
              .eq("document_id", item.id)
              .order("sort_order");
            if (hydrateError) throw hydrateError;
            loaded = hydrated ?? [];
          }
        }
        setMessage("");
      } catch (hydrateError) {
        setMessage(hydrateError instanceof Error ? hydrateError.message : "Sûre metni alınamadı.");
      }
    }

    if (!loaded.length && isRisaleExternal) {
      try {
        setMessage("Risale metni resmî kaynaktan hazırlanıyor…");
        const params = new URLSearchParams({
          title:item.title,
          book:String(itemMeta.book_title || ""),
          chapter:String(itemMeta.chapter_no || 0),
        });
        const response = await fetch(`/api/library/risale/content?${params.toString()}`);
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Risale metni alınamadı.");

        const rows = (json.blocks || []).map((block:any,index:number) => ({
          document_id:item.id,
          kind:block.kind === "heading" ? "heading" : "paragraph",
          title:block.kind === "heading" ? String(block.title || block.text || "") : null,
          text_content:block.kind === "heading" ? null : String(block.text || ""),
          secondary_text:null,
          translation:null,
          sort_order:index + 1,
          metadata:{
            source:"risaleinur.hizmetvakfi.org",
            official_source:String(json.sourceName || "Hizmet Vakfı Risale-i Nur Külliyatı"),
            source_url:String(json.sourceUrl || itemMeta.source_url || ""),
            block_kind:String(block.kind || "paragraph"),
          },
        }));

        if (rows.length) {
          const {error:insertError}=await supabase.from("content_nodes").insert(rows);
          if(insertError) {
            const {data:existingAfterRace}=await supabase
              .from("content_nodes")
              .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
              .eq("document_id",item.id)
              .order("sort_order");
            if(!existingAfterRace?.length) throw insertError;
            loaded=existingAfterRace;
          } else {
            const {data:hydrated,error:hydrateError}=await supabase
              .from("content_nodes")
              .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
              .eq("document_id",item.id)
              .order("sort_order");
            if(hydrateError) throw hydrateError;
            loaded=hydrated ?? [];
          }
        }

        if (json.sourceUrl && json.sourceUrl !== itemMeta.source_url) {
          await supabase.from("library_items").update({
            metadata:{...itemMeta,source_url:String(json.sourceUrl),imported:true}
          }).eq("id",item.id);
        }
        setMessage("");
      } catch(importError) {
        setMessage(importError instanceof Error ? importError.message : "Risale metni alınamadı.");
      }
    }

    setNodes(loaded);
    setLocalCounts(getTransientCounts(item.id));

    const firstTargeted = loaded.find(node => {
      const own = Number(node.metadata?.target || 0);
      return own > 0 || (loaded.length === 1 && itemTarget > 0);
    });

    const focused = loaded[Math.min(initialFocusIndex, Math.max(0, loaded.length - 1))];
    setActiveNodeId(focused?.id ?? firstTargeted?.id ?? loaded[0]?.id ?? null);
    setActiveTodoId(null);
    scrollRestored.current = false;
    await loadTodos();
  }, [item.id, item.title, itemTarget, loadTodos, initialFocusIndex, isQuranDocument, quranSurahNo, isRisaleExternal, itemMeta.book_title, itemMeta.chapter_no, itemMeta.source_url]);

  useEffect(() => { load(); }, [load]);

  function todosForNode(node: Node) {
    return todos
      .filter(todo => todo.related_content_node_id === node.id)
      .map(todo => {
        const meta = parseMeta(todo.notes);
        if (!occurs(meta, today)) return null;
        const target = Math.max(1, Number(meta.schedule?.target || 1));
        const count = Math.min(target, Number(meta.schedule?.history?.[today]?.count || 0));
        return { todo, meta, target, count, done: count >= target };
      })
      .filter((value): value is TodoInfo => value !== null);
  }

  function documentTodoInfos() {
    return todos
      .filter(todo => !todo.related_content_node_id)
      .map(todo => {
        const meta = parseMeta(todo.notes);
        if (!occurs(meta, today)) return null;
        const target = Math.max(1, Number(meta.schedule?.target || 1));
        const count = Math.min(target, Number(meta.schedule?.history?.[today]?.count || 0));
        return { todo, meta, target, count, done: count >= target };
      })
      .filter((value): value is TodoInfo => value !== null);
  }

  const activeNode = useMemo(
    () => nodes.find(node => node.id === activeNodeId) ?? null,
    [nodes, activeNodeId]
  );

  useEffect(() => {
    if (!activeNode) {
      setActiveTodoId(null);
      setCounterArmed(false);
      return;
    }
    const active = todosForNode(activeNode).filter(info => !info.done);
    if (active.length) {
      if (!activeTodoId || !active.some(info => info.todo.id === activeTodoId)) {
        setActiveTodoId(active[0].todo.id);
      }
      setCounterArmed(true);
      return;
    }
    setActiveTodoId(null);
    setCounterArmed(targetForIntrinsic(activeNode) > 0);
  }, [activeNodeId, todos]);

  const activeTodos = activeNode ? todosForNode(activeNode).filter(todo => !todo.done) : [];
  const selectedTodo = activeTodoId
    ? activeTodos.find(info => info.todo.id === activeTodoId) ?? null
    : null;
  const selectedDocumentTodo = activeDocumentTodoId
    ? documentTodoInfos().find(info => info.todo.id === activeDocumentTodoId && !info.done) ?? null
    : null;
  const activeIntrinsicTarget = activeNode ? targetForIntrinsic(activeNode) : 0;
  const activeTarget = selectedDocumentTodo ? selectedDocumentTodo.target : (selectedTodo ? selectedTodo.target : activeIntrinsicTarget);
  const activeCount = selectedDocumentTodo
    ? selectedDocumentTodo.count
    : selectedTodo
      ? selectedTodo.count
      : (activeNode ? (localCounts[activeNode.id] ?? 0) : 0);

  const activeTitle = activeNode
    ? (item.subtitle || activeNode.text_content || activeNode.title || item.title)
    : (item.subtitle || item.title);

  async function updateTodoCount(todoInfo: ReturnType<typeof todosForNode>[number], nextCount: number) {
    const history = { ...(todoInfo.meta.schedule?.history || {}) };
    const count = Math.min(todoInfo.target, Math.max(0, nextCount));
    history[today] = {
      count,
      completedAt: count >= todoInfo.target ? new Date().toISOString() : null,
    };

    const nextMeta = {
      ...todoInfo.meta,
      schedule: {
        ...todoInfo.meta.schedule,
        history,
      },
    };

    setTodos(current =>
      current.map(todo =>
        todo.id === todoInfo.todo.id
          ? { ...todo, notes: JSON.stringify(nextMeta) }
          : todo
      )
    );

    const { error } = await supabase
      .from("todos")
      .update({ notes: JSON.stringify(nextMeta) })
      .eq("id", todoInfo.todo.id);

    if (error) setMessage(error.message);
  }

  async function incrementActive() {
    if (activeTarget > 0 && !counterArmed) return;
    if (selectedDocumentTodo) {
      await updateTodoCount(selectedDocumentTodo, selectedDocumentTodo.count + 1);
      return;
    }
    if (!activeNode) return;

    if (selectedTodo) {
      await updateTodoCount(selectedTodo, selectedTodo.count + 1);
      return;
    }

    setLocalCounts(current => {
      const currentCount = current[activeNode.id] ?? 0;
      const next = activeIntrinsicTarget > 0
        ? Math.min(activeIntrinsicTarget, currentCount + 1)
        : currentCount + 1;
      const value = { ...current, [activeNode.id]: next };
      setTransientCounts(item.id, value);
      return value;
    });
  }

  async function decrementActive() {
    if (selectedDocumentTodo) {
      await updateTodoCount(selectedDocumentTodo, selectedDocumentTodo.count - 1);
      return;
    }
    if (!activeNode) return;

    if (selectedTodo) {
      await updateTodoCount(selectedTodo, selectedTodo.count - 1);
      return;
    }

    setLocalCounts(current => {
      const value = {
        ...current,
        [activeNode.id]: Math.max(0, (current[activeNode.id] ?? 0) - 1),
      };
      setTransientCounts(item.id, value);
      return value;
    });
  }

  async function resetActive() {
    if (selectedDocumentTodo) {
      await updateTodoCount(selectedDocumentTodo, 0);
      return;
    }
    if (!activeNode) return;

    if (selectedTodo) {
      await updateTodoCount(selectedTodo, 0);
      return;
    }

    setLocalCounts(current => {
      const value = { ...current, [activeNode.id]: 0 };
      setTransientCounts(item.id, value);
      return value;
    });
  }

  useEffect(() => {
    if (!nodes.length || scrollRestored.current) return;
    scrollRestored.current = true;
    requestAnimationFrame(() => {
      document.querySelector(`[data-reader-index="${initialFocusIndex}"]`)?.scrollIntoView({ block: "center" });
    });
  }, [nodes, initialFocusIndex]);

  const documentTodos = documentTodoInfos();

  function leaveDocument(action?: () => void) {
    clearTransientCounts(item.id);
    action?.();
  }

  function startTodoEditPress(info: TodoInfo, e: React.PointerEvent<HTMLButtonElement>) {
    if (editPressTimer.current) clearTimeout(editPressTimer.current);
    editPressTimer.current = setTimeout(() => {
      setEditMenu({ todo: info, x: e.clientX, y: e.clientY });
    }, 650);
  }

  function endTodoEditPress() {
    if (editPressTimer.current) clearTimeout(editPressTimer.current);
    editPressTimer.current = null;
  }

  return (
    <div
      className="legacyReadPage"
      onPointerDown={e => {
        if (e.target === e.currentTarget) {
          setActiveTodoId(null);
          setActiveDocumentTodoId(null);
          setCounterArmed(false);
          setEditMenu(null);
        }
      }}
    >
      <EzberSharedHeader
        title={isEsmaDetail ? (categoryTitle || item.title) : item.title}
        invocation={!isEsmaDetail ? invocation || null : null}
        showTodo={true}
        showMemorize={true}
        onMenu={() => leaveDocument(onMenu)}
        onBack={() => leaveDocument(onBack)}
        onTodo={() => setDocumentTodoOpen(true)}
        onMemorize={() => onMemorize?.(initialFocusIndex)}
        showFullscreen={true}
        onFullscreen={() => window.dispatchEvent(new Event("lumen-open-fullscreen-tasbih"))}
        onSettings={() => window.dispatchEvent(new Event("lumen-open-library-settings"))}
      />

      {isQuranDocument && (
        <div className="readerSourceNote">
          Kaynak: AlQuran Cloud Uthmânî metin · Diyanet İşleri Başkanlığı Türkçe meali
        </div>
      )}
      {isRisaleExternal && nodes.length > 0 && (
        <div className="readerSourceNote">
          Kaynak: Hizmet Vakfı Risale-i Nur Külliyatı · Metin ilk açılışta Lumen veritabanına kaydedilir.
        </div>
      )}

      {isEsmaDetail && (
        <div className="v2EsmaIdentity v2EsmaReadIdentity">
          <div className="v2EsmaName">{item.title}</div>
          {invocation && <div className="v2EsmaInvocation">{invocation}</div>}
        </div>
      )}

      {!!documentTodos.length && (
        <div className="documentTodoTargets">
          {documentTodos.filter(x => !x.done).map(info => (
            <button
              key={info.todo.id}
              className={"segmentTargetButton documentTodoTarget " + (activeDocumentTodoId === info.todo.id ? " active" : "")}
              onPointerDown={e => startTodoEditPress(info, e)}
              onPointerUp={endTodoEditPress}
              onPointerCancel={endTodoEditPress}
              onContextMenu={e => e.preventDefault()}
              onClick={() => { setActiveTodoId(null); setActiveDocumentTodoId(info.todo.id); setCounterArmed(true); }}
            >
              {info.target}/{info.count}
            </button>
          ))}
        </div>
      )}
      {itemTarget > 0 && (
        <div className="legacyInvocation inlineInvocationTarget">
          <b>{itemTarget}</b>
        </div>
      )}

      <div className="legacyReadContent">
        {nodes.map((node, index) => {
          const todoInfos = todosForNode(node);
          const activeTodoInfos = todoInfos.filter(info => !info.done);
          const intrinsicTarget = targetForIntrinsic(node);
          const intrinsicCount = localCounts[node.id] ?? 0;
          const intrinsicDone = intrinsicTarget > 0 && intrinsicCount >= intrinsicTarget;
          const active = activeNodeId === node.id;

          return (
            <article
              className={"legacyReadItem clickableReadItem " + (active ? "counterActiveItem" : "")}
              key={node.id}
              data-reader-index={index}
              onClick={() => onMemorize?.(index)}
            >
              <button
                className="segmentTodoButton segmentTodoTopLeft"
                onClick={e => {
                  e.stopPropagation();
                  setTodoTarget({
                    title: node.text_content || node.title || item.title,
                    nodeId: node.id,
                    defaultTarget: targetForIntrinsic(node) || 1,
                  });
                }}
              >
                + Todo
              </button>

              <div className="segmentTargetGroup">
                {Object.values(activeTodoInfos.reduce((groups, info) => {
                  const key = info.target + "/" + info.count;
                  (groups[key] ||= []).push(info);
                  return groups;
                }, {} as Record<string, typeof activeTodoInfos>)).map(group => {
                  const info = group[0];
                  const selected = active && group.some(x => x.todo.id === activeTodoId);
                  return (
                    <button
                      key={info.todo.id}
                      className={"segmentTargetButton todoTarget " + (selected ? " active" : "")}
                      onPointerDown={e => startTodoEditPress(info, e)}
                      onPointerUp={endTodoEditPress}
                      onPointerCancel={endTodoEditPress}
                      onContextMenu={e => e.preventDefault()}
                      onClick={e => {
                        e.stopPropagation();
                        setActiveNodeId(node.id);
                        setActiveDocumentTodoId(null);
                        setActiveTodoId(info.todo.id);
                        setCounterArmed(true);
                      }}
                    >
                      {info.target}/{info.count}
                      {group.length > 1 && <span className="targetMultiplicity">{group.length}</span>}
                    </button>
                  );
                })}

                {!activeTodoInfos.length && intrinsicTarget > 0 && (
                  <button
                    className={"segmentTargetButton " + (intrinsicDone ? "done" : "") + (active && !activeTodoId ? " active" : "")}
                    onClick={e => {
                      e.stopPropagation();
                      setActiveNodeId(node.id);
                      setActiveDocumentTodoId(null);
                      setActiveTodoId(null);
                      setCounterArmed(true);
                    }}
                  >
                    {intrinsicTarget}/{intrinsicCount}
                  </button>
                )}
              </div>

              <div className="legacyReadItemNumber">{index + 1}</div>
              {node.title && <h3>{node.title}</h3>}
              {node.secondary_text && <div className="legacyArabic" dir="rtl">{node.secondary_text}</div>}
              {node.text_content && <div className={node.metadata?.instruction ? "legacyInstruction" : "legacySegment"}>{node.text_content}</div>}
              {node.translation && <div className="legacyTurkish">{node.translation}</div>}
            </article>
          );
        })}
        {!nodes.length && <p className="muted">{isQuranDocument ? "Sûre metni yükleniyor…" : isRisaleExternal ? "Risale metni yükleniyor…" : "Henüz içerik yok."}</p>}
      </div>

      <nav className="contentPager">
        <button className="secondary" disabled={!hasPreviousItem} onClick={() => leaveDocument(onPreviousItem)}>‹ Önceki</button>
        <button className="secondary" disabled={!hasNextItem} onClick={() => leaveDocument(onNextItem)}>Sonraki ›</button>
      </nav>

      <FloatingPlaybackButton />

      <FloatingCounterButton
        key={item.id}
        title={activeTitle}
        target={activeTarget}
        count={activeCount}
        onIncrement={incrementActive}
        onDecrement={decrementActive}
        onReset={resetActive}
      />

      <FullscreenTasbih
        title={activeTitle}
        count={activeCount}
        target={activeTarget}
        onIncrement={() => void incrementActive()}
        onDecrement={() => void decrementActive()}
      />

      <TodoDialog
        open={documentTodoOpen}
        onClose={() => setDocumentTodoOpen(false)}
        onSaved={loadTodos}
        title={item.title}
        defaultTarget={1}
        libraryItemId={item.id}
        contentNodeId={null}
      />

      <TodoDialog
        open={!!todoTarget}
        onClose={() => setTodoTarget(null)}
        onSaved={loadTodos}
        title={todoTarget?.title || ""}
        defaultTarget={todoTarget?.defaultTarget || 1}
        libraryItemId={item.id}
        contentNodeId={todoTarget?.nodeId || null}
      />

      {editMenu && (
        <button
          className="counterResetPopover todoEditPopover"
          style={{ left: Math.max(8, editMenu.x - 42), top: Math.max(8, editMenu.y - 58), right: "auto", bottom: "auto" }}
          onClick={() => {
            setEditTodo(editMenu.todo);
            setEditMenu(null);
          }}
        >
          Düzenle
        </button>
      )}

      {editTodo && (
        <TodoDialog
          open={true}
          onClose={() => setEditTodo(null)}
          onSaved={async () => { await loadTodos(); setEditTodo(null); }}
          title={item.title}
          defaultTarget={editTodo.target}
          libraryItemId={item.id}
          contentNodeId={editTodo.todo.related_content_node_id}
          editTodo={{ id: editTodo.todo.id, notes: editTodo.todo.notes }}
        />
      )}

      {message && <div className="legacyMessage">{message}</div>}
    </div>
  );
}
