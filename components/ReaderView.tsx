"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";

type Item = { id: string; kind: string; title: string };
type Node = {
  id: string;
  kind: string;
  title: string | null;
  text_content: string | null;
  secondary_text: string | null;
  translation: string | null;
  sort_order: number;
};

export function ReaderView({ item }: { item: Item }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (item.kind !== "document") {
      setNodes([]);
      return;
    }

    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,kind,title,text_content,secondary_text,translation,sort_order")
      .eq("document_id", item.id)
      .is("parent_id", null)
      .order("sort_order");

    if (error) setMessage(error.message);
    else setNodes(data ?? []);
  }, [item.id, item.kind]);

  useEffect(() => {
    load();
  }, [load]);

  if (item.kind !== "document") {
    return (
      <div className="card" style={{ padding: 24 }}>
        <h2>{item.title}</h2>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>{item.title}</h2>
        {message && <p className="muted">{message}</p>}
      </div>

      <div>
        {nodes.length === 0 && (
          <div className="card" style={{ padding: 24 }}>
            <p className="muted">Henüz metin eklenmemiş.</p>
          </div>
        )}

        {nodes.map(node => (
          <article className="card segmentCard" key={node.id}>
            {node.title && <h3>{node.title}</h3>}
            {node.secondary_text && (
              <div className="readerText" dir="rtl" style={{ fontSize: 28, marginBottom: 10 }}>
                {node.secondary_text}
              </div>
            )}
            {node.text_content && (
              <div className="readerText">{node.text_content}</div>
            )}
            {node.translation && (
              <p className="muted">{node.translation}</p>
            )}
          </article>
        ))}
      </div>

      <FloatingPlaybackButton />
    </div>
  );
}
