"use client";
import { useEffect, useRef, useState } from "react";
import { FullscreenTasbih } from "@/components/FullscreenTasbih";

export function FloatingCounterButton({
  title = "Tesbih",
  target = 0,
  count,
  onIncrement,
  onDecrement,
  onReset,
  positionKey = "default",
}: {
  title?: string;
  target?: number;
  count?: number;
  onIncrement?: () => void | Promise<void>;
  onDecrement?: () => void | Promise<void>;
  onReset?: () => void | Promise<void>;
  positionKey?: string;
}) {
  const controlled = typeof count === "number";
  const [localCount, setLocalCount] = useState(0);
  const [pos, setPos] = useState<{x:number;y:number}|null>(null);
  const [positionRestored, setPositionRestored] = useState(false);
  const [resetMenu, setResetMenu] = useState(false);
  const pressed = useRef(false);
  const dragging = useRef(false);
  const longPressed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({x:0,y:0});
  const origin = useRef({x:0,y:0});
  const resetRef = useRef<HTMLButtonElement | null>(null);
  const counterRef = useRef<HTMLButtonElement | null>(null);

  const effectiveCount = controlled ? (count ?? 0) : localCount;

  useEffect(() => {
    const savedPos = localStorage.getItem("lumen-counter-pos-" + positionKey);
    const savedCount = localStorage.getItem("lumen-read-counter");
    if (savedPos) {
      try { setPos(JSON.parse(savedPos)); } catch {}
    }
    if (!controlled && savedCount) setLocalCount(Number(savedCount) || 0);
    setPositionRestored(true);
  }, [controlled, positionKey]);

  useEffect(() => {
    if (!resetMenu) return;
    const close = (event: PointerEvent) => {
      const targetNode = event.target as Node;
      if (resetRef.current?.contains(targetNode)) return;
      if (counterRef.current?.contains(targetNode)) return;
      setResetMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [resetMenu]);

  function rightPanelOffset() {
    const shell = document.querySelector(".appShell");
    if (!shell?.classList.contains("rightPanelOpen") || window.innerWidth <= 800) return 0;
    return window.innerWidth <= 1100 ? 320 : 360;
  }

  function clamp(next:{x:number;y:number}) {
    const size = 78;
    const panelOffset = rightPanelOffset();
    return {
      x: Math.min(Math.max(8 + panelOffset,next.x),window.innerWidth-size-8),
      y: Math.min(Math.max(8,next.y),window.innerHeight-size-8),
    };
  }

  async function increment() {
    if (onIncrement) {
      await onIncrement();
      return;
    }
    setLocalCount(current => {
      const next = target > 0 ? Math.min(target, current + 1) : current + 1;
      localStorage.setItem("lumen-read-counter",String(next));
      return next;
    });
  }

  async function decrement() {
    if (onDecrement) {
      await onDecrement();
      return;
    }
    setLocalCount(current => {
      const next = Math.max(0,current-1);
      localStorage.setItem("lumen-read-counter",String(next));
      return next;
    });
  }

  async function reset() {
    if (onReset) await onReset();
    else {
      setLocalCount(0);
      localStorage.setItem("lumen-read-counter","0");
    }
    setResetMenu(false);
  }

  function down(e:React.PointerEvent<HTMLButtonElement>) {
    pressed.current = true;
    dragging.current = false;
    longPressed.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = {x:e.clientX,y:e.clientY};
    const rect = e.currentTarget.getBoundingClientRect();
    origin.current = {x:rect.left + rightPanelOffset(),y:rect.top};

    timer.current = setTimeout(() => {
      if (!dragging.current) {
        longPressed.current = true;
        setResetMenu(true);
      }
    },650);
  }

  function move(e:React.PointerEvent<HTMLButtonElement>) {
    if (!pressed.current) return;
    const dx=e.clientX-start.current.x;
    const dy=e.clientY-start.current.y;
    if (Math.hypot(dx,dy)<6) return;
    dragging.current=true;
    setResetMenu(false);
    if (timer.current) clearTimeout(timer.current);
    setPos(clamp({x:origin.current.x+dx,y:origin.current.y+dy}));
  }

  function up(e:React.PointerEvent<HTMLButtonElement>) {
    pressed.current=false;
    if (timer.current) clearTimeout(timer.current);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}

    if (dragging.current) {
      if (pos) localStorage.setItem("lumen-counter-pos-" + positionKey,JSON.stringify(pos));
      return;
    }

    if (!longPressed.current) void increment();
  }

  const popoverStyle = pos
    ? {left:Math.max(8,pos.x),top:Math.max(8,pos.y-48),right:"auto",bottom:"auto"}
    : undefined;

  return (
    <>
      <FullscreenTasbih
        title={title}
        count={effectiveCount}
        target={target}
        onIncrement={() => void increment()}
        onDecrement={() => void decrement()}
      />

      {resetMenu && (
        <button
          ref={resetRef}
          className="counterResetPopover"
          style={popoverStyle}
          onClick={() => void reset()}
        >
          Sıfırla
        </button>
      )}

      <button
        ref={counterRef}
        className={"legacyCounter readCounter " + (!positionRestored ? "floatingControlRestoring" : "")}
        style={pos ? {left:pos.x,top:pos.y,right:"auto",bottom:"auto"} : undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        title="Dokun: say • Basılı tut: sıfırla • Sürükle: taşı"
      >
        <span>{effectiveCount}</span>
        {target > 0 && <small>/ {target}</small>}
      </button>
    </>
  );
}
