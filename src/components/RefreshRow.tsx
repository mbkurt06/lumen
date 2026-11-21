import { useState } from "react";
import { Icon } from "./Icon";
import type { RefreshProgress } from "../lib/offlineFetch";

/* Kütüphane sayfalarının üstündeki "güncelle" satırı: bu sayfadaki her şeyi veri tabanındaki
   güncel hâliyle yeniler (telefondaki eski kopyanın yerine), bitince sayfayı yeniden açar. */
export function RefreshRow({ label, run }: { label: string; run: (onProgress: (p: RefreshProgress) => void) => Promise<RefreshProgress> }) {
  const [p, setP] = useState<RefreshProgress | null>(null);
  const [msg, setMsg] = useState("");
  const go = async () => {
    if (p) return;
    if (!navigator.onLine) { setMsg("İnternet yokken güncellenemez"); return; }
    setMsg(""); setP({ done: 0, total: 0, failed: 0 });
    try {
      const r = await run(setP);
      if (r.total > 0 && r.failed === r.total) { setMsg("Güncellenemedi, internet bağlantısını kontrol et"); setP(null); return; }
      window.location.reload();
    } catch { setMsg("Güncellenemedi, internet bağlantısını kontrol et"); setP(null); }
  };
  return (
    <div className="refrow">
      <button onClick={() => void go()} disabled={!!p}>
        <Icon name="sync" size={18} />
        <span>{p ? (p.total ? `Güncelleniyor… ${p.done} / ${p.total}` : "Güncelleniyor…") : label}</span>
      </button>
      {p && p.total > 0 && <div className="tbar"><i style={{ width: `${(p.done / p.total) * 100}%` }} /></div>}
      {msg && <div className="small" style={{ color: "var(--danger)", marginTop: 4 }}>{msg}</div>}
    </div>
  );
}
