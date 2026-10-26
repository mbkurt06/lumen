import { useState } from "react";

// window.prompt yerine uygulama içi tek satırlık giriş penceresi.
export function AskDialog({ title, placeholder, onSubmit, onClose }: { title: string; placeholder?: string; onSubmit: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState("");
  const go = () => { if (v.trim()) { onSubmit(v.trim()); onClose(); } };
  return (
    <>
      <div className="scrim show" style={{ zIndex: 40 }} onClick={onClose} />
      <div className="dialog">
        <div className="cardtitle">{title}</div>
        <input className="field" style={{ width: "100%", marginTop: 12 }} autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <div className="seg">
          <button onClick={onClose}>Vazgeç</button>
          <button className="on" onClick={go}>Tamam</button>
        </div>
      </div>
    </>
  );
}
