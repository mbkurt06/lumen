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

type MemoryState = {
  content_node_id: string;
  repeat_count: number;
  repeat_target: number;
  playback_rate: number;
  is_memorized: boolean;
};

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
  const [states, setStates] = useState<Record<string, MemoryState>>({});
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [todoTarget, setTodoTarget] = useState<{title:string;nodeId?:string}|null>(null);

  const itemTarget = Number(item.metadata?.target || 0);

  const targetFor = useCallback((node: Node) => {
    const own = Number(node.metadata?.target || 0);
    return own > 0 ? own : (nodes.length === 1 && itemTarget > 0 ? itemTarget : 0);
  }, [itemTarget, nodes.length]);

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

    const ids = loaded.map(node => node.id);
    if (!ids.length) {
      setStates({});
      setActiveNodeId(null);
      return;
    }

    const { data: memoryData, error: memoryError } = await supabase
      .from("memorization_state")
      .select("content_node_id,repeat_count,repeat_target,playback_rate,is_memorized")
      .in("content_node_id", ids);

    if (memoryError) {
      setMessage(memoryError.message);
      return;
    }

    const map: Record<string, MemoryState> = {};
    (memoryData ?? []).forEach(row => {
      map[row.content_node_id] = row;
    });
    setStates(map);

    const firstTargeted = loaded.find(node => {
      const own = Number(node.metadata?.target || 0);
      return own > 0 || (loaded.length === 1 && itemTarget > 0);
    });
    setActiveNodeId(firstTargeted?.id ?? null);
  }, [item.id, itemTarget]);

  useEffect(() => { load(); }, [load]);

  const activeNode = useMemo(
    () => nodes.find(node => node.id === activeNodeId) ?? null,
    [nodes, activeNodeId]
  );

  const activeTarget = activeNode ? targetFor(activeNode) : 0;
  const activeCount = activeNode
    ? (states[activeNode.id]?.repeat_count ?? 0)
    : 0;

  const activeTitle = activeNode
    ? (item.subtitle || activeNode.text_content || activeNode.title || item.title)
    : (item.subtitle || item.title);

  async function setNodeCount(node: Node, count: number) {
    const target = targetFor(node);
    const nextCount = target > 0 ? Math.min(target, Math.max(0, count)) : Math.max(0, count);
    const previous = states[node.id] ?? {
      content_node_id: node.id,
      repeat_count: 0,
      repeat_target: target || 1,
      playback_rate: 1,
      is_memorized: false,
    };

    const next: MemoryState = {
      ...previous,
      repeat_count: nextCount,
      repeat_target: target || previous.repeat_target || 1,
      is_memorized: target > 0 && nextCount >= target,
    };

    setStates(current => ({ ...current, [node.id]: next }));

    const { error } = await supabase.from("memorization_state").upsert({
      content_node_id: node.id,
      repeat_count: next.repeat_count,
      repeat_target: next.repeat_target,
      playback_rate: next.playback_rate,
      is_memorized: next.is_memorized,
      last_practiced_at: new Date().toISOString(),
    }, { onConflict: "owner_id,content_node_id" });

    if (error) setMessage(error.message);
  }

  async function incrementActive() {
    if (!activeNode) return;
    await setNodeCount(activeNode, activeCount + 1);
  }

  async function decrementActive() {
    if (!activeNode) return;
    await setNodeCount(activeNode, activeCount - 1);
  }

  async function resetActive() {
    if (!activeNode) return;
    await setNodeCount(activeNode, 0);
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
      {item.subtitle && <div className="legacyInvocation">{item.subtitle}</div>}
      {itemTarget > 0 && (
        <div className="legacyTargetCount">Tekrar: {itemTarget}</div>
      )}

      <div className="legacyReadContent">
        {nodes.map((node, index) => {
          const target = targetFor(node);
          const count = states[node.id]?.repeat_count ?? 0;
          const done = target > 0 && count >= target;
          const active = activeNodeId === node.id;

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

              {target > 0 && (
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
        title={todoTarget?.title || ""}
        libraryItemId={item.id}
        contentNodeId={todoTarget?.nodeId || null}
      />

      {message && <div className="legacyMessage">{message}</div>}
    </div>
  );
}
