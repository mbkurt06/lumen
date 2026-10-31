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
