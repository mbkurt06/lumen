import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  CURRENT,
  apkDownloadUrl,
  checkForUpdate,
  fetchLatestApk,
  installApk,
  installedApkInfo,
  isNative,
  type ApkRelease,
  type UpdateResult,
} from "../lib/update";

export function Update() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [native, setNative] = useState<{ version: string; code: string } | null>(null);
  const [webApk, setWebApk] = useState<ApkRelease | null>(null);

  useEffect(() => {
    installedApkInfo().then(setNative);
    if (!isNative()) fetchLatestApk().then(setWebApk);
  }, []);

  async function check() {
    setBusy(true);
    setMsg("");
    setResult(await checkForUpdate());
    setBusy(false);
  }

  async function install(r: ApkRelease) {
    setBusy(true);
    setMsg("");
    setPct(0);
    try {
      const s = await installApk(r, setPct);
      setMsg(s === "needs-permission" ? "Açılan ekranda Lumen için “Bu kaynaktan izin ver”i aç, geri dönüp tekrar dene." : "İndirildi; kurulum ekranı açıldı.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
    setPct(null);
    setBusy(false);
  }

  async function downloadApk(r: ApkRelease) {
    try {
      window.location.href = await apkDownloadUrl(r.file);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <PageHeader title="Güncelleme" subtitle="Sürüm ve hakkında" />
      <div className="card" style={{ margin: "12px 16px" }}>
        <div className="cardtitle">Bu sürüm</div>
        <dl className="kv">
          <dt>Sürüm</dt>
          <dd>v{native?.version ?? CURRENT.version}</dd>
          <dt>{native ? "Sürüm kodu" : "Derleme"}</dt>
          <dd>{native?.code ?? CURRENT.build}</dd>
          {!native && (
            <>
              <dt>Tarih</dt>
              <dd>{new Date(CURRENT.builtAt).toLocaleString("tr-TR")}</dd>
            </>
          )}
          <dt>Platform</dt>
          <dd>{native ? "Android uygulaması" : "Web"}</dd>
        </dl>
        <button className="primary" onClick={check} disabled={busy}>{busy && pct === null ? "Denetleniyor…" : "Güncellemeyi denetle"}</button>
        {result?.state === "current" && <p className="ok">Güncelsin.</p>}
        {result?.state === "none-published" && <p className="muted">Henüz yayınlanmış bir Android sürümü yok.</p>}
        {result?.state === "available" && (
          <div>
            <p className="ok">Yeni sürüm var (derleme {result.latest.build}).</p>
            <button className="primary" onClick={() => location.reload()}>Yenile ve güncelle</button>
          </div>
        )}
        {result?.state === "apk-available" && (
          <div>
            <p className="ok">Yeni sürüm var: v{result.release.versionName} ({result.release.versionCode}).</p>
            <button className="primary" onClick={() => install(result.release)} disabled={busy}>
              {pct !== null ? `İndiriliyor… %${pct}` : "İndir ve kur"}
            </button>
          </div>
        )}
        {result?.state === "error" && <p className="error">{result.message}</p>}
        {msg && <p className="muted">{msg}</p>}
      </div>

      {!native && webApk && (
        <div className="card" style={{ margin: "12px 16px" }}>
          <div className="cardtitle">Android uygulaması</div>
          <p className="muted" style={{ margin: "6px 0 12px" }}>
            En son sürüm: v{webApk.versionName} ({webApk.versionCode}). Telefonda bu sayfayı açıp indirebilirsin.
          </p>
          <button className="primary" onClick={() => downloadApk(webApk)}>APK’yı indir</button>
        </div>
      )}
    </>
  );
}
