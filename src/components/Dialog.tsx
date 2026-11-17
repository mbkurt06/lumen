import { useState } from "react";

// window.prompt yerine uygulama içi tek satırlık giriş penceresi.
export function AskDialog({ title, placeholder, initial, onSubmit, onClose, onDelete }: { title: string; placeholder?: string; initial?: string; onSubmit: (v: string) => void; onClose: () => void; onDelete?: () => void }) {
  const [v, setV] = useState(initial ?? "");
  const go = () => { if (v.trim()) { onSubmit(v.trim()); onClose(); } };
  return (
    <>
      <div className="scrim show" style={{ zIndex: 40 }} onClick={onClose} />
      <div className="dialog">
        <div className="cardtitle">{title}</div>
        <input className="field" style={{ width: "100%", marginTop: 12 }} autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <div className="seg">
          {onDelete && <button onClick={onDelete} style={{ color: "var(--danger)" }}>Sil</button>}
          <button onClick={onClose}>Vazgeç</button>
          <button className="on" onClick={go}>Tamam</button>
        </div>
      </div>
    </>
  );
}
