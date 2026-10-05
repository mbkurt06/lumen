"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";

type Item = { id: string; kind: string; title: string };
type Node = {
  id: string;
  kind: string;
  title: string | null;
  text_content: string | null;
  translation: string | null;
  sort_order: number;
};

export function ReaderView({ item }: { item: Item }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [kind, setKind] = useState("paragraph");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (item.kind !== "document") {
      setNodes([]);
      return;
    }

    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,kind,title,text_content,translation,sort_order")
      .eq("document_id", item.id)
      .is("parent_id", null)
      .order("sort_order");

    if (error) setMessage(error.message);
    else setNodes(data ?? []);
  }, [item.id, item.kind]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() && !title.trim()) return;

    const { error } = await supabase.from("content_nodes").insert({
      document_id: item.id,
      kind,
      title: title.trim() || null,
      text_content: text.trim() || null,
      sort_order: nodes.length,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setText("");
      setTitle("");
      await load();
    }
  }

  if (item.kind !== "document") {
    return (
      <div className="card" style={{ padding: 24 }}>
        <h2>{item.title}</h2>
        <p className="muted">
          Bu öğe bir koleksiyon veya klasör. Alt eser yapısını sonraki aşamada
          istediğimiz kadar derinleştirebiliriz.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>{item.title}</h2>

        <form onSubmit={add} style={{ display: "grid", gap: 10 }}>
          <div className="toolbar">
            <select
              className="input"
              style={{ width: "auto" }}
              value={kind}
              onChange={e => setKind(e.target.value)}
            >
              {[
                "chapter",
                "section",
                "heading",
                "paragraph",
                "sentence",
                "phrase",
                "verse",
                "note",
                "custom",
              ].map(value => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>

            <input
              className="input"
              placeholder="Başlık (isteğe bağlı)"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <textarea
            className="input"
            rows={4}
            placeholder="Metin"
            value={text}
            onChange={e => setText(e.target.value)}
          />

          <div>
            <button className="primary">İçerik ekle</button>
          </div>
        </form>

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
            <div className="segmentMeta">
              <span className="segmentType">{node.kind}</span>
              <span className="muted">#{node.sort_order + 1}</span>
            </div>

            {node.title && <h3>{node.title}</h3>}
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
