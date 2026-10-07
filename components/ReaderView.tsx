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
  const [quranSelectedNodeId, setQuranSelectedNodeId] = useState<string | null>(null);
  const [quranPage, setQuranPage] = useState<number | null>(null);
  const [quranPageMin, setQuranPageMin] = useState(1);
  const [quranPageMax, setQuranPageMax] = useState(604);
  const [quranPageLoading, setQuranPageLoading] = useState(false);
  const editPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRestored = useRef(false);

  const today = localDateKey();

  const itemTarget = Number(item.metadata?.target || 0);
  const itemMeta = (item.metadata ?? {}) as Record<string, any>;
  const sourceType = String(itemMeta.source || "");
  const isQuranSurah = sourceType === "quran_seeded";
  const isQuranJuzView = sourceType === "quran_juz_view";
  const isQuranDocument = isQuranSurah || isQuranJuzView;
  const isRisaleDocument = sourceType === "risale_seeded";
  const isEsmaDetail = itemMeta.category_key === "asma" || String(itemMeta.legacy_id || "").startsWith("esma-");
  const invocation = String(itemMeta.invocation || ((!isQuranDocument && !isRisaleDocument) ? item.subtitle : "") || "");

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

  const loadQuranPage = useCallback(async (page:number) => {
    const safePage = Math.max(quranPageMin, Math.min(quranPageMax, page));
    setQuranPageLoading(true);
    setMessage("");
    try {
      const { data, error } = await supabase
        .from("content_nodes")
        .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
        .eq("metadata->>source", "quran_seeded")
        .eq("metadata->>page", String(safePage));

      if (error) throw error;

      const loaded = (data ?? []).sort((a,b) => {
        const am=(a.metadata ?? {}) as Record<string,any>;
        const bm=(b.metadata ?? {}) as Record<string,any>;
        return Number(am.surah_no || 0) - Number(bm.surah_no || 0)
          || Number(am.ayah_no || a.sort_order || 0) - Number(bm.ayah_no || b.sort_order || 0);
      });

      setNodes(loaded);
      setQuranPage(safePage);
      setQuranSelectedNodeId(null);
      setActiveNodeId(loaded[0]?.id ?? null);
      setActiveTodoId(null);
      setActiveDocumentTodoId(null);
      setCounterArmed(false);
      scrollRestored.current = true;
      window.scrollTo({top:0,behavior:"smooth"});
    } catch(error) {
      setNodes([]);
      setMessage(error instanceof Error ? error.message : "Kur’an sayfası yüklenemedi.");
    } finally {
      setQuranPageLoading(false);
    }
  }, [quranPageMin, quranPageMax]);

  const load = useCallback(async () => {
    setMessage("");

    if (isQuranDocument) {
      const startPage = Math.max(1, Number(itemMeta.start_page || 1));
      const endPage = Math.min(604, Math.max(startPage, Number(itemMeta.end_page || startPage)));
      setQuranPageMin(startPage);
      setQuranPageMax(endPage);

      const { data, error } = await supabase
        .from("content_nodes")
        .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
        .eq("metadata->>source", "quran_seeded")
        .eq("metadata->>page", String(startPage));

      if (error) {
        setMessage(error.message);
        setNodes([]);
        return;
      }

      const loaded = (data ?? []).sort((a,b) => {
        const am=(a.metadata ?? {}) as Record<string,any>;
        const bm=(b.metadata ?? {}) as Record<string,any>;
        return Number(am.surah_no || 0) - Number(bm.surah_no || 0)
          || Number(am.ayah_no || a.sort_order || 0) - Number(bm.ayah_no || b.sort_order || 0);
      });

      setNodes(loaded);
      setQuranPage(startPage);
      setQuranSelectedNodeId(null);
      setLocalCounts(getTransientCounts(item.id));
      setActiveNodeId(loaded[0]?.id ?? null);
      setActiveTodoId(null);
      setActiveDocumentTodoId(null);
      setCounterArmed(false);
      scrollRestored.current = true;
      await loadTodos();
      return;
    }

    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
      .eq("document_id", item.id)
      .order("sort_order");

    if (error) {
      setMessage(error.message);
      setNodes([]);
      return;
    }

    const loaded = data ?? [];
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

    if (!loaded.length) {
      setMessage(isRisaleDocument ? "Bu Risale bölümünün veritabanı içeriği bulunamadı." : "");
    }

    await loadTodos();
  }, [item.id, itemTarget, loadTodos, initialFocusIndex, isQuranDocument, isRisaleDocument, itemMeta.start_page, itemMeta.end_page]);

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

      {isQuranDocument && quranPage && (
        <div className="quranPageMetaBar">
          <strong>{String((nodes[0]?.metadata as Record<string,any> | null)?.surah_title || item.title)}</strong>
          <span>Sayfa {quranPage} / Cüz {String((nodes[0]?.metadata as Record<string,any> | null)?.juz || itemMeta.juz_no || "")}</span>
        </div>
      )}
      {isRisaleDocument && nodes.length > 0 && (
        <div className="readerSourceNote">
          Kaynak: Risale-i-Nur Diyanet Asıl Nüsha metin arşivi · CC BY-ND 4.0 · içerik Lumen veritabanından okunur.
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

      {isQuranDocument ? (
        <div className="quranReaderShell">
          {quranSelectedNodeId && (() => {
            const selected = nodes.find(node => node.id === quranSelectedNodeId);
            if (!selected) return null;
            return (
              <div className="quranSelectionBar">
                <span>{selected.title || `Ayet ${selected.sort_order}`} seçili</span>
                <button
                  onClick={() => setTodoTarget({
                    title: selected.translation || selected.text_content || selected.title || item.title,
                    nodeId: selected.id,
                    defaultTarget: targetForIntrinsic(selected) || 1,
                  })}
                >
                  + Todo
                </button>
                <button className="secondary" onClick={() => setQuranSelectedNodeId(null)}>Seçimi kaldır</button>
              </div>
            );
          })()}

          <div className={"quranPage " + (quranPageLoading ? "loading" : "")}>
            <div className="quranPageTopLine">
              <span>{String((nodes[0]?.metadata as Record<string,any> | null)?.surah_title || item.title)}</span>
              <span>{quranPage ? `Sayfa ${quranPage}` : ""}</span>
              <span>{String((nodes[0]?.metadata as Record<string,any> | null)?.juz ? `Cüz ${(nodes[0]?.metadata as Record<string,any>).juz}` : "")}</span>
            </div>
            <div className="quranFlow" dir="rtl">
              {nodes.map((node, index) => {
                const selected = quranSelectedNodeId === node.id;
                return (
                  <button
                    key={node.id}
                    className={"quranAyahInline" + (selected ? " selected" : "")}
                    data-reader-index={index}
                    onClick={() => {
                      setQuranSelectedNodeId(node.id);
                      setActiveNodeId(node.id);
                      setActiveDocumentTodoId(null);
                      setActiveTodoId(null);
                      setCounterArmed(true);
                    }}
                  >
                    <span className="quranAyahText">{node.secondary_text}</span>
                    <span className="quranAyahNo">{node.sort_order}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <nav className="quranPagePager" aria-label="Kur’an sayfası">
            <button disabled={!quranPage || quranPage <= quranPageMin || quranPageLoading} onClick={() => quranPage && void loadQuranPage(quranPage - 1)}>‹ Önceki sayfa</button>
            <span>{quranPage ?? "—"} / 604</span>
            <button disabled={!quranPage || quranPage >= quranPageMax || quranPageLoading} onClick={() => quranPage && void loadQuranPage(quranPage + 1)}>Sonraki sayfa ›</button>
          </nav>

          <div className="quranSupplement quranLatinBlock">
            <h3>Latin harflerle okunuş</h3>
            {nodes.map(node => (
              <p key={"latin-" + node.id}>
                <b>{node.sort_order}.</b> {node.text_content}
              </p>
            ))}
          </div>

          <div className="quranSupplement quranTranslationBlock">
            <h3>Türkçe meal</h3>
            {nodes.map(node => (
              <p key={"meal-" + node.id}>
                <b>{node.sort_order}.</b> {node.translation}
              </p>
            ))}
          </div>
        </div>
      ) : (
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
        {!nodes.length && !message && <p className="muted">Henüz içerik yok.</p>}
      </div>
      )}

      {!isQuranDocument && (
        <nav className="contentPager">
          <button className="secondary" disabled={!hasPreviousItem} onClick={() => leaveDocument(onPreviousItem)}>‹ Önceki</button>
          <button className="secondary" disabled={!hasNextItem} onClick={() => leaveDocument(onNextItem)}>Sonraki ›</button>
        </nav>
      )}

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
