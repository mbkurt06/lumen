import { useCP } from "../lib/counterPrefs";
import { useTP } from "../lib/taskPrefs";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { clearOfflineData } from "../lib/offlineFetch";
import { useTheme, type ThemeMode } from "../lib/theme";
import { CURRENT } from "../lib/update";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "dark", label: "Koyu" },
  { id: "light", label: "Açık" },
  { id: "system", label: "Telefona uy" },
];

const LINKS = [
  { to: "/cihazlar", label: "Cihazlarım", icon: "phone" },
  { to: "/esitleme", label: "Çevrimdışı ve eşitleme", icon: "sync" },
  { to: "/guncelleme", label: "Güncelleme · Hakkında", icon: "download", meta: "v" + CURRENT.version },
];

export function Settings() {
  const { mode, setMode } = useTheme();
  const { session } = useAuth();
  return (
    <>
      <PageHeader title="Ayarlar" />
      <div className="card" style={{ margin: "12px 16px" }}>
        <div className="cardtitle">Tema</div>
        <div className="seg" role="radiogroup" aria-label="Tema">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <TaskSettings />
      <CounterSettings />

      <div className="card list" style={{ margin: "12px 16px", padding: 6 }}>
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="drow">
            <span className="dicon"><Icon name={l.icon} /></span>
            <span className="dtext"><span className="dlabel">{l.label}</span></span>
            {l.meta && <span className="dmeta">{l.meta}</span>}
            <span className="dmeta"><Icon name="chevron" size={18} /></span>
          </Link>
        ))}
      </div>

      <div className="card" style={{ margin: "12px 16px" }}>
        <div className="cardtitle">Hesap</div>
        <p className="muted small" style={{ margin: "4px 0 12px" }}>{session?.user.email}</p>
        <button className="secondary" onClick={() => { void clearOfflineData(); void supabase.auth.signOut(); }}>Çıkış yap</button>
      </div>

      <p className="muted small" style={{ margin: "4px 20px 24px" }}>Bildirimler, Namaz, Okuma ve Google ayarları ilgili sayfalar geliştirilirken eklenecek.</p>
    </>
  );
}

/* Sayaçlar: yanlışlıkla basmaya karşı kilit (titreşim ayarları da buraya gelecek) */
/* Görev ayarları: hesapta saklanır (bütün cihazlarda aynı). Kullandıkça hangisi işe yarıyor, buradan açıp kapatılır. */
function TaskSettings() {
  const [p, set] = useTP();
  const Tog = ({ k, label, hint }: { k: "allowSkip" | "catchUp" | "showYesterday" | "resumeRange" | "missedOpen" | "suggestDaily" | "defaultStrict"; label: string; hint?: string }) => (
    <div className="srow"><span>{label}{hint && <small className="muted" style={{ display: "block", fontSize: 12, marginTop: 2 }}>{hint}</small>}</span><button className={"tgl" + (p[k] ? " on" : "")} onClick={() => set({ ...p, [k]: !p[k] })} aria-pressed={p[k]}><i /></button></div>
  );
  return (
    <div className="card" style={{ margin: "12px 16px" }}>
      <div className="cardtitle">Görevler</div>
      <p className="muted small" style={{ margin: "4px 0 6px" }}>Zorunlu ve takip görevlerinin davranışı. Bütün cihazlarda aynı.</p>
      <div className="srow col"><span>Yeni görevin türü</span>
        <div className="seg" style={{ marginTop: 6 }}>
          <button className={!p.defaultStrict ? "on" : ""} onClick={() => set({ ...p, defaultStrict: false })}>Takip</button>
          <button className={p.defaultStrict ? "on" : ""} onClick={() => set({ ...p, defaultStrict: true })}>Zorunlu</button>
        </div>
      </div>
      <div className="cardsub">Zorunlu görevler</div>
      <div className="srow col"><span>Kaçan günler Günüm'de</span>
        <div className="seg" style={{ marginTop: 6 }}>
          <button className={p.missedGroup === "tek" ? "on" : ""} onClick={() => set({ ...p, missedGroup: "tek" })}>Tek satırda topla</button>
          <button className={p.missedGroup === "ayri" ? "on" : ""} onClick={() => set({ ...p, missedGroup: "ayri" })}>Her gün ayrı satır</button>
        </div>
      </div>
      <Tog k="missedOpen" label="“Tamamlanmamış” bölümü açık başlasın" />
      <Tog k="allowSkip" label="“Atla” düğmesi" hint="Kaçan dönem atlanınca geçmişte “atlandı” olarak kalır" />
      <div className="cardsub">Takip görevleri</div>
      <Tog k="catchUp" label="Telafi" hint="Dünün eksiği bugünün hedefine eklenir (en fazla bir günlük hedef kadar)" />
      <Tog k="showYesterday" label="Dünkü sonucu göster" hint="Görev satırında “dün 3/5”" />
      <div className="cardsub">Sayfa aralığı</div>
      <Tog k="resumeRange" label="Yarım kalan aralığa ertesi gün kaldığı yerden devam" hint="Kapalıyken her gün aralığın başından açılır" />
      <Tog k="suggestDaily" label="Tarih aralığında günlük öneri" hint="“Yetişmek için günde ~4 sayfa”" />
    </div>
  );
}

function CounterSettings() {
  const [p, set] = useCP();
  const Tog = ({ k, label }: { k: "lockKaza" | "lockTesbih"; label: string }) => (
    <div className="srow"><span>{label}</span><button className={"tgl" + (p[k] ? " on" : "")} onClick={() => set({ ...p, [k]: !p[k] })} aria-pressed={p[k]}><i /></button></div>
  );
  return (
    <div className="card" style={{ margin: "12px 16px" }}>
      <div className="cardtitle">Sayaçlar</div>
      <p className="muted small" style={{ margin: "4px 0 6px" }}>Yanlışlıkla basmaya karşı kilit. Bu cihaz için geçerli.</p>
      <Tog k="lockKaza" label="Kaza sayfası kilitli açılsın" />
      <Tog k="lockTesbih" label="Tesbih sayaçlarında kilit" />
      <div className="srow col"><span>Otomatik kilit</span>
        <div className="seg" style={{ marginTop: 6 }}>
          {[15, 30, 60, 120, 0].map((n) => (<button key={n} className={p.autoLockSec === n ? "on" : ""} onClick={() => set({ ...p, autoLockSec: n })}>{n === 0 ? "Kapalı" : n < 60 ? `${n} sn` : `${n / 60} dk`}</button>))}
        </div>
      </div>
      <div className="srow col"><span>“Geri al” süresi</span>
        <div className="seg" style={{ marginTop: 6 }}>
          {[3, 5, 10].map((n) => (<button key={n} className={p.undoSec === n ? "on" : ""} onClick={() => set({ ...p, undoSec: n })}>{n} sn</button>))}
        </div>
      </div>
    </div>
  );
}
