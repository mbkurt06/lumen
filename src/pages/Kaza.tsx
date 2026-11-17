import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";
import { FARZ, NAMAZ_KINDS, addKaza, kazaSure, useKaza, type KazaKind } from "../lib/kaza";
import { ensureList, useTodos, ymd } from "../lib/todo";

const trDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "short" });
const LBL: Record<string, string> = { ...Object.fromEntries(NAMAZ_KINDS.map((x) => [x.k, x.l])), oruc: "Oruç" };

/* Kaza: kıldıkça artan sayaçlar; yanında kaç gün/ay/yıl ettiği. */
export function Kaza() {
  const s = useKaza();
  const { lists, groups, todos } = useTodos();
  const [todoFor, setTodoFor] = useState<null | "namaz" | "oruc">(null);
  const [daily, setDaily] = useState(5);
  const [msg, setMsg] = useState("");
  const tamGun = Math.min(...FARZ.map((k) => s.total[k] ?? 0));
  const minus = (k: KazaKind) => { if ((s.total[k] ?? 0) > 0 && window.confirm(`${LBL[k]} kazasından 1 düşülsün mü?`)) addKaza(k, -1); };
  const hasTodo = (w: "namaz" | "oruc") => todos.some((t) => t.kind === (w === "namaz" ? "kaza" : "kaza_oruc") && !t.is_completed);

  const Row = ({ k }: { k: KazaKind }) => {
    const n = s.total[k] ?? 0;
    const td = s.today[k] ?? 0;
    return (
      <div className="kzrow">
        <div className="kzname"><b>{LBL[k]}</b><span>{kazaSure(n)}{td ? ` · bugün ${td}` : ""}</span></div>
        <button className="kzminus" onClick={() => minus(k)} aria-label={`${LBL[k]} geri al`}>−</button>
        <div className="kzn">{n}</div>
        <button className="kzplus" onClick={() => { addKaza(k, 1); try { navigator.vibrate?.(12); } catch { /* yok say */ } }} aria-label={`${LBL[k]} kıldım`}>+</button>
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
    setMsg(error ? "Eklenemedi: " + error.message : "Günüm listesine eklendi");
    setTimeout(() => setMsg(""), 2500);
  };

  return (
    <>
      <PageHeader back="/namaz" title="Kaza" subtitle={`Tam gün: ${tamGun} · ${kazaSure(tamGun)}`} />
      {s.pending > 0 && <div className="infoline">{s.pending} kayıt telefonda, internet gelince hesaba gönderilecek.</div>}
      <div className="lbl">KAZA NAMAZI</div>
      <div className="card kzcard">{NAMAZ_KINDS.map((x) => <Row key={x.k} k={x.k} />)}</div>
      <p className="muted small" style={{ margin: "6px 18px 0" }}>Tam gün: beş vaktin hepsinden kılınan sayı. Süre hesabı: 30 gün = 1 ay, 12 ay = 1 yıl.</p>
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
