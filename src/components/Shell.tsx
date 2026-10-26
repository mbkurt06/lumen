import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Drawer } from "./Drawer";
import { Icon } from "./Icon";
import { UpdateBanner } from "./UpdateBanner";

const ShellContext = createContext<{ openMenu: () => void }>({ openMenu: () => {} });
export const useShell = () => useContext(ShellContext);

export const TABS = [
  { to: "/", label: "Dashboard", icon: "home" },
  { to: "/yapilacaklar", label: "Yapılacaklar", icon: "todo" },
  { to: "/kutuphane", label: "Kütüphane", icon: "library" },
  { to: "/namaz", label: "Namaz", icon: "moon" },
  { to: "/takvim", label: "Takvim", icon: "calendar" },
] as const;

export function Shell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <ShellContext.Provider value={{ openMenu: () => setOpen(true) }}>
      <div className="shell">
        <UpdateBanner />
        <main className="content">
          <Outlet />
        </main>
        <nav className="tabbar" aria-label="Ana gezinme">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => "tab" + (isActive ? " active" : "")}>
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
        <Drawer open={open} onClose={() => setOpen(false)} />
      </div>
    </ShellContext.Provider>
  );
}
