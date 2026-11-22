import { NavLink } from "react-router-dom";
import { Icon } from "./Icon";
import { useAuth } from "../lib/auth";
import { useEffect, useState } from "react";
import { checkForUpdate, installApk, installedApkInfo, isNative, type ApkRelease } from "../lib/update";

/** Android: menünün en altında güncelleme düğmesi. Yeni sürüm varsa yeşil, yanında yüklü → yeni sürüm. */
function UpdateButton({ open }: { open: boolean }) {
  const [cur, setCur] = useState<{ version: string; code: string } | null>(null);
  const [rel, setRel] = useState<ApkRelease | null>(null);
  const [st, setSt] = useState<"idle" | "checking" | "current" | "error">("idle");
  const [pct, setPct] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const check = async () => {
    setSt("checking"); setMsg("");
    const r = await checkForUpdate();
    if (r.state === "apk-available") { setRel(r.release); setSt("idle"); }
    else { setRel(null); setSt(r.state === "error" ? "error" : "current"); if (r.state === "error") setMsg(r.message); }
  };
  useEffect(() => { void installedApkInfo().then(setCur); }, []);
  useEffect(() => { if (open && pct === null && isNative()) void check(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isNative()) return null;
  const go = async () => {
    if (pct !== null) return;
    if (!rel) { void check(); return; }
    setPct(0); setMsg("");
    try {
      const s = await installApk(rel, setPct);
      setMsg(s === "needs-permission" ? "“Bu kaynaktan izin ver”i açıp tekrar bas." : "Kurulum ekranı açıldı.");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setPct(null);
  };
  const v = (name?: string, code?: string | number) => (name ? `v${name}` : "") + (code != null ? ` (${code})` : "");
  return (
    <div className="dupd">
      <button className={"dupdbtn" + (rel ? " new" : "")} onClick={() => void go()} disabled={st === "checking"}>
        <Icon name="download" size={20} />
        <span className="dtext">
          <span className="dlabel">{pct !== null ? `İndiriliyor… %${pct}` : rel ? "Güncelle" : st === "checking" ? "Denetleniyor…" : "Güncel"}</span>
          <span className="dsub">{rel ? `${v(cur?.version, cur?.code)} → ${v(rel.versionName, rel.versionCode)}` : v(cur?.version, cur?.code)}</span>
        </span>
      </button>
      {msg && <div className="dsub" style={{ padding: "4px 12px" }}>{msg}</div>}
    </div>
  );
}

type Item = { to: string; label: string; icon: string; sub?: string; end?: boolean; chevron?: boolean; meta?: string };

const PAGES: Item[] = [
  { to: "/", label: "Dashboard", icon: "home", end: true },
  { to: "/yapilacaklar", label: "Yapılacaklar", icon: "todo" },
  { to: "/kutuphane", label: "Kütüphane", icon: "library" },
  { to: "/namaz", label: "Namaz", icon: "moon" },
  { to: "/istatistik", label: "İstatistik", icon: "chart" },
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
          <div style={{ minWidth: 0 }}>
            <div className="dname">Lumen</div>
            <div className="demail">{email}</div>
          </div>
        </div>
        <div className="dscroll">
          {PAGES.map((i) => (
            <Row key={i.to} it={i} />
          ))}
        </div>
        <UpdateButton open={open} />
      </aside>
    </>
  );
}
