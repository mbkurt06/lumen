"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";

type Node = {
  id: string;
  kind: string;
  text_content: string | null;
  title: string | null;
  document_id: string;
};

type MemoryState = {
  content_node_id: string;
  repeat_count: number;
  repeat_target: number;
  playback_rate: number;
  is_memorized: boolean;
};

export function MemorizationView() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [states, setStates] = useState<Record<string, MemoryState>>({});
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,kind,text_content,title,document_id")
      .in("kind", ["sentence", "phrase", "verse"])
      .order("created_at");

    if (error) {
      setMessage(error.message);
      return;
    }

    setNodes(data ?? []);

    const { data: memoryData, error: memoryError } = await supabase
      .from("memorization_state")
      .select(
        "content_node_id,repeat_count,repeat_target,playback_rate,is_memorized"
      );

    if (memoryError) {
      setMessage(memoryError.message);
      return;
    }

    const map: Record<string, MemoryState> = {};
    (memoryData ?? []).forEach(item => {
      map[item.content_node_id] = item;
    });
    setStates(map);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function increment(node: Node) {
    const current =
      states[node.id] ??
      ({
        content_node_id: node.id,
        repeat_count: 0,
        repeat_target: 10,
        playback_rate: 1,
        is_memorized: false,
      } as MemoryState);

    const next = { ...current, repeat_count: current.repeat_count + 1 };
    setStates(value => ({ ...value, [node.id]: next }));

    const { error } = await supabase.from("memorization_state").upsert(
      {
        content_node_id: node.id,
        repeat_count: next.repeat_count,
        repeat_target: next.repeat_target,
        playback_rate: next.playback_rate,
        is_memorized: next.is_memorized,
        last_practiced_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,content_node_id" }
    );

    if (error) setMessage(error.message);
  }

  const node = nodes[active];
  const state = node
    ? states[node.id] ?? {
        content_node_id: node.id,
        repeat_count: 0,
        repeat_target: 10,
        playback_rate: 1,
        is_memorized: false,
      }
    : null;

  return (
    <div>
      <div className="card" style={{ padding: 22 }}>
        <div
          className="toolbar"
          style={{ justifyContent: "space-between" }}
        >
          <div>
            <h2 style={{ margin: "0 0 4px" }}>Ezber</h2>
            <div className="muted">
              Cümle / parça / ayet bazında çalışma
            </div>
          </div>

          <div className="muted">
            {nodes.length ? active + 1 + " / " + nodes.length : "0 / 0"}
          </div>
        </div>

        {!node ? (
          <p className="muted" style={{ marginTop: 24 }}>
            Ezberlenebilir içerik bulunamadı. Kütüphanede sentence, phrase
            veya verse türünde içerik ekle.
          </p>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "40px 10px 20px",
            }}
          >
            {node.title && <div className="muted">{node.title}</div>}

            <div
              className="readerText"
              style={{ fontSize: 28, margin: "18px auto", maxWidth: 760 }}
            >
              {node.text_content}
            </div>

            <button
              className="counterButton"
              onClick={() => increment(node)}
              title="Tesbih / tekrar sayacı"
            >
              {state?.repeat_count ?? 0}
            </button>

            <div className="muted" style={{ marginTop: 10 }}>
              Hedef: {state?.repeat_target ?? 10}
            </div>

            <div
              className="toolbar"
              style={{ justifyContent: "center", marginTop: 24 }}
            >
              <button
                className="secondary"
                disabled={active === 0}
                onClick={() => setActive(value => Math.max(0, value - 1))}
              >
                ← Önceki
              </button>

              <button
                className="secondary"
                disabled={active >= nodes.length - 1}
                onClick={() =>
                  setActive(value => Math.min(nodes.length - 1, value + 1))
                }
              >
                Sonraki →
              </button>
            </div>
          </div>
        )}

        {message && <p className="muted">{message}</p>}
      </div>

      <FloatingPlaybackButton />
    </div>
  );
}
