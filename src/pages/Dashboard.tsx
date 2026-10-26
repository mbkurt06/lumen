import { PageHeader } from "../components/PageHeader";

function dateLine() {
  const now = new Date();
  const g = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(now);
  let h = "";
  try {
    h = new Intl.DateTimeFormat("tr-TR-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" }).format(now);
  } catch {
    /* hicri takvim desteklenmiyorsa atla */
  }
  return h ? `${g} · ${h}` : g;
}

export function Dashboard() {
  return (
    <>
      <PageHeader title="Merhaba" subtitle={dateLine()} />
      <div className="card" style={{ margin: "12px 16px" }}>
        <div className="cardtitle">Omurga hazır</div>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Sol menü, alt gezinti, giriş ve güncelleme çalışıyor. Dashboard kartları (namaz vakti, bugün, tesbihat, ezber, Nova, kaldığın yerler) sıradaki adımlarda gelecek.
        </p>
      </div>
    </>
  );
}
