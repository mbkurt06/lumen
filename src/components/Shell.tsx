import { onWritesChange, pendingWrites } from "../lib/writeQueue";
import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { Drawer } from "./Drawer";
import { Icon } from "./Icon";
import { UpdateBanner } from "./UpdateBanner";
import { isNative } from "../lib/update";
import { useOffline } from "../lib/online";

const ShellContext = createContext<{ openMenu: () => void }>({ openMenu: () => {} });
export const useShell = () => useContext(ShellContext);

export const TABS = [
  { to: "/", label: "Dashboard", icon: "home" },
  { to: "/yapilacaklar", label: "Yapılacaklar", icon: "todo" },
  { to: "/kutuphane", label: "Kütüphane", icon: "library" },
  { to: "/namaz", label: "Namaz", icon: "moon" },
  { to: "/namaz/kaza", label: "Kazalar", icon: "clock" }, // takvim yandaki menüde
] as const;

export function Shell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [pathname]);

  // Android geri tuşu: menü açıksa kapat, alt sayfadaysa geri git, ana sayfadaysa uygulamadan çık.
  useEffect(() => {
    if (!isNative()) return;
    const sub = CapApp.addListener("backButton", () => {
      if (open) setOpen(false);
      else if (pathname !== "/") navigate(-1);
      else CapApp.exitApp();
    });
    return () => {
      sub.then((h) => h.remove());
    };
  }, [open, pathname, navigate]);
  return (
    <ShellContext.Provider value={{ openMenu: () => setOpen(true) }}>
      <div className="shell">
        <UpdateBanner />
        <OfflineBar />
        <main className="content">
          <Outlet />
        </main>
        <nav className="tabbar" aria-label="Ana gezinme">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/" || t.to === "/namaz"} className={({ isActive }) => "tab" + (isActive ? " active" : "")}>
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

/* İnternet yokken ince bir uyarı: kayıtlı içerik gösteriliyor (okuyucuda başlığa taşınır). */
function OfflineBar() {
  const off = useOffline();
  const [n, setN] = useState(pendingWrites);
  useEffect(() => onWritesChange(() => setN(pendingWrites())), []);
  if (!off) return null;
  return <div className="offbar">Çevrimdışı · {n ? `${n} değişiklik telefonda, internet gelince gönderilecek` : "değişiklikler telefona kaydedilir"}</div>;
}
