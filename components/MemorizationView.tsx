"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FloatingPlaybackButton } from "@/components/FloatingPlaybackButton";
import { FullscreenTasbih } from "@/components/FullscreenTasbih";
import { TodoDialog } from "@/components/TodoDialog";

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

export function MemorizationView({
  item,
  onBack,
  initialIndex = 0,
}: {
  item: Item | null;
  onBack?: () => void;
  initialIndex?: number;
}) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [states, setStates] = useState<Record<string, MemoryState>>({});
  const [active, setActive] = useState(initialIndex);
  const [counterPos, setCounterPos] = useState<{x:number;y:number}|null>(null);
  const counterDragging = useRef(false);
  const counterStart = useRef({x:0,y:0});
  const counterOrigin = useRef({x:0,y:0});
  const counterPressed = useRef(false);
  const [message, setMessage] = useState("");
  const [resetMenu, setResetMenu] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetLongPress = useRef(false);
  const resetRef = useRef<HTMLButtonElement | null>(null);
  const counterRef = useRef<HTMLButtonElement | null>(null);

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
    setActive(Math.min(initialIndex, Math.max(0, (data ?? []).length - 1)));

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
    const saved = localStorage.getItem("lumen-counter-pos");
    if (saved) { try { setCounterPos(JSON.parse(saved)); } catch {} }
    load();
  }, [load]);

  useEffect(() => {
    if (!resetMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (resetRef.current?.contains(target)) return;
      if (counterRef.current?.contains(target)) return;
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
    if (!resetLongPress.current) increment();
  }

  async function decrement() {
    if (!node || !memory) return;
    const nextCount = Math.max(0, memory.repeat_count - 1);
    const next: MemoryState = { ...memory, repeat_count: nextCount };
    setStates(current => ({ ...current, [node.id]: next }));
    const { error } = await supabase.from("memorization_state").upsert({
      content_node_id: node.id,
      repeat_count: nextCount,
      repeat_target: configuredTarget || memory.repeat_target || 1,
      playback_rate: memory.playback_rate,
      is_memorized: false,
      last_practiced_at: new Date().toISOString(),
    }, { onConflict: "owner_id,content_node_id" });
    if (error) setMessage(error.message);
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
        {configuredTarget > 0 && <div className="legacyTargetCount">Tekrar: {configuredTarget}</div>}

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

            <button className="segmentTodoButton memorizeTodoButton" onClick={() => setTodoOpen(true)}>
              + Todo
            </button>
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

      {node && resetMenu && (
        <button
          ref={resetRef}
          className="counterResetPopover"
          onClick={() => {
            resetCounter();
            setResetMenu(false);
          }}
        >
          Sıfırla
        </button>
      )}

      {node && (
        <button ref={counterRef} className="legacyCounter" style={counterPos ? {left:counterPos.x,top:counterPos.y,right:"auto",bottom:"auto"} : undefined} onPointerDown={counterDown} onPointerMove={counterMove} onPointerUp={counterUp} title="Dokun: say • Basılı tut: sıfırla • Sürükle: taşı">
          <span>{memory?.repeat_count ?? 0}</span>
          <small>
            {configuredTarget > 0 ? "/ " + configuredTarget : "tekrar"}
          </small>
        </button>
      )}

      {node && (
        <FullscreenTasbih
          title={item.subtitle || node.text_content || node.title || item.title}
          count={memory?.repeat_count ?? 0}
          target={configuredTarget}
          onIncrement={increment}
          onDecrement={decrement}
        />
      )}

      <FloatingPlaybackButton />

      {node && (
        <TodoDialog
          open={todoOpen}
          onClose={() => setTodoOpen(false)}
          title={node.text_content || node.title || item.title}
          defaultTarget={configuredTarget || 1}
          libraryItemId={item.id}
          contentNodeId={node.id}
        />
      )}

      {message && <div className="legacyMessage">{message}</div>}
    </div>
  );
}
