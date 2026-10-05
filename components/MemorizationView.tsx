"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";

type Item = {
  id: string;
  title: string;
  subtitle?: string | null;
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

export function MemorizationView({
  item,
  onBack,
}: {
  item: Item | null;
  onBack?: () => void;
}) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [states, setStates] = useState<Record<string, MemoryState>>({});
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState("");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetLongPress = useRef(false);

  const load = useCallback(async () => {
    if (!item) {
      setNodes([]);
      return;
    }

    const { data, error } = await supabase
      .from("content_nodes")
      .select("id,kind,title,text_content,secondary_text,translation,metadata,sort_order")
      .eq("document_id", item.id)
      .order("sort_order");

    if (error) {
      setMessage(error.message);
      return;
    }

    setNodes(data ?? []);
    setActive(0);

    const ids = (data ?? []).map(node => node.id);
    if (!ids.length) {
      setStates({});
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
  }, [item]);

  useEffect(() => {
    load();
  }, [load]);

  const node = nodes[active];

  const configuredTarget = useMemo(() => {
    if (!node) return 0;
    const raw = node.metadata?.target;
    const number = Number(raw ?? 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }, [node]);

  const memory = node
    ? states[node.id] ?? {
        content_node_id: node.id,
        repeat_count: 0,
        repeat_target: configuredTarget,
        playback_rate: 1,
        is_memorized: false,
      }
    : null;

  async function resetCounter() {
    if (!node || !memory) return;
    const next = { ...memory, repeat_count: 0 };
    setStates(current => ({ ...current, [node.id]: next }));
    const { error } = await supabase.from("memorization_state").upsert({
      content_node_id: node.id,
      repeat_count: 0,
      repeat_target: memory.repeat_target || 1,
      playback_rate: memory.playback_rate,
      is_memorized: false,
      last_practiced_at: new Date().toISOString(),
    }, { onConflict: "owner_id,content_node_id" });
    if (error) setMessage(error.message);
  }

  function counterDown() {
    resetLongPress.current = false;
    resetTimer.current = setTimeout(() => {
      resetLongPress.current = true;
      resetCounter();
    }, 650);
  }

  function counterUp() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (!resetLongPress.current) increment();
  }

  async function increment() {
    if (!node || !memory) return;

    let nextCount = memory.repeat_count + 1;
    if (configuredTarget > 0) nextCount = Math.min(nextCount, configuredTarget);

    const next: MemoryState = {
      ...memory,
      repeat_count: nextCount,
      repeat_target: configuredTarget,
    };

    setStates(current => ({ ...current, [node.id]: next }));

    const { error } = await supabase.from("memorization_state").upsert(
      {
        content_node_id: node.id,
        repeat_count: next.repeat_count,
        repeat_target: next.repeat_target || 1,
        playback_rate: next.playback_rate,
        is_memorized:
          configuredTarget > 0 && next.repeat_count >= configuredTarget,
        last_practiced_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,content_node_id" }
    );

    if (error) setMessage(error.message);
  }

  if (!item) {
    return (
      <section className="legacyEmpty">
        <h2>Ezber</h2>
        <p>Önce Kütüphane’den bir eser açıp “Ezber yap” seç.</p>
      </section>
    );
  }

  return (
    <div className="legacyApp">
      <header className="legacyHeader">
        <button className="legacyTextButton" onClick={onBack}>‹ Geri</button>
        <div className="legacyProgress">
          {nodes.length ? active + 1 + " / " + nodes.length : "0 / 0"}
        </div>
        <div />
      </header>

      <main className="legacyMemorize">
        <div className="legacyTitle">{item.title}</div>
        {item.subtitle && <div className="legacyInvocation">{item.subtitle}</div>}

        {node ? (
          <>
            {typeof node.metadata?.note === "string" && node.metadata.note && (
              <div className="legacyNote">{node.metadata.note}</div>
            )}

            {node.secondary_text && (
              <div className="legacyArabic" dir="rtl">
                {node.secondary_text}
              </div>
            )}

            {node.text_content && (
              <div className="legacySegment">{node.text_content}</div>
            )}

            {node.translation && (
              <div className="legacyTurkish">{node.translation}</div>
            )}
          </>
        ) : (
          <p className="muted">Bu eserde henüz bölüm yok.</p>
        )}
      </main>

      <nav className="legacyNavigation">
        <button
          disabled={active === 0}
          onClick={() => setActive(value => Math.max(0, value - 1))}
        >
          ‹ Önceki
        </button>
        <button
          disabled={!nodes.length || active >= nodes.length - 1}
          onClick={() =>
            setActive(value => Math.min(nodes.length - 1, value + 1))
          }
        >
          Sonraki ›
        </button>
      </nav>

      {node && (
        <button className="legacyCounter" onPointerDown={counterDown} onPointerUp={counterUp} onPointerLeave={() => resetTimer.current && clearTimeout(resetTimer.current)} title="Dokun: say • Basılı tut: sıfırla">
          <span>{memory?.repeat_count ?? 0}</span>
          <small>
            {configuredTarget > 0 ? "/ " + configuredTarget : "tekrar"}
          </small>
        </button>
      )}

      <FloatingPlaybackButton />

      {message && <div className="legacyMessage">{message}</div>}
    </div>
  );
}
