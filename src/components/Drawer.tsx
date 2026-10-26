import { NavLink } from "react-router-dom";
import { Icon } from "./Icon";
import { useAuth } from "../lib/auth";

type Item = { to: string; label: string; icon: string; sub?: string; end?: boolean; chevron?: boolean; meta?: string };

const PAGES: Item[] = [
  { to: "/", label: "Dashboard", icon: "home", end: true },
  { to: "/yapilacaklar", label: "Yapılacaklar", icon: "todo" },
  { to: "/kutuphane", label: "Kütüphane", icon: "library" },
  { to: "/namaz", label: "Namaz", icon: "moon" },
  { to: "/nova", label: "Nova", icon: "sparkle" },
  { to: "/takvim", label: "Takvim", icon: "calendar" },
  { to: "/ayarlar", label: "Ayarlar", icon: "sliders" },
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
          {PAGES.map((i) => (
            <Row key={i.to} it={i} />
          ))}
        </div>
      </aside>
    </>
  );
}
