import { useEffect, useRef, useState } from "react";

/* Eski Lumen sayacı: dokun → say, basılı tut → Sıfırla, sürükle → taşı (yer hatırlanır). */
export function FloatCounter({ count, target, onInc, onReset, posKey = "default" }: {
  count: number; target: number; onInc: () => void; onReset: () => void; posKey?: string;
}) {
  const key = "lumen.counterpos." + posKey;
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const [menu, setMenu] = useState(false);
  const st = useRef({ pressed: false, drag: false, long: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const timer = useRef<number | undefined>(undefined);
  const clamp = (p: { x: number; y: number }) => ({ x: Math.min(Math.max(8, p.x), window.innerWidth - 86), y: Math.min(Math.max(8, p.y), window.innerHeight - 86) });

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    const t = window.setTimeout(() => document.addEventListener("pointerdown", close, { once: true }), 0);
    return () => { window.clearTimeout(t); document.removeEventListener("pointerdown", close); };
  }, [menu]);

  return (
    <>
      {menu && (
        <button className="cntreset" style={pos ? { left: pos.x, top: Math.max(8, pos.y - 50) } : undefined} onPointerDown={(e) => e.stopPropagation()} onClick={() => { onReset(); setMenu(false); }}>Sıfırla</button>
      )}
      <button
        className={"floatcnt" + (target > 0 && count >= target ? " done" : "")}
        style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          st.current = { pressed: true, drag: false, long: false, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
          e.currentTarget.setPointerCapture(e.pointerId);
          timer.current = window.setTimeout(() => { if (!st.current.drag) { st.current.long = true; setMenu(true); } }, 650);
        }}
        onPointerMove={(e) => {
          const s = st.current;
          if (!s.pressed) return;
          const dx = e.clientX - s.sx, dy = e.clientY - s.sy;
          if (Math.hypot(dx, dy) < 6) return;
          s.drag = true;
          window.clearTimeout(timer.current);
          setPos(clamp({ x: s.ox + dx, y: s.oy + dy }));
        }}
        onPointerUp={(e) => {
          const s = st.current;
          s.pressed = false;
          window.clearTimeout(timer.current);
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* yok say */ }
          if (s.drag) { try { localStorage.setItem(key, JSON.stringify(pos)); } catch { /* yok say */ } return; }
          if (!s.long) onInc();
        }}
        title="Dokun: say • Basılı tut: sıfırla • Sürükle: taşı"
      >
        <span>{count}</span>
        {target > 0 && <small>/ {target}</small>}
      </button>
    </>
  );
}

/* Tam ekran tesbih: ekrana dokun → say; −1 basılı tut; × çık. */
export function FullTasbih({ title, count, target, onInc, onDec, onClose }: { title: string; count: number; target: number; onInc: () => void; onDec: () => void; onClose: () => void }) {
  return (
    <section className={"tasbihfs" + (target && count >= target ? " done" : "")} onClick={onInc}>
      <button className="tfx" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Kapat">×</button>
      <div className="tfc">
        <div className="tft">{title}</div>
        <div className="tfn">{target > 0 ? `${target}/${count}` : count}</div>
      </div>
      <button
        className="tfm"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => { e.stopPropagation(); const b = e.currentTarget; b.dataset.t = String(window.setTimeout(onDec, 550)); }}
        onPointerUp={(e) => { e.stopPropagation(); window.clearTimeout(Number(e.currentTarget.dataset.t || 0)); }}
        onPointerLeave={(e) => window.clearTimeout(Number(e.currentTarget.dataset.t || 0))}
      >−1</button>
    </section>
  );
}
