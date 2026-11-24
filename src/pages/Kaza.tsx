import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useCP, buzz } from "../lib/counterPrefs";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";
import { FARZ, NAMAZ_KINDS, addKazaMany, kazaSure, useKaza, useKazaLog, type KazaKind } from "../lib/kaza";
import { ensureList, useTodos, ymd } from "../lib/todo";

const trDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "short" });
const LBL: Record<string, string> = { ...Object.fromEntries(NAMAZ_KINDS.map((x) => [x.k, x.l])), oruc: "Oruç" };

/* Kaza: kıldıkça artan sayaçlar; yanında kaç gün/ay/yıl ettiği. */
export function Kaza() {
  const { kind } = useParams();
  const only = kind && kind in LBL ? (kind as KazaKind) : null; // bir vaktin kendi ekranı
  const nav = useNavigate();
  const s = useKaza();
  const { lists, groups, todos } = useTodos();
  const [cp] = useCP();
  const [todoFor, setTodoFor] = useState<null | "namaz" | "oruc">(null);
  const [daily, setDaily] = useState(5);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<Record<string, number>>({}); // eklenecek (henüz toplama geçmedi)
  const [undo, setUndo] = useState<null | { text: string; items: { kind: KazaKind; delta: number }[]; day: string; at?: string }>(null);
  const undoT = useRef<number | undefined>(undefined);
  const [entry, setEntry] = useState<null | { k: KazaKind; v: string; day: string; time: string; past?: boolean }>(null);
  const nowHM = () => new Date().toTimeString().slice(0, 5);
  const openEntry = (k: KazaKind, past = false) => setEntry({ k, v: past ? "1" : "", day: past ? ymd(new Date(Date.now() - 86400000)) : ymd(), time: nowHM(), past });
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };
  const tamGun = Math.min(...FARZ.map((k) => s.total[k] ?? 0));
  const hasTodo = (w: "namaz" | "oruc") => todos.some((t) => t.kind === (w === "namaz" ? "kaza" : "kaza_oruc") && !t.is_completed);

  // kilitliyse uyar; açıksa işlemi yap ve "Geri al" göster
  const apply = (k: KazaKind, delta: number, day = ymd(), at?: string) => {
    addKazaMany([{ kind: k, delta }], day, at);
    buzz("tap");
    window.clearTimeout(undoT.current);
    setUndo({ text: `${LBL[k]} ${delta > 0 ? "+" : ""}${delta}${day !== ymd() ? ` · ${trDay(day)}` : ""}`, items: [{ kind: k, delta }], day, at });
    undoT.current = window.setTimeout(() => setUndo(null), cp.undoSec * 1000);
  };
  const doUndo = () => {
    if (!undo) return;
    addKazaMany(undo.items.map((x) => ({ kind: x.kind, delta: -x.delta })), undo.day, undo.at);
    setUndo(null);
    flash("Geri alındı");
  };
  const saveEntry = (sign: 1 | -1) => {
    if (!entry) return;
    const n = Math.floor(Number(entry.v) || 0);
    if (n <= 0) { setEntry(null); return; }
    if (sign < 0 && !window.confirm(`${LBL[entry.k]} kazasından ${n} düşülsün mü?`)) return;
    const day = entry.day > ymd() ? ymd() : entry.day;
    let at: string | undefined;
    if (day !== ymd() || entry.past) { const d = new Date(`${day}T${entry.time || "12:00"}:00`); if (!isNaN(+d) && d.getTime() <= Date.now()) at = d.toISOString(); }
    apply(entry.k, sign * n, day, at);
    setEntry(null);
  };

  /* Her vakitte: kıldığını say (0'dan), "Ekle" ile toplama ekle. Toplam doğrudan değişmez. */
  const Row = ({ k }: { k: KazaKind }) => {
    const n = s.total[k] ?? 0;
    const td = s.today[k] ?? 0;
    const d = draft[k] ?? 0;
    const add = () => {
      if (d <= 0) return;
      apply(k, d);
      setDraft((x) => ({ ...x, [k]: 0 }));
      flash(`${LBL[k]} · ${d} eklendi`);
    };
    return (
      <div className="kzrow">
        <button className="kzname" onClick={() => { if (!only) nav(`/namaz/kaza/${k}`); }} aria-label={`${LBL[k]} geçmişi`}>
          <b>{LBL[k]}{!only && <Icon name="chevron" size={14} />}</b>
          <span>toplam {n} · {kazaSure(n)}{td ? ` · bugün ${td}` : ""}</span>
        </button>
        <button className="kzminus" onClick={() => setDraft((x) => ({ ...x, [k]: Math.max(0, (x[k] ?? 0) - 1) }))} disabled={d <= 0} aria-label={`${LBL[k]} bir az`}>−</button>
        <button className="kzn" onClick={() => openEntry(k)} aria-label={`${LBL[k]} toplu ya da geçmiş tarihe ekle`}>{d}</button>
        <button className="kzplus" onClick={() => { buzz("tap"); setDraft((x) => ({ ...x, [k]: (x[k] ?? 0) + 1 })); }} aria-label={`${LBL[k]} bir daha`}>+</button>
        <button className="kzadd" onClick={add} disabled={d <= 0}>Ekle</button>
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

  const dialogs = (
    <>
      {msg && <div className="toast">{msg}</div>}
      {undo && <div className="undobar"><span>{undo.text}</span><button onClick={doUndo}>Geri al</button></div>}
      {entry && (
        <>
          <div className="scrim show" style={{ zIndex: 40 }} onClick={() => setEntry(null)} />
          <div className="dialog">
            <div className="cardtitle">{LBL[entry.k]} · {entry.past ? "geçmiş tarihe ekle" : "toplu"}</div>
            <div className="small muted" style={{ marginTop: 4 }}>Şu an: {s.total[entry.k] ?? 0} · {kazaSure(s.total[entry.k] ?? 0)}</div>
            <input className="field big" style={{ width: "100%", marginTop: 12, textAlign: "center" }} type="number" inputMode="numeric" min={1} autoFocus placeholder="Kaç tane?" value={entry.v} onChange={(e) => setEntry({ ...entry, v: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEntry(1)} />
            <div className="chips5" style={{ marginTop: 10 }}>
              {[5, 10, 30].map((n) => (<button key={n} onClick={() => setEntry({ ...entry, v: String((Math.floor(Number(entry.v) || 0)) + n) })}>+{n}</button>))}
            </div>
            <div className="line"><span>Hangi gün</span><input className="dateinp" type="date" max={ymd()} value={entry.day} onChange={(e) => setEntry({ ...entry, day: e.target.value || ymd() })} /></div>
            {(entry.past || entry.day !== ymd()) && <div className="line"><span>Saat</span><input className="dateinp" type="time" value={entry.time} onChange={(e) => setEntry({ ...entry, time: e.target.value })} /></div>}
            <div className="seg">
              <button onClick={() => saveEntry(-1)} style={{ color: "var(--danger)" }}>Düş</button>
              <button onClick={() => setEntry(null)}>Vazgeç</button>
              <button className="on" onClick={() => saveEntry(1)}>Ekle</button>
            </div>
          </div>
        </>
      )}
    </>
  );

  // ── Bir vaktin ekranı: üstte ekleme, altta tarih/saat/adetle geçmiş ──
  if (only) {
    return (
      <>
        <PageHeader back="/namaz/kaza" title={`${LBL[only]} kazası`} subtitle={`Toplam ${s.total[only] ?? 0} · ${kazaSure(s.total[only] ?? 0)}`} />
        <div className="card kzcard" style={{ marginTop: 8 }}><Row k={only} /></div>
        <button className="dashed" onClick={() => openEntry(only, true)}>+ Geçmiş bir tarihe ekle</button>
        <p className="muted small" style={{ margin: "6px 18px 0" }}>Kıldığını + ile say, "Ekle" ile toplama ekle. Ortadaki sayıya dokunup toplu ekleyebilirsin. Geçmişe eklediğin, seçtiğin gün ve saatle aşağıda görünür.</p>
        <KazaHistory k={only} />
        <div style={{ height: 30 }} />
        {dialogs}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Kazalar" subtitle={`Tam gün: ${tamGun} · ${kazaSure(tamGun)}`} />
      {s.pending > 0 && <div className="infoline">{s.pending} kayıt telefonda, internet gelince hesaba gönderilecek.</div>}
      <div className="lbl">KAZA NAMAZI</div>
      <div className="card kzcard">{NAMAZ_KINDS.map((x) => <Row key={x.k} k={x.k} />)}</div>
      <p className="muted small" style={{ margin: "6px 18px 0" }}>Kıldığını + ile say, "Ekle"ye basınca toplama eklenir. Vaktin adına dokununca o vaktin geçmişi açılır (yanlış kaydı oradan silebilirsin). Ortadaki sayıya dokununca toplu ya da geçmiş tarihe ekleyebilirsin. Tam gün: beş vaktin hepsinden kılınan sayı. Süre: 30 gün = 1 ay, 12 ay = 1 yıl.</p>
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
      {dialogs}
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

/* Bir vaktin eklemeleri: gün gün, saatiyle ve adediyle */
function KazaHistory({ k }: { k: KazaKind }) {
  const { rows, loaded } = useKazaLog(k);
  const localDay = (iso: string) => ymd(new Date(iso));
  const groups = new Map<string, typeof rows>();
  for (const r of [...rows].sort((a, b) => (a.day === b.day ? (a.at < b.at ? 1 : -1) : a.day < b.day ? 1 : -1))) groups.set(r.day, [...(groups.get(r.day) ?? []), r]);
  const hm = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <div className="lbl">GEÇMİŞ</div>
      {!loaded && <p className="muted small" style={{ margin: "0 18px" }}>Yükleniyor…</p>}
      {loaded && rows.length === 0 && <p className="muted small" style={{ margin: "0 18px" }}>Henüz kayıt yok.</p>}
      {[...groups.entries()].map(([d, list]) => {
        const sum = list.reduce((a, r) => a + r.delta, 0);
        return (
          <div key={d} className="card kzday">
            <div className="kzdayh"><b>{d === ymd() ? "Bugün · " : ""}{trDay(d)}</b><span>{sum > 0 ? "+" : ""}{sum}</span></div>
            {list.map((r) => (
              <div key={r.id} className="kzent">
                <span className="t">{hm(r.at)}</span>
                <span className={"n" + (r.delta < 0 ? " neg" : "")}>{r.delta > 0 ? "+" : "−"}{Math.abs(r.delta)}</span>
                <span className="muted small">{localDay(r.at) !== d ? `${trDay(localDay(r.at))} eklendi` : ""}{r.pending ? " · telefonda, gönderilecek" : ""}</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
