"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";
import { FloatingCounterButton } from "@/components/FloatingCounterButton";
import { TodoDialog } from "@/components/TodoDialog";

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
  onMemorize,
  onPreviousItem,
  onNextItem,
  hasPreviousItem,
  hasNextItem,
}: {
  item: Item;
  onBack?: () => void;
  onMemorize?: (index?: number) => void;
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
  const [todoTarget, setTodoTarget] = useState<{title:string;nodeId?:string}|null>(null);

  const today = localDateKey();
  const itemTarget = Number(item.metadata?.target || 0);

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
    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
      .eq("document_id", item.id)
      .order("sort_order");

    if (error) {
      setMessage(error.message);
      return;
    }

    const loaded = data ?? [];
    setNodes(loaded);
    setLocalCounts({});

    const firstTargeted = loaded.find(node => {
      const own = Number(node.metadata?.target || 0);
      return own > 0 || (loaded.length === 1 && itemTarget > 0);
    });

    setActiveNodeId(firstTargeted?.id ?? loaded[0]?.id ?? null);
    await loadTodos();
  }, [item.id, itemTarget, loadTodos]);

  useEffect(() => { load(); }, [load]);

  function todoForNode(node: Node) {
    const matches = todos.filter(todo => todo.related_content_node_id === node.id);
    for (const todo of matches) {
      const meta = parseMeta(todo.notes);
      if (!occurs(meta, today)) continue;
      const target = Math.max(1, Number(meta.schedule?.target || 1));
      const count = Math.min(target, Number(meta.schedule?.history?.[today]?.count || 0));
      return { todo, meta, target, count, done: count >= target };
    }
    return null;
  }

  const activeNode = useMemo(
    () => nodes.find(node => node.id === activeNodeId) ?? null,
    [nodes, activeNodeId]
  );

  const activeTodo = activeNode ? todoForNode(activeNode) : null;
  const activeIntrinsicTarget = activeNode ? targetForIntrinsic(activeNode) : 0;
  const activeTarget = activeTodo && !activeTodo.done ? activeTodo.target : activeIntrinsicTarget;
  const activeCount = activeTodo && !activeTodo.done
    ? activeTodo.count
    : (activeNode ? (localCounts[activeNode.id] ?? 0) : 0);

  const activeTitle = activeNode
    ? (item.subtitle || activeNode.text_content || activeNode.title || item.title)
    : (item.subtitle || item.title);

  async function updateTodoCount(todoInfo: NonNullable<ReturnType<typeof todoForNode>>, nextCount: number) {
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
    if (!activeNode) return;

    if (activeTodo && !activeTodo.done) {
      await updateTodoCount(activeTodo, activeTodo.count + 1);
      return;
    }

    setLocalCounts(current => {
      const currentCount = current[activeNode.id] ?? 0;
      const next = activeIntrinsicTarget > 0
        ? Math.min(activeIntrinsicTarget, currentCount + 1)
        : currentCount + 1;
      return { ...current, [activeNode.id]: next };
    });
  }

  async function decrementActive() {
    if (!activeNode) return;

    if (activeTodo && !activeTodo.done) {
      await updateTodoCount(activeTodo, activeTodo.count - 1);
      return;
    }

    setLocalCounts(current => ({
      ...current,
      [activeNode.id]: Math.max(0, (current[activeNode.id] ?? 0) - 1),
    }));
  }

  async function resetActive() {
    if (!activeNode) return;

    if (activeTodo && !activeTodo.done) {
      await updateTodoCount(activeTodo, 0);
      return;
    }

    setLocalCounts(current => ({ ...current, [activeNode.id]: 0 }));
  }

  return (
    <div className="legacyReadPage">
      <div className="legacyReadToolbar">
        <button className="legacyBack" onClick={onBack}>‹ Liste</button>
        <div className="toolbar">
          <button className="primary" onClick={() => onMemorize?.(0)}>Ezber yap</button>
        </div>
      </div>

      <div className="legacyReadTitle">{item.title}</div>
      {item.subtitle && (
        <div className="legacyInvocation inlineInvocationTarget">
          <span>{item.subtitle}</span>
          {itemTarget > 0 && <b>{itemTarget}</b>}
        </div>
      )}

      <div className="legacyReadContent">
        {nodes.map((node, index) => {
          const todoInfo = todoForNode(node);
          const intrinsicTarget = targetForIntrinsic(node);
          const hasActiveTodo = !!todoInfo && !todoInfo.done;
          const target = hasActiveTodo ? todoInfo!.target : intrinsicTarget;
          const count = hasActiveTodo ? todoInfo!.count : (localCounts[node.id] ?? 0);
          const done = target > 0 && count >= target;
          const active = activeNodeId === node.id;
          const hideCompletedTodoCounter = !!todoInfo?.done;

          return (
            <article
              className={"legacyReadItem clickableReadItem " + (active ? "counterActiveItem" : "")}
              key={node.id}
              onClick={() => onMemorize?.(index)}
            >
              <button
                className="segmentTodoButton segmentTodoTopLeft"
                onClick={e => {
                  e.stopPropagation();
                  setTodoTarget({
                    title: node.text_content || node.title || item.title,
                    nodeId: node.id,
                  });
                }}
              >
                + Todo
              </button>

              {target > 0 && !hideCompletedTodoCounter && (
                <button
                  className={"segmentTargetButton " + (done ? "done" : "") + (active ? " active" : "")}
                  onClick={e => {
                    e.stopPropagation();
                    setActiveNodeId(node.id);
                  }}
                >
                  {target}/{count}
                </button>
              )}

              <div className="legacyReadItemNumber">{index + 1}</div>
              {node.title && <h3>{node.title}</h3>}
              {node.secondary_text && <div className="legacyArabic" dir="rtl">{node.secondary_text}</div>}
              {node.text_content && <div className="legacySegment">{node.text_content}</div>}
              {node.translation && <div className="legacyTurkish">{node.translation}</div>}
            </article>
          );
        })}
        {!nodes.length && <p className="muted">Henüz içerik yok.</p>}
      </div>

      <nav className="contentPager">
        <button className="secondary" disabled={!hasPreviousItem} onClick={onPreviousItem}>‹ Önceki</button>
        <button className="secondary" disabled={!hasNextItem} onClick={onNextItem}>Sonraki ›</button>
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

      <TodoDialog
        open={!!todoTarget}
        onClose={() => setTodoTarget(null)}
        onSaved={loadTodos}
        title={todoTarget?.title || ""}
        libraryItemId={item.id}
        contentNodeId={todoTarget?.nodeId || null}
      />

      {message && <div className="legacyMessage">{message}</div>}
    </div>
  );
}
