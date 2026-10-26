import { NavLink } from "react-router-dom";
import { Icon } from "./Icon";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { CURRENT } from "../lib/update";

type Item = { to: string; label: string; icon: string; sub?: string; end?: boolean; chevron?: boolean; meta?: string };

const PAGES: Item[] = [
  { to: "/", label: "Dashboard", icon: "home", end: true },
  { to: "/yapilacaklar", label: "Yapılacaklar", icon: "todo", chevron: true },
  { to: "/kutuphane", label: "Kütüphane", icon: "library", chevron: true },
  { to: "/namaz", label: "Namaz", icon: "moon" },
  { to: "/takvim", label: "Takvim", icon: "calendar" },
];
const SHORTCUTS: Item[] = [
  { to: "/ara", label: "Ara", icon: "search" },
  { to: "/notlar", label: "Notlarım", icon: "pencil" },
  { to: "/yer-isaretleri", label: "Yer işaretlerim", icon: "bookmark" },
  { to: "/kelime-defteri", label: "Kelime defterim", icon: "bookopen" },
];
const SETTINGS: Item[] = [
  { to: "/ayarlar", label: "Ayarlar", icon: "sliders", sub: "Genel · Bildirimler · Namaz · Okuma · Google" },
  { to: "/cihazlar", label: "Cihazlarım", icon: "phone" },
  { to: "/esitleme", label: "Eşitleme ve yedek", icon: "sync" },
  { to: "/guncelleme", label: "Güncelleme · Hakkında", icon: "download", meta: "v" + CURRENT.version },
];

function Row({ it }: { it: Item }) {
  return (
    <NavLink to={it.to} end={it.end} className={({ isActive }) => "drow" + (isActive ? " active" : "")}>
      <span className="dicon">
        <Icon name={it.icon} />
      </span>
      <span className="dtext">
        <span className="dlabel">{it.label}</span>
        {it.sub && <span className="dsub">{it.sub}</span>}
      </span>
      {it.meta && <span className="dmeta">{it.meta}</span>}
      {it.chevron && (
        <span className="dmeta">
          <Icon name="chevron" size={18} />
        </span>
      )}
    </NavLink>
  );
}

export function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth();
  const email = session?.user.email ?? "";
  return (
    <>
      <div className={"scrim" + (open ? " show" : "")} onClick={onClose} aria-hidden={!open} />
      <aside className={"drawer" + (open ? " open" : "")} aria-hidden={!open} aria-label="Menü">
        <div className="dhead">
          <div className="avatar">L</div>
          <div>
            <div className="dname">Lumen</div>
            <div className="demail">{email}</div>
          </div>
        </div>
        <div className="dscroll">
          <div className="dsection">SAYFALAR</div>
          {PAGES.map((i) => (
            <Row key={i.to} it={i} />
          ))}
          <div className="dsection">KISAYOLLAR</div>
          {SHORTCUTS.map((i) => (
            <Row key={i.to} it={i} />
          ))}
          <div className="dsep" />
          {SETTINGS.map((i) => (
            <Row key={i.to} it={i} />
          ))}
        </div>
        <button className="drow logout" onClick={() => supabase.auth.signOut()}>
          <span className="dicon">
            <Icon name="logout" />
          </span>
          <span className="dtext">
            <span className="dlabel">Çıkış yap</span>
          </span>
        </button>
      </aside>
    </>
  );
}
