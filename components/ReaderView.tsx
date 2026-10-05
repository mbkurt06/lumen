"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";
import { FloatingCounterButton } from "@/components/FloatingCounterButton";
import { TodoDialog } from "@/components/TodoDialog";

type Item = { id: string; kind: string; title: string; subtitle?: string | null };
type Node = {
  id: string;
  kind: string;
  title: string | null;
  text_content: string | null;
  secondary_text: string | null;
  translation: string | null;
  sort_order: number;
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
  const [message, setMessage] = useState("");
  const [todoTarget, setTodoTarget] = useState<{title:string;nodeId?:string}|null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,kind,title,text_content,secondary_text,translation,sort_order")
      .eq("document_id", item.id)
      .order("sort_order");

    if (error) setMessage(error.message);
    else setNodes(data ?? []);
  }, [item.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="legacyReadPage">
      <div className="legacyReadToolbar">
        <button className="legacyBack" onClick={onBack}>‹ Liste</button>
        <div className="toolbar">
          <button className="secondary" onClick={() => setTodoTarget({title:item.title})}>+ Todo</button>
          <button className="primary" onClick={() => onMemorize?.(0)}>Ezber yap</button>
        </div>
      </div>

      <div className="legacyReadTitle">{item.title}</div>
      {item.subtitle && <div className="legacyInvocation">{item.subtitle}</div>}

      <div className="legacyReadContent">
        {nodes.map((node, index) => (
          <article
            className="legacyReadItem clickableReadItem"
            key={node.id}
            onClick={() => onMemorize?.(index)}
          >
            <div className="legacyReadItemNumber">{index + 1}</div>
            {node.title && <h3>{node.title}</h3>}
            {node.secondary_text && <div className="legacyArabic" dir="rtl">{node.secondary_text}</div>}
            {node.text_content && <div className="legacySegment">{node.text_content}</div>}
            {node.translation && <div className="legacyTurkish">{node.translation}</div>}
            <button
              className="segmentTodoButton"
              onClick={e => {
                e.stopPropagation();
                setTodoTarget({title:node.text_content || node.title || item.title,nodeId:node.id});
              }}
            >
              + Todo
            </button>
          </article>
        ))}
        {!nodes.length && <p className="muted">Henüz içerik yok.</p>}
      </div>

      <nav className="contentPager">
        <button className="secondary" disabled={!hasPreviousItem} onClick={onPreviousItem}>‹ Önceki</button>
        <button className="secondary" disabled={!hasNextItem} onClick={onNextItem}>Sonraki ›</button>
      </nav>

      <FloatingPlaybackButton />
      <FloatingCounterButton />
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
