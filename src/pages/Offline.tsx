import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { COLLECTIONS, downloadChanges, downloadCollection, type CollectionKey, type Progress } from "../lib/offlineDownload";
import { clearOfflineData } from "../lib/offlineFetch";

const DONE_KEY = (k: string) => "lumen.offline.done." + k;
const readDone = (k: string) => { try { return localStorage.getItem(DONE_KEY(k)); } catch { return null; } };
const fmtMB = (b?: number) => (b ? (b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1) + " MB" : "—");

export function Offline() {
  const [busy, setBusy] = useState<CollectionKey | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const [done, setDone] = useState<Record<string, string | null>>(() => Object.fromEntries(COLLECTIONS.map((c) => [c.key, readDone(c.key)])));
  const [usage, setUsage] = useState<{ usage?: number; quota?: number }>({});
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [msg, setMsg] = useState("");
  const cancel = useRef({ cancel: false });

  const refreshUsage = () => { void navigator.storage?.estimate?.().then((e) => setUsage({ usage: e.usage, quota: e.quota })); };
  useEffect(() => {
    refreshUsage();
    void navigator.storage?.persisted?.().then(setPersisted);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);

  const run = async (keys: CollectionKey[], full = false) => {
    setMsg("");
    try { if (navigator.storage?.persist) setPersisted(await navigator.storage.persist()); } catch { /* yok say */ }
    cancel.current = { cancel: false };
    for (const k of keys) {
      if (cancel.current.cancel) break;
      setBusy(k); setProg({ done: 0, total: 1, failed: 0 });
      const prev = readDone(k);
      let t = new Date().toISOString();
      if (prev && !full) {
        // daha önce indirildi: yalnız farklar
        const r = await downloadChanges(k, prev, setProg);
        if (!r) { setMsg("İnternete ulaşılamadı."); break; }
        t = r.serverNow;
        setMsg(r.changed ? `${r.changed} değişiklik indirildi.` : "Her şey güncel, indirilecek değişiklik yok.");
      } else {
        await downloadCollection(k, setProg, cancel.current);
      }
      if (!cancel.current.cancel) {
        try { localStorage.setItem(DONE_KEY(k), t); } catch { /* yok say */ }
        setDone((s) => ({ ...s, [k]: t }));
      }
      refreshUsage();
    }
    setBusy(null); setProg(null);
  };
  const clearAll = async () => {
    if (!window.confirm("Cihaza indirilen bütün içerik silinsin mi? (Hesabındaki veriler silinmez.)")) return;
    await clearOfflineData();
    for (const c of COLLECTIONS) { try { localStorage.removeItem(DONE_KEY(c.key)); } catch { /* yok say */ } }
    setDone({});
    refreshUsage();
  };

  return (
    <>
      <PageHeader back title="Çevrimdışı ve eşitleme" subtitle={online ? "Çevrimiçi" : "Çevrimdışı"} />
      <div className="infoline">
        Açtığın her sayfa zaten cihazda saklanıyor ve internet yokken de açılıyor. Bir bölümün tamamını önceden indirmek için aşağıdan indir.
      </div>
      <div className="clist" style={{ marginTop: 8 }}>
        {COLLECTIONS.map((c) => {
          const isBusy = busy === c.key;
          const when = done[c.key];
          return (
            <div key={c.key} className="crow" style={{ alignItems: "center" }}>
              <span className="cmain">
                <b style={{ fontSize: 16 }}>{c.title}</b>
                <span>
                  {isBusy && prog ? `İndiriliyor… ${prog.done} / ${prog.total}` : when ? `İndirildi · ${new Date(when).toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}` : "İndirilmedi"}
                </span>
                {isBusy && prog && <div className="tbar" style={{ marginTop: 6 }}><i style={{ width: `${Math.min(100, (prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div>}
              </span>
              <button className="bmup" disabled={!!busy || !online} onClick={() => void run([c.key])}>{when ? "Güncelle" : "İndir"}</button>
            </div>
          );
        })}
      </div>
      <div style={{ padding: "12px 16px", display: "grid", gap: 10 }}>
        {busy
          ? <button className="secondary" onClick={() => { cancel.current.cancel = true; }}>Durdur</button>
          : <button className="primary" disabled={!online} onClick={() => void run(COLLECTIONS.map((c) => c.key))}>{COLLECTIONS.every((c) => done[c.key]) ? "Hepsini güncelle (yalnız farklar)" : "Hepsini indir"}</button>}
        {msg && <div className="small" style={{ color: "var(--accent)" }}>{msg}</div>}
        <div className="small muted">
          Cihazda kullanılan: {fmtMB(usage.usage)}{usage.quota ? ` / ${fmtMB(usage.quota)}` : ""}
          {persisted === true ? " · kalıcı depolama açık" : persisted === false ? " · tarayıcı yer azalınca silebilir" : ""}
        </div>
        <div className="small muted">Kur'an yaklaşık 5 MB, İbadet 10 MB, Risale-i Nur 25 MB, HE Eserleri 50 MB yer kaplar. İnternetsizken yapılan kayıtlar (sayaç, ayraç, görev) için şimdilik internet gerekir.</div>
        <button className="secondary" disabled={!!busy || !online} onClick={() => void run(COLLECTIONS.map((c) => c.key), true)}>Baştan tamamen indir</button>
        <button className="secondary" disabled={!!busy} onClick={() => void clearAll()} style={{ color: "var(--danger)" }}>Çevrimdışı verileri sil</button>
      </div>
    </>
  );
}
