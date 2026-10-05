"use client";
import { useRef, useState } from "react";

export function FloatingPlaybackButton() {
  const [playing, setPlaying] = useState(false);
  const [panel, setPanel] = useState(false);
  const [repeatTarget, setRepeatTarget] = useState(10);
  const [rate, setRate] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  function pointerDown() {
    longPressed.current = false;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      setPanel(v => !v);
    }, 450);
  }

  function pointerUp() {
    if (timer.current) clearTimeout(timer.current);
    if (!longPressed.current) setPlaying(v => !v);
  }

  return (
    <>
      {panel && (
        <div className="floatingPanel">
          <strong>Oynatma ayarları</strong>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <label>
              Tekrar sayısı
              <input
                className="input"
                type="number"
                min={1}
                max={999}
                value={repeatTarget}
                onChange={e => setRepeatTarget(Number(e.target.value) || 1)}
              />
            </label>
            <label>
              Hız
              <select
                className="input"
                value={rate}
                onChange={e => setRate(Number(e.target.value))}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map(v => (
                  <option key={v} value={v}>{v}×</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      <button
        className="floatingPlay"
        onPointerDown={pointerDown}
        onPointerUp={pointerUp}
        onPointerLeave={() => timer.current && clearTimeout(timer.current)}
        title="Tıkla: oynat/duraklat • Basılı tut: tekrar ve hız"
      >
        {playing ? "❚❚" : "▶"}
        <span className="repeatBadge">{repeatTarget}</span>
      </button>
    </>
  );
}
