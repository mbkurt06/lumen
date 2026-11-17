import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import { AskDialog } from "../components/Dialog";
import { TodoSheet } from "./TodoSheet";
import { TodoMenu } from "./TodoMenu";
import { kazaToday, useKaza } from "../lib/kaza";
import { bumpCount, inToday, isDoneToday, isOverdue, planDayIndex, refPath, todayCount, useTodos, type TList, type Todo as T } from "../lib/todo";

const trDate = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });

export function Todo() {
  const { listId } = useParams();
  const nav = useNavigate();
  const { todos, lists, groups, err, reload, setTodos } = useTodos();
  useKaza(); // kaza sayıları değişince Günüm de yenilensin
  const [menu, setMenu] = useState(false);
  const [sp] = useSearchParams();
  const [sheet, setSheet] = useState(sp.get("ekle") === "tekrar");
  const [ask, setAsk] = useState<null | "list" | "group">(null);
  const [fold, setFold] = useState<Record<string, boolean>>({});
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [act, setAct] = useState<T | null>(null); // kitaba bağlı görev: menü
  const goRef = (t: T) => { if (t.reading_ref) nav(refPath(t.reading_ref), { state: { nid: t.reading_ref.node_id, taskId: t.id } }); else if (t.related_library_item_id) nav(`/kutuphane/${t.related_library_item_id}`); };

  const listOf = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const kids = useMemo(() => {
    const m = new Map<string, T[]>();
    for (const t of todos) if (t.parent_todo_id) m.set(t.parent_todo_id, [...(m.get(t.parent_todo_id) ?? []), t]);
    return m;
  }, [todos]);

  const current: TList | undefined = listId ? listOf.get(listId) : undefined;
  const today = todos.filter(inToday);
  const overdue = today.filter(isOverdue);
  const normalToday = today.filter((t) => !isOverdue(t));
  const doneCount = today.filter(isDoneToday).length;

  const listTodos = listId ? todos.filter((t) => t.list_id === listId && !t.parent_todo_id) : [];
  const listActive = listTodos.filter((t) => !t.is_completed);
  const listDone = listTodos.filter((t) => t.is_completed);

  const circle = async (t: T) => {
    if (t.kind === "kaza" || t.kind === "kaza_oruc") { nav("/namaz/kaza"); return; }
    if (t.kind === "tekrar" && t.plan) {
      const plan = await bumpCount(t, isDoneToday(t) ? -t.plan.daily : 1);
      if (plan) setTodos((s) => s.map((x) => (x.id === t.id ? { ...x, plan } : x)));
      return;
    }
    const done = !t.is_completed;
    setTodos((s) => s.map((x) => (x.id === t.id ? { ...x, is_completed: done, completed_at: done ? new Date().toISOString() : null } : x)));
    await supabase.from("todos").update({ is_completed: done, completed_at: done ? new Date().toISOString() : null }).eq("id", t.id);
  };

  const Row = ({ t }: { t: T }) => {
    const l = t.list_id ? listOf.get(t.list_id) : undefined;
    const kz = t.kind === "kaza" || t.kind === "kaza_oruc";
    const sub =
      kz && t.plan ? `Bugün ${kazaToday(t.kind === "kaza" ? "namaz" : "oruc")} / ${t.plan.daily}${t.kind === "kaza" ? " vakit" : " gün"}`
      : t.kind === "tekrar" && t.plan ? `${l?.title ?? "Tekrar"} · Gün ${Math.max(1, planDayIndex(t.plan))} / ${t.plan.days}`
      : t.kind === "okuma" ? `${l?.title ?? "Okuma"}${!t.reading_ref && t.notes ? " · " + t.notes : ""}`
      : t.due_at ? `${trDate(t.due_at)}${l ? " · " + l.title : ""}` : (l?.title ?? "");
    const done = isDoneToday(t);
    const cnt = t.plan ? todayCount(t) : 0;
    const sub2 = kids.get(t.id) ?? [];
    return (
      <div className="tcard">
        <div className="trow2">
          <button className={"tcircle" + (done ? " on" : "")} onClick={() => void circle(t)} aria-label="Tamamla">{done ? <Icon name="check" size={16} /> : null}</button>
          <div className="tmain" onClick={() => (kz ? nav("/namaz/kaza") : t.reading_ref ? setAct(t) : nav(`/yapilacaklar/g/${t.id}`))}>
            <div className={"ttitle2" + (done ? " done" : "")}>{t.title}</div>
            {sub && <div className="tsub">{sub}</div>}
            {t.reading_ref && <div className="tref">{t.reading_ref.kind === "yer" ? "Kaldığın yer: " : ""}{t.reading_ref.label}</div>}
          </div>
          {t.kind === "tekrar" && t.plan && <div className="tcount">{cnt} / {t.plan.daily}</div>}
          {t.kind === "okuma" && (t.reading_ref || t.related_library_item_id) && <button className="devam" onClick={() => goRef(t)}>Devam et</button>}
        </div>
        {t.kind === "tekrar" && t.plan && <div className="tbar"><i style={{ width: `${Math.min(100, (cnt / t.plan.daily) * 100)}%` }} /></div>}
        {sub2.map((c) => (
          <div key={c.id} className="trow2 subrow">
            <button className={"tcircle small" + (c.is_completed ? " on" : "")} onClick={() => void circle(c)}>{c.is_completed ? <Icon name="check" size={12} /> : null}</button>
            <div className={"tmain" + (c.is_completed ? " done" : "")}>{c.title}</div>
          </div>
        ))}
      </div>
    );
  };

  const Section = ({ id, title, items }: { id: string; title: string; items: T[] }) => {
    if (!items.length) return null;
    const closed = fold[id];
    return (
      <>
        <button className="sec" onClick={() => setFold({ ...fold, [id]: !closed })}>
          <span>{title}</span>
          <Icon name={closed ? "chevron" : "chevdown"} size={18} />
        </button>
        {!closed && items.map((t) => <Row key={t.id} t={t} />)}
      </>
    );
  };

  const title = current ? current.title : "Günüm";
  const groupTitle = current?.group_id ? groups.find((g) => g.id === current.group_id)?.title : undefined;
  const subtitle = current
    ? `${groupTitle ?? "Liste"} · ${listActive.length} görev`
    : `${new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })} · ${doneCount} / ${today.length} tamamlandı`;

  const addList = async (name: string) => { await supabase.from("todo_lists").insert({ title: name }); void reload(); };
  const addGroup = async (name: string) => { await supabase.from("todo_groups").insert({ title: name }); void reload(); };

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        right={<button className="iconbtn" onClick={() => setMenu(true)} aria-label="Liste menüsü"><Icon name="dots" size={26} /></button>}
      />
      {!current && <div className="gbar"><i style={{ width: `${today.length ? (doneCount / today.length) * 100 : 0}%` }} /></div>}
      {err && <p className="error" style={{ padding: "0 16px" }}>{err}</p>}

      {!current ? (
        <>
          {overdue.length > 0 && (
            <>
              <button className="sec late" onClick={() => setOverdueOpen(!overdueOpen)}>
                <span>TARİHİ GEÇENLER · {overdue.length}</span>
                <Icon name={overdueOpen ? "chevdown" : "chevron"} size={18} />
              </button>
              {overdueOpen && overdue.map((t) => <Row key={t.id} t={t} />)}
            </>
          )}
          <Section id="kut" title="KÜTÜPHANE" items={normalToday.filter((t) => t.kind === "tekrar" || t.kind === "okuma")} />
          <Section id="nova" title="NOVA" items={normalToday.filter((t) => t.kind === "nova")} />
          <Section id="namaz" title="NAMAZ" items={normalToday.filter((t) => t.kind === "kaza" || t.kind === "kaza_oruc")} />
          <Section id="diger" title="DİĞER" items={normalToday.filter((t) => !["tekrar", "okuma", "nova", "kaza", "kaza_oruc"].includes(t.kind))} />
          {today.length === 0 && <p className="muted" style={{ padding: "24px 20px", textAlign: "center" }}>Bugün için görev yok. Sağ alttaki + ile ekleyebilirsin.</p>}
        </>
      ) : (
        <>
          {listActive.map((t) => <Row key={t.id} t={t} />)}
          {listActive.length === 0 && <p className="muted" style={{ padding: "24px 20px", textAlign: "center" }}>Bu listede görev yok.</p>}
          {listDone.length > 0 && (
            <>
              <button className="sec" onClick={() => setDoneOpen(!doneOpen)}>
                <span>Tamamlananlar · {listDone.length}</span>
                <Icon name={doneOpen ? "chevdown" : "chevron"} size={18} />
              </button>
              {doneOpen && listDone.map((t) => <Row key={t.id} t={t} />)}
            </>
          )}
        </>
      )}
      <div style={{ height: 110 }} />
      <button className="fab" onClick={() => setSheet(true)} aria-label="Görev ekle"><Icon name="plus" size={30} /></button>

      <TodoMenu
        open={menu}
        onClose={() => setMenu(false)}
        todos={todos}
        lists={lists}
        groups={groups}
        activeListId={listId}
        onNewList={() => { setMenu(false); setAsk("list"); }}
        onNewGroup={() => { setMenu(false); setAsk("group"); }}
      />
      {sheet && <TodoSheet initialTab={sp.get("ekle") === "tekrar" ? "tekrar" : "normal"} lists={lists} groups={groups} defaultListId={listId ?? null} onClose={() => setSheet(false)} onSaved={() => { setSheet(false); void reload(); }} />}
      {act && (
        <>
          <div className="scrim show" style={{ zIndex: 40 }} onClick={() => setAct(null)} />
          <div className="sheet actsheet" role="dialog" aria-label={act.title}>
            <div className="grab" />
            <div className="sheethead"><h2 style={{ fontSize: 18 }}>{act.title}</h2><button className="iconbtn" onClick={() => setAct(null)} aria-label="Kapat"><Icon name="close" size={22} /></button></div>
            {act.reading_ref && <div className="posbox"><Icon name="bookmark" size={18} /><div><b>{act.reading_ref.label}</b>{act.reading_ref.quote && <span>“{act.reading_ref.quote.slice(0, 140)}”</span>}</div></div>}
            <div className="card" style={{ padding: 0, marginTop: 12 }}>
              <button className="rowbtn" onClick={() => { const t = act; setAct(null); goRef(t); }}><Icon name="library" size={20} /> {act.reading_ref?.kind === "yer" ? "Kaldığım yere git" : "Kitaptaki yere git"}</button>
              <button className="rowbtn" onClick={() => { const t = act; setAct(null); void circle(t); }}><Icon name="check" size={20} /> {act.is_completed ? "Tamamlanmadı yap" : "Tamamlandı"}</button>
              <button className="rowbtn" onClick={() => { const t = act; setAct(null); nav(`/yapilacaklar/g/${t.id}`); }}><Icon name="dots" size={20} /> Ayrıntılar</button>
            </div>
            <p className="muted small" style={{ margin: "10px 2px 0" }}>Okurken + menüsünden “Görev: kaldığım yer” ile bu görevin yerini güncelleyebilirsin.</p>
          </div>
        </>
      )}
      {ask && <AskDialog title={ask === "list" ? "Yeni liste" : "Yeni grup"} placeholder="Ad" onClose={() => setAsk(null)} onSubmit={(v) => void (ask === "list" ? addList(v) : addGroup(v))} />}
    </>
  );
}
