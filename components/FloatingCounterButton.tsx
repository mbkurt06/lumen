"use client";
import { useEffect, useRef, useState } from "react";

export function FloatingCounterButton() {
  const [count, setCount] = useState(0);
  const [pos, setPos] = useState<{x:number;y:number}|null>(null);
  const [resetMenu, setResetMenu] = useState(false);
  const pressed = useRef(false);
  const dragging = useRef(false);
  const longPressed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({x:0,y:0});
  const origin = useRef({x:0,y:0});

  useEffect(() => {
    const savedPos = localStorage.getItem("lumen-counter-pos");
    const savedCount = localStorage.getItem("lumen-read-counter");
    if (savedPos) {
      try { setPos(JSON.parse(savedPos)); } catch {}
    }
    if (savedCount) setCount(Number(savedCount) || 0);
  }, []);

  function clamp(next:{x:number;y:number}) {
    const size = 78;
    return {
      x: Math.min(Math.max(8,next.x),window.innerWidth-size-8),
      y: Math.min(Math.max(8,next.y),window.innerHeight-size-8),
    };
  }

  function down(e:React.PointerEvent<HTMLButtonElement>) {
    pressed.current = true;
    dragging.current = false;
    longPressed.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = {x:e.clientX,y:e.clientY};
    const rect = e.currentTarget.getBoundingClientRect();
    origin.current = {x:rect.left,y:rect.top};

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
      if (pos) localStorage.setItem("lumen-counter-pos",JSON.stringify(pos));
      return;
    }

    if (!longPressed.current) {
      const next=count+1;
      setCount(next);
      localStorage.setItem("lumen-read-counter",String(next));
    }
  }

  function reset() {
    setCount(0);
    localStorage.setItem("lumen-read-counter","0");
    setResetMenu(false);
  }

  const popoverStyle = pos
    ? {left:Math.max(8,pos.x),top:Math.max(8,pos.y-48),right:"auto",bottom:"auto"}
    : undefined;

  return (
    <>
      {resetMenu && (
        <button className="counterResetPopover" style={popoverStyle} onClick={reset}>
          Sıfırla
        </button>
      )}

      <button
        className="legacyCounter readCounter"
        style={pos ? {left:pos.x,top:pos.y,right:"auto",bottom:"auto"} : undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        title="Dokun: say • Basılı tut: sıfırla • Sürükle: taşı"
      >
        <span>{count}</span>
      </button>
    </>
  );
}
