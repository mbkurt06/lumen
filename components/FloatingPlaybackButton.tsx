"use client";
import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

export function FloatingPlaybackButton() {
  const [playing, setPlaying] = useState(false);
  const [panel, setPanel] = useState(false);
  const [repeatTarget, setRepeatTarget] = useState(1);
  const [rate, setRate] = useState(1);
  const [pos, setPos] = useState<Point | null>(null);
  const [positionRestored, setPositionRestored] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const start = useRef<Point>({ x: 0, y: 0 });
  const origin = useRef<Point>({ x: 0, y: 0 });
  const longPressed = useRef(false);
  const pressed = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const playRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("lumen-play-pos");
    if (saved) {
      try { setPos(JSON.parse(saved)); } catch {}
    }
    setPositionRestored(true);
  }, []);

  useEffect(() => {
    if (!panel) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (playRef.current?.contains(target)) return;
      setPanel(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [panel]);

  function rightPanelOffset() {
    const shell = document.querySelector(".appShell");
    if (!shell?.classList.contains("rightPanelOpen") || window.innerWidth <= 800) return 0;
    return window.innerWidth <= 1100 ? 320 : 360;
  }

  function clamp(next: Point) {
    const size = 62;
    const panelOffset = rightPanelOffset();
    return {
      x: Math.min(Math.max(8 + panelOffset, next.x), window.innerWidth - size - 8),
      y: Math.min(Math.max(8, next.y), window.innerHeight - size - 8),
    };
  }

  function pointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = true;
    dragging.current = false;
    longPressed.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    const rect = e.currentTarget.getBoundingClientRect();
    origin.current = { x: rect.left + rightPanelOffset(), y: rect.top };

    timer.current = setTimeout(() => {
      if (!dragging.current) {
        longPressed.current = true;
        setPanel(v => !v);
      }
    }, 500);
  }

  function pointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!pressed.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (Math.hypot(dx, dy) < 6) return;
    dragging.current = true;
    if (timer.current) clearTimeout(timer.current);
    setPanel(false);
    setPos(clamp({ x: origin.current.x + dx, y: origin.current.y + dy }));
  }

  function pointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    pressed.current = false;
    if (timer.current) clearTimeout(timer.current);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    if (dragging.current) {
      if (pos) localStorage.setItem("lumen-play-pos", JSON.stringify(pos));
      return;
    }
    if (!longPressed.current) setPlaying(v => !v);
  }

  const style = pos
    ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
    : undefined;

  const panelStyle = pos
    ? { left: Math.max(8, Math.min(pos.x, window.innerWidth - 150)), top: Math.max(8, pos.y - 66), right: "auto", bottom: "auto" }
    : undefined;

  return (
    <>
      {panel && (
        <div ref={panelRef} className="floatingPanel compactPlaybackPanel" style={panelStyle}>
          <div className="compactPlaybackControl" title="Tekrar">
            <span className="compactIcon">↻</span>
            <input
              aria-label="Tekrar sayısı"
              type="number"
              min={1}
              max={999}
              value={repeatTarget}
              onFocus={e => e.currentTarget.select()}
              onClick={e => e.currentTarget.select()}
              onChange={e => setRepeatTarget(Number(e.target.value) || 1)}
            />
          </div>
          <div className="compactPlaybackControl" title="Hız">
            <span className="compactIcon">»</span>
            <select aria-label="Oynatma hızı" value={rate} onChange={e => setRate(Number(e.target.value))}>
              {[0.5,0.75,1,1.25,1.5,2].map(v => <option key={v} value={v}>{v}×</option>)}
            </select>
          </div>
        </div>
      )}

      <button
        ref={playRef}
        className={"floatingPlay " + (!positionRestored ? "floatingControlRestoring" : "")}
        style={style}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        title="Dokun: oynat/duraklat • Basılı tut: ayarlar • Sürükle: taşı"
      >
        {playing ? "❚❚" : "▶"}
        <span className="repeatBadge">{repeatTarget}</span>
      </button>
    </>
  );
}
