"use client";
import { useEffect, useState } from "react";

export function FullscreenTasbih({
  title,
  count,
  target,
  onIncrement,
  onDecrement,
}: {
  title: string;
  count: number;
  target?: number | null;
  onIncrement: () => void;
  onDecrement?: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openTasbih = () => setOpen(true);
    window.addEventListener("lumen-open-fullscreen-tasbih", openTasbih);
    return () => window.removeEventListener("lumen-open-fullscreen-tasbih", openTasbih);
  }, []);

  return (
    <>
      <button
        className="fullscreenTasbihLauncher"
        onClick={() => setOpen(true)}
        aria-label="Tam ekran tesbih"
        title="Tam ekran tesbih"
      >
        ⛶
      </button>

      {open && (
        <section
          className={"tasbihFullscreen " + (target && count >= target ? "done" : "")}
          onClick={onIncrement}
        >
          <button
            className="tasbihExit"
            onClick={e => {
              e.stopPropagation();
              setOpen(false);
            }}
          >
            ×
          </button>

          <div className="tasbihFullscreenCenter">
            <div className="tasbihFullscreenTitle">{title}</div>
            <div className="tasbihFullscreenCount">
              {target && target > 0 ? target + "/" + count : String(count)}
            </div>          </div>

          {onDecrement && (
            <button
              className="tasbihMinus"
              onClick={e => e.stopPropagation()}
              onPointerDown={e => {
                e.stopPropagation();
                const button = e.currentTarget;
                const timer = window.setTimeout(() => onDecrement(), 550);
                button.dataset.timer = String(timer);
              }}
              onPointerUp={e => {
                e.stopPropagation();
                const timer = Number(e.currentTarget.dataset.timer || 0);
                if (timer) window.clearTimeout(timer);
              }}
              onPointerLeave={e => {
                const timer = Number(e.currentTarget.dataset.timer || 0);
                if (timer) window.clearTimeout(timer);
              }}
            >
              −1
            </button>
          )}
        </section>
      )}
    </>
  );
}
