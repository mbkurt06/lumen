import { useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { useCP, useLock } from "../lib/counterPrefs";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";
import { FARZ, NAMAZ_KINDS, addKazaMany, kazaSure, useKaza, type KazaKind } from "../lib/kaza";
import { ensureList, useTodos, ymd } from "../lib/todo";

const trDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "short" });
const LBL: Record<string, string> = { ...Object.fromEntries(NAMAZ_KINDS.map((x) => [x.k, x.l])), oruc: "Oruç" };

/* Kaza: kıldıkça artan sayaçlar; yanında kaç gün/ay/yıl ettiği. */
export function Kaza() {
  const s = useKaza();
  const { lists, groups, todos } = useTodos();
  const [cp] = useCP();
  const lk = useLock(cp.lockKaza, cp.autoLockSec);
  const [todoFor, setTodoFor] = useState<null | "namaz" | "oruc">(null);
  const [daily, setDaily] = useState(5);
  const [msg, setMsg] = useState("");
  const [undo, setUndo] = useState<null | { text: string; items: { kind: KazaKind; delta: number }[]; day: string }>(null);
  const undoT = useRef<number | undefined>(undefined);
  const [entry, setEntry] = useState<null | { k: KazaKind; v: string; day: string }>(null);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };
  const tamGun = Math.min(...FARZ.map((k) => s.total[k] ?? 0));
  const hasTodo = (w: "namaz" | "oruc") => todos.some((t) => t.kind === (w === "namaz" ? "kaza" : "kaza_oruc") && !t.is_completed);

  // kilitliyse uyar; açıksa işlemi yap ve "Geri al" göster
  const guard = () => { if (!lk.touch()) { flash("Kilitli · açmak için 🔒'ye bas"); return false; } return true; };
  const apply = (k: KazaKind, delta: number, day = ymd()) => {
    addKazaMany([{ kind: k, delta }], day);
    try { navigator.vibrate?.(12); } catch { /* yok say */ }
    window.clearTimeout(undoT.current);
    setUndo({ text: `${LBL[k]} ${delta > 0 ? "+" : ""}${delta}`, items: [{ kind: k, delta }], day });
    undoT.current = window.setTimeout(() => setUndo(null), cp.undoSec * 1000);
  };
  const doUndo = () => {
    if (!undo) return;
    addKazaMany(undo.items.map((x) => ({ kind: x.kind, delta: -x.delta })), undo.day);
    setUndo(null);
    flash("Geri alındı");
  };
  const minus = (k: KazaKind) => { if (!guard()) return; if ((s.total[k] ?? 0) > 0 && window.confirm(`${LBL[k]} kazasından 1 düşülsün mü?`)) apply(k, -1); };
  const saveEntry = (sign: 1 | -1) => {
    if (!entry) return;
    const n = Math.floor(Number(entry.v) || 0);
    if (n <= 0) { setEntry(null); return; }
    if (sign < 0 && !window.confirm(`${LBL[entry.k]} kazasından ${n} düşülsün mü?`)) return;
    apply(entry.k, sign * n, entry.day > ymd() ? ymd() : entry.day);
    setEntry(null);
  };

  const Row = ({ k }: { k: KazaKind }) => {
    const n = s.total[k] ?? 0;
    const td = s.today[k] ?? 0;
    return (
      <div className={"kzrow" + (lk.locked ? " locked" : "")}>
        <div className="kzname"><b>{LBL[k]}</b><span>{kazaSure(n)}{td ? ` · bugün ${td}` : ""}</span></div>
        <button className="kzminus" onClick={() => minus(k)} aria-label={`${LBL[k]} bir düş`}>−</button>
        <button className="kzn" onClick={() => { if (guard()) setEntry({ k, v: "", day: ymd() }); }} aria-label={`${LBL[k]} toplu ekle`}>{n}</button>
        <button className="kzplus" onClick={() => { if (guard()) apply(k, 1); }} aria-label={`${LBL[k]} kıldım`}>+</button>
      </div>
    );
  };

  const addTodo = async () => {
    const w = todoFor!;
    const lid = await ensureList(lists, groups, "Kaza", "Namaz");
    const { error } = await supabase.from("todos").insert({
      title: w === "namaz" ? "Kaza namazı" : "Kaza orucu", kind: w === "namaz" ? "kaza" : "kaza_oruc", list_id: lid,
      plan: { daily, days: 36500, start: ymd(), done: {} },
    });
    setTodoFor(null);
    flash(error ? "Eklenemedi: " + error.message : "Günüm listesine eklendi");
  };

  return (
    <>
      <PageHeader back="/namaz" title="Kaza" subtitle={`Tam gün: ${tamGun} · ${kazaSure(tamGun)}`}
        right={cp.lockKaza ? <button className={"iconbtn lockbtn" + (lk.locked ? "" : " open")} onClick={() => (lk.locked ? lk.unlock() : lk.lock())} aria-label={lk.locked ? "Kilidi aç" : "Kilitle"}><Icon name={lk.locked ? "lock" : "unlock"} size={24} /></button> : undefined} />
      {cp.lockKaza && <div className={"lockline" + (lk.locked ? "" : " open")}>{lk.locked ? "Kilitli · saymak için sağ üstteki kilide bas" : `Kilit açık · ${cp.autoLockSec ? cp.autoLockSec + " sn dokunulmazsa kilitlenir" : "otomatik kilit kapalı"}`}</div>}
      {s.pending > 0 && <div className="infoline">{s.pending} kayıt telefonda, internet gelince hesaba gönderilecek.</div>}
      <div className="lbl">KAZA NAMAZI</div>
      <div className="card kzcard">{NAMAZ_KINDS.map((x) => <Row key={x.k} k={x.k} />)}</div>
      <p className="muted small" style={{ margin: "6px 18px 0" }}>Sayıya dokununca toplu ekleyebilirsin. Tam gün: beş vaktin hepsinden kılınan sayı. Süre: 30 gün = 1 ay, 12 ay = 1 yıl.</p>
      {!hasTodo("namaz") && <button className="dashed" onClick={() => { setDaily(5); setTodoFor("namaz"); }}>+ Günlük kaza namazını Todo'ya ekle</button>}

      <div className="lbl">KAZA ORUCU</div>
      <div className="card kzcard"><Row k="oruc" /></div>
      {!hasTodo("oruc") && <button className="dashed" onClick={() => { setDaily(1); setTodoFor("oruc"); }}>+ Kaza orucunu Todo'ya ekle</button>}

      {s.days.length > 0 && (
        <>
          <div className="lbl">GEÇMİŞ</div>
          <div className="card" style={{ margin: "0 16px", padding: "4px 0" }}>
            {s.days.slice(0, 30).map((d) => (
              <div key={d.day} className="kzhist">
                <span>{d.day === ymd() ? "Bugün" : trDay(d.day)}</span>
                <span className="muted">{Object.entries(d.byKind).filter(([, v]) => v).map(([k, v]) => `${LBL[k]} ${v}`).join(" · ")}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ height: 30 }} />
      {msg && <div className="toast">{msg}</div>}
      {undo && <div className="undobar"><span>{undo.text}</span><button onClick={doUndo}>Geri al</button></div>}
      {entry && (
        <>
          <div className="scrim show" style={{ zIndex: 40 }} onClick={() => setEntry(null)} />
          <div className="dialog">
            <div className="cardtitle">{LBL[entry.k]} · toplu</div>
            <div className="small muted" style={{ marginTop: 4 }}>Şu an: {s.total[entry.k] ?? 0} · {kazaSure(s.total[entry.k] ?? 0)}</div>
            <input className="field big" style={{ width: "100%", marginTop: 12, textAlign: "center" }} type="number" inputMode="numeric" min={1} autoFocus placeholder="Kaç tane?" value={entry.v} onChange={(e) => setEntry({ ...entry, v: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEntry(1)} />
            <div className="chips5" style={{ marginTop: 10 }}>
              {[5, 10, 30].map((n) => (<button key={n} onClick={() => setEntry({ ...entry, v: String((Math.floor(Number(entry.v) || 0)) + n) })}>+{n}</button>))}
            </div>
            <div className="line"><span>Hangi gün</span><input className="dateinp" type="date" max={ymd()} value={entry.day} onChange={(e) => setEntry({ ...entry, day: e.target.value || ymd() })} /></div>
            <div className="seg">
              <button onClick={() => saveEntry(-1)} style={{ color: "var(--danger)" }}>Düş</button>
              <button onClick={() => setEntry(null)}>Vazgeç</button>
              <button className="on" onClick={() => saveEntry(1)}>Ekle</button>
            </div>
          </div>
        </>
      )}
      {todoFor && (
        <>
          <div className="scrim show" style={{ zIndex: 40 }} onClick={() => setTodoFor(null)} />
          <div className="dialog">
            <div className="cardtitle">{todoFor === "namaz" ? "Günlük kaza namazı hedefi" : "Kaza orucu hedefi"}</div>
            <div className="line"><span>{todoFor === "namaz" ? "Günde kaç vakit" : "Günde"}</span>
              <span className="stepper"><button onClick={() => setDaily(Math.max(1, daily - 1))}>−</button><b>{daily}</b><button onClick={() => setDaily(daily + 1)}>+</button></span>
            </div>
            <p className="muted small">Günüm listesinde her gün görünür; kıldıkça (bu sayfada +) bugünkü sayı ilerler.</p>
            <div className="seg">
              <button onClick={() => setTodoFor(null)}>Vazgeç</button>
              <button className="on" onClick={() => void addTodo()}>Ekle</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
