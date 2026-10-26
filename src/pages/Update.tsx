import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { CURRENT, checkForUpdate, isNative, type UpdateResult } from "../lib/update";

export function Update() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);

  async function check() {
    setBusy(true);
    setResult(await checkForUpdate());
    setBusy(false);
  }

  return (
    <>
      <PageHeader title="Güncelleme" subtitle="Sürüm ve hakkında" />
      <div className="card" style={{ margin: "12px 16px" }}>
        <div className="cardtitle">Bu sürüm</div>
        <dl className="kv">
          <dt>Sürüm</dt>
          <dd>v{CURRENT.version}</dd>
          <dt>Derleme</dt>
          <dd>{CURRENT.build}</dd>
          <dt>Tarih</dt>
          <dd>{new Date(CURRENT.builtAt).toLocaleString("tr-TR")}</dd>
          <dt>Platform</dt>
          <dd>{isNative() ? "Android uygulaması" : "Web"}</dd>
        </dl>
        <button className="primary" onClick={check} disabled={busy}>{busy ? "Denetleniyor…" : "Güncellemeyi denetle"}</button>
        {result?.state === "current" && <p className="ok">Güncelsin.</p>}
        {result?.state === "available" && (
          <div>
            <p className="ok">Yeni sürüm var (derleme {result.latest.build}).</p>
            <button className="primary" onClick={() => location.reload()}>Yenile ve güncelle</button>
          </div>
        )}
        {result?.state === "native-pending" && <p className="muted">Android uygulama içi güncelleme sonraki adımda bağlanacak.</p>}
        {result?.state === "error" && <p className="error">{result.message}</p>}
      </div>
    </>
  );
}
