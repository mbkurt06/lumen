import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { COLLECTIONS, downloadChanges, downloadCollection, refreshLibrary, type CollectionKey, type Progress } from "../lib/offlineDownload";
import { cacheInfo, clearOfflineData, looksOffline, netLog, syncWrites, type NetLog } from "../lib/offlineFetch";
import { failedWrites, onWritesChange, pendingWrites } from "../lib/writeQueue";

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
  const [pend, setPend] = useState(pendingWrites);
  useEffect(() => onWritesChange(() => setPend(pendingWrites())), []);
  const failed = failedWrites();
  const [diag, setDiag] = useState<{ log: NetLog[]; info: { caches: boolean; entries: number }; onLine: boolean; off: boolean } | null>(null);
  const showDiag = async () => setDiag({ log: [...netLog], info: await cacheInfo(), onLine: navigator.onLine, off: looksOffline() });

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
  const [rprog, setRprog] = useState<Progress | null>(null);
  const refreshAll = async () => {
    setMsg("");
    setRprog({ done: 0, total: 1, failed: 0 });
    try {
      const r = await refreshLibrary(setRprog);
      setMsg(r.total === 0 ? "Cihazda yenilenecek kayıt yok." : r.failed ? `${r.done - r.failed} / ${r.total} kayıt yenilendi, ${r.failed} kayıt alınamadı.` : `${r.total} kayıt güncel hâliyle yenilendi.`);
    } catch { setMsg("İnternete ulaşılamadı."); }
    setRprog(null);
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
      <div className="card" style={{ margin: "8px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1 }}>
          <b>Gönderilmeyi bekleyen</b>
          <span className="muted small" style={{ display: "block" }}>{pend ? `${pend} değişiklik telefonda, internet gelince hesaba gönderilecek` : "Bütün değişiklikler hesaba gönderildi"}</span>
          {failed.length > 0 && <span className="small" style={{ display: "block", color: "var(--danger)" }}>{failed.length} değişiklik sunucuda kabul edilmedi (silinmiş bir kayda ait olabilir)</span>}
        </span>
        {pend > 0 && <button className="bmup" disabled={!online} onClick={() => void syncWrites()}>Şimdi gönder</button>}
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
        <div className="small muted">Kur'an yaklaşık 5 MB, İbadet 10 MB, Risale-i Nur 25 MB, HE Eserleri 50 MB yer kaplar. Tesbih sayaçları, ayraçlar, görevler, notlar, okundu işaretleri ve namaz/kaza kayıtları internetsiz de telefona kaydedilir; bağlantı gelince sırayla hesaba gönderilir.</div>
        <button className="secondary" disabled={!!busy || !!rprog || !online} onClick={() => void refreshAll()}>
          {rprog ? `Yenileniyor… ${rprog.done} / ${rprog.total}` : "Kütüphaneyi yenile (cihazdaki her şey)"}
        </button>
        <div className="small muted" style={{ marginTop: -4 }}>Cihazdaki kitapları veri tabanındaki güncel hâliyle değiştirir (düzeltilen yazım hataları gibi). Kütüphanedeki her sayfanın en üstünde de “güncelle” var (bölüm ya da kitap için), okurken ⊞ menüsünde de.</div>
        <button className="secondary" disabled={!!busy || !online} onClick={() => void run(COLLECTIONS.map((c) => c.key), true)}>Baştan tamamen indir</button>
        <button className="secondary" disabled={!!busy} onClick={() => void clearAll()} style={{ color: "var(--danger)" }}>Çevrimdışı verileri sil</button>
        <button className="secondary" onClick={() => void showDiag()}>Tanılama (son istekler)</button>
        {diag && (
          <div className="card" style={{ fontSize: 12, padding: 10 }}>
            <div>Tarayıcı çevrimiçi diyor: <b>{diag.onLine ? "evet" : "hayır"}</b> · Uygulama çevrimdışı sayıyor: <b>{diag.off ? "evet" : "hayır"}</b></div>
            <div>Cihaz deposu: <b>{diag.info.caches ? "var" : "YOK"}</b> · Kayıtlı yanıt: <b>{diag.info.entries}</b></div>
            <div style={{ marginTop: 6, maxHeight: 320, overflowY: "auto", fontFamily: "ui-monospace, monospace" }}>
              {diag.log.length === 0 && <div className="muted">Henüz istek yok. Bir kitap açıp buraya geri gel.</div>}
              {diag.log.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 6, borderTop: "1px solid var(--border)", padding: "2px 0" }}>
                  <span style={{ width: 52, textAlign: "right", color: l.ms > 1500 ? "var(--danger)" : "var(--muted)" }}>{l.ms} ms</span>
                  <span style={{ width: 78 }}>{l.how}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.path}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
