import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import { AskDialog } from "../components/Dialog";
import { TodoSheet } from "./TodoSheet";
import { TodoMenu } from "./TodoMenu";
import { kazaToday, useKaza } from "../lib/kaza";
import { confirmDeleteTodo, goalLabel, goalProgress, bumpProgress, bumpDay, doneOn, inToday, isDoneToday, isOverdue, isRecurring, periodText, periodUnit, placeOf, recurrenceText, skipPeriod, taskState, useTodos, type Period, type TaskState, type TList, type Todo as T } from "../lib/todo";
import { useTP } from "../lib/taskPrefs";
import { rangeStartDoc } from "../lib/taskNav";

const trDate = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });

export function Todo() {
  const { listId } = useParams();
  const nav = useNavigate();
  const { todos, lists, groups, err, reload, setTodos } = useTodos();
  useKaza(); // kaza sayıları değişince Günüm de yenilensin
  const [menu, setMenu] = useState(false);
  const [sp] = useSearchParams();
  const [sheet, setSheet] = useState(sp.get("ekle") === "tekrar");
  const [editT, setEditT] = useState<T | null>(null);
  const [ask, setAsk] = useState<null | "list" | "group">(null);
  const [fold, setFold] = useState<Record<string, boolean>>({});
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [todoSettingsOpen, setTodoSettingsOpen] = useState(false);
  const [todoScale, setTodoScale] = useState(() => {
    try { return Number(localStorage.getItem("lumen.todo.textScale") ?? "0.9") || 0.9; } catch { return 1; }
  });
  useEffect(() => {
    try { localStorage.setItem("lumen.todo.textScale", String(todoScale)); } catch { /* yer yok */ }
  }, [todoScale]);
  const [act, setAct] = useState<T | null>(null); // görev menüsü: git / tamamla / düzenle / sil
  const delTask = async (t: T) => {
    if (!confirmDeleteTodo(t, todos.filter((x) => x.parent_todo_id === t.id).length)) return;
    setTodos((s) => s.filter((x) => x.id !== t.id && x.parent_todo_id !== t.id));
    const { error } = await supabase.from("todos").delete().eq("id", t.id);
    if (error) { window.alert("Silinemedi: " + error.message); void reload(); }
  };
  const [tp] = useTP();
  const states = useMemo(() => new Map<string, TaskState>(todos.map((t) => [t.id, taskState(t, tp)])), [todos, tp]);
  const [missOpen, setMissOpen] = useState<boolean | null>(null);
  const [missExp, setMissExp] = useState<Record<string, boolean>>({});
  // kitaptaki yere git: ayraç (güncel yer) ya da sabit yer.
  // Her gün okunan aralık bugün hiç okunmadıysa (ayar kapalıyken) aralığın başından açılır.
  const goRef = async (t: T) => {
    const pl = placeOf(t);
    const g = t.page_goal;
    if (pl?.docId && g?.per === "pages" && !tp.resumeRange && periodUnit(t) !== "range" && (states.get(t.id)?.got ?? 0) === 0) {
      const r = await rangeStartDoc(g, pl.docId).catch(() => null);
      if (r) { nav(`/kutuphane/${r.docId}`, { state: { taskId: t.id, startPage: r.startPage } }); return; }
    }
    if (pl?.docId) nav(`/kutuphane/${pl.docId}`, { state: { nid: pl.nodeId, taskId: t.id } }); else if (t.related_library_item_id) nav(`/kutuphane/${t.related_library_item_id}`);
  };

  const listOf = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const kids = useMemo(() => {
    const m = new Map<string, T[]>();
    for (const t of todos) if (t.parent_todo_id) m.set(t.parent_todo_id, [...(m.get(t.parent_todo_id) ?? []), t]);
    return m;
  }, [todos]);

  const current: TList | undefined = listId ? listOf.get(listId) : undefined;
  const today = todos.filter(inToday);
  const activeToday = today.filter((t) => !isDoneToday(t));
  const completedToday = today.filter(isDoneToday);
  const overdue = activeToday.filter(isOverdue);
  const normalToday = activeToday.filter((t) => !isOverdue(t));
  const doneCount = completedToday.length;

  const listTodos = listId ? todos.filter((t) => t.list_id === listId && !t.parent_todo_id) : [];
  const listActive = listTodos.filter((t) => !t.is_completed);
  const listDone = listTodos.filter((t) => t.is_completed);

  const circle = async (t: T) => {
    if (t.kind === "kaza" || t.kind === "kaza_oruc") { nav("/namaz/kaza"); return; }
    if (t.page_goal && !t.is_completed) { void goRef(t); return; } // okuma hedefi: okudukça dolar
    if (isRecurring(t)) {
      // günde N kez: her dokunuş +1; doluysa sıfırla
      const progress = await bumpProgress(t, isDoneToday(t) ? -doneOn(t) : 1);
      setTodos((s) => s.map((x) => (x.id === t.id ? { ...x, progress } : x)));
      return;
    }
    const done = !t.is_completed;
    setTodos((s) => s.map((x) => (x.id === t.id ? { ...x, is_completed: done, completed_at: done ? new Date().toISOString() : null } : x)));
    await supabase.from("todos").update({ is_completed: done, completed_at: done ? new Date().toISOString() : null }).eq("id", t.id);
  };

  const Row = ({ t }: { t: T }) => {
    const l = t.list_id ? listOf.get(t.list_id) : undefined;
    const kz = t.kind === "kaza" || t.kind === "kaza_oruc";
    const pl = placeOf(t);
    const rt = recurrenceText(t);
    const g = t.page_goal;
    const s = states.get(t.id);
    const gc = g && s ? s.got : 0;
    const gn = g && s ? s.target : g?.n ?? 1;
    const unitTx = g?.unit ?? "sayfa";
    const resume = pl ? `${pl.live ? "Kaldığın: " : ""}${pl.label}` : "";
    const pu = periodUnit(t);
    const prevTx = pu === "day" ? "dün" : pu === "week" ? "geçen hafta" : "geçen ay";
    const extra = g && s && !t.strict ? [
      s.catchUp > 0 ? `+${Math.min(s.catchUp, s.target - s.catchUp)} telafi` : "",
      tp.showYesterday && s.prev && pu !== "range" ? `${prevTx} ${s.prev.got}/${s.prev.need}` : "",
      g.per === "day" ? `toplam ${goalProgress(t)} ${unitTx}` : "",
    ].filter(Boolean).join(" · ") : "";
    // tarih aralığında: yetişmek için günlük öneri
    const daysLeft = t.end_date ? Math.round((new Date(t.end_date + "T12:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 86400000) + 1 : 0;
    const suggest = g && s && pu === "range" && tp.suggestDaily && daysLeft > 0 && s.got < s.target ? `günde ~${Math.ceil((s.target - s.got) / daysLeft)} ${unitTx} · ${daysLeft} gün kaldı` : "";
    const sub = kz && t.plan ? `Bugün ${kazaToday(t.kind === "kaza" ? "namaz" : "oruc")} / ${t.plan.daily}${t.kind === "kaza" ? " vakit" : " gün"}`
      : [t.strict ? "Zorunlu" : "", g ? `${goalLabel(g)} ${gc}/${gn} ${unitTx}` : "", extra, suggest, pl?.book && !t.title.includes(pl.book) && !pl.book.includes(t.title) ? pl.book : !pl?.book ? pl?.section : "", rt || (t.due_at ? trDate(t.due_at) : ""), resume, l?.title].filter(Boolean).join(" · ");
    const done = isDoneToday(t);
    const per = Math.max(1, t.per_day);
    const cnt = isRecurring(t) ? doneOn(t) : 0;
    const sub2 = kids.get(t.id) ?? [];
    return (
      <div className="tcard">
        <div className="trow2">
          <button className={"tcircle" + (done ? " on" : "")} onClick={() => void circle(t)} aria-label="Tamamla">{done ? <Icon name="check" size={16} /> : null}</button>
          <div className="tmain" onClick={() => (kz ? nav("/namaz/kaza") : pl || t.related_library_item_id ? setAct(t) : nav(`/yapilacaklar/g/${t.id}`))}>
            <div className="ttopline">
              <div className={"ttitle2" + (done ? " done" : "")} style={{ fontSize: `${17 * todoScale}px` }}>{t.title}</div>
              {isRecurring(t) && per > 1 && <div className="tcount" style={{ fontSize: `${15 * todoScale}px` }}>{cnt}/{per}</div>}
            </div>
            {sub && <div className="tsub" style={{ fontSize: `${13 * todoScale}px` }}>{sub}</div>}
          </div>
          {(pl || t.related_library_item_id) && !kz && <button className="devam sm" onClick={() => void goRef(t)}>{g ? `${gc}/${gn}` : pl?.live ? "Devam" : "Git"}</button>}
          <button className="tmore" onClick={() => setAct(t)} aria-label="Düzenle / sil"><Icon name="dots" size={20} /></button>
        </div>
        {g ? <div className="tbar"><i style={{ width: `${Math.min(100, (gc / Math.max(1, gn)) * 100)}%` }} /></div>
          : isRecurring(t) && per > 1 && <div className="tbar"><i style={{ width: `${Math.min(100, (cnt / per) * 100)}%` }} /></div>}
        {sub2.map((c) => (
          <div key={c.id} className="trow2 subrow">
            <button className={"tcircle small" + (c.is_completed ? " on" : "")} onClick={() => void circle(c)}>{c.is_completed ? <Icon name="check" size={12} /> : null}</button>
            <div className={"tmain" + (c.is_completed ? " done" : "")}>{c.title}</div>
          </div>
        ))}
      </div>
    );
  };

  // ── Zorunlu görevlerin tamamlanmamış dönemleri ──
  const missedTasks = todos.filter((t) => !t.parent_todo_id && (states.get(t.id)?.missed.length ?? 0) > 0);
  const missedCount = missedTasks.reduce((n, t) => n + (states.get(t.id)?.missed.length ?? 0), 0);
  const left = (p: Period) => p.need - p.got;
  const skip = async (t: T, p: Period) => {
    if (!window.confirm(`“${t.title}” · ${periodText(p)} atlansın mı? Geçmişte “atlandı” olarak kalır.`)) return;
    await skipPeriod(t, p.a); void reload();
  };
  const PeriodLine = ({ t, p, title }: { t: T; p: Period; title?: boolean }) => {
    const g = t.page_goal;
    return (
      <div className="mline">
        <div className="mmain">
          {title && <div className="mtitle">{t.title}</div>}
          <div className="msub">{periodText(p)}{g ? ` · ${goalLabel({ ...g, every: undefined })}` : ""}</div>
          <div className="mbar"><i style={{ width: `${(p.got / p.need) * 100}%` }} /></div>
          <div className="mleft">{p.got}/{p.need} · {left(p)} {g?.unit ?? (g ? "sayfa" : "kez")} kaldı</div>
        </div>
        {g ? <button className="devam sm" onClick={() => void goRef(t)}>Devam</button>
          : <button className="devam sm" onClick={async () => { await bumpDay(t, p.a, 1); void reload(); }}>Yaptım</button>}
        {tp.allowSkip && <button className="mskip" onClick={() => void skip(t, p)}>Atla</button>}
      </div>
    );
  };
  const MissedSection = () => {
    if (!missedTasks.length) return null;
    const open = missOpen ?? tp.missedOpen;
    return (
      <>
        <button className="sec late" onClick={() => setMissOpen(!open)}>
          <span>TAMAMLANMAMIŞ · {missedCount}</span>
          <Icon name={open ? "chevdown" : "chevron"} size={18} />
        </button>
        {open && missedTasks.map((t) => {
          const ms = states.get(t.id)!.missed;
          if (tp.missedGroup === "ayri") return ms.map((p) => <div key={t.id + p.a} className="tcard missed"><PeriodLine t={t} p={p} title /></div>);
          const total = ms.reduce((n, p) => n + left(p), 0);
          const ex = missExp[t.id];
          return (
            <div key={t.id} className="tcard missed">
              <div className="mline">
                <div className="mmain" onClick={() => setMissExp({ ...missExp, [t.id]: !ex })}>
                  <div className="mtitle">{t.title}</div>
                  <div className="msub">{ms.length > 1 ? `${ms.length} ${periodUnit(t) === "week" ? "hafta" : periodUnit(t) === "month" ? "ay" : "gün"} · ` : periodText(ms[0]) + " · "}{total} {t.page_goal?.unit ?? (t.page_goal ? "sayfa" : "kez")} kaldı</div>
                </div>
                {t.page_goal ? <button className="devam sm" onClick={() => void goRef(t)}>Devam</button> : null}
                <button className="tmore" onClick={() => setMissExp({ ...missExp, [t.id]: !ex })} aria-label="Dönemleri göster"><Icon name={ex ? "chevdown" : "chevron"} size={18} /></button>
              </div>
              {ex && ms.map((p) => <PeriodLine key={p.a} t={t} p={p} />)}
            </div>
          );
        })}
      </>
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
    <div className="todo-page">
      <PageHeader
        title={title}
        subtitle={subtitle}
        right={<div className="todo-head-actions">
          <button className="iconbtn" onClick={() => setTodoSettingsOpen((v) => !v)} aria-label="Görev ayarları"><Icon name="sliders" size={24} /></button>
          <button className="iconbtn" onClick={() => setMenu(true)} aria-label="Liste menüsü"><Icon name="dots" size={26} /></button>
        </div>}
      />
      {todoSettingsOpen && <div className="todo-settings">
        <span><Icon name="sliders" size={17} /> Yazı boyutu</span>
        <button onClick={() => setTodoScale((s) => Math.max(0.55, Number((s - 0.1).toFixed(2))))} aria-label="Yazıları küçült">A−</button>
        <b>%{Math.round(todoScale * 100)}</b>
        <button onClick={() => setTodoScale((s) => Math.min(1.25, Number((s + 0.1).toFixed(2))))} aria-label="Yazıları büyüt">A+</button>
      </div>}
      {!current && <div className="gbar"><i style={{ width: `${today.length ? (doneCount / today.length) * 100 : 0}%` }} /></div>}
      {err && <p className="error" style={{ padding: "0 16px" }}>{err}</p>}

      {!current ? (
        <>
          <MissedSection />
          {overdue.length > 0 && (
            <>
              <button className="sec late" onClick={() => setOverdueOpen(!overdueOpen)}>
                <span>TARİHİ GEÇENLER · {overdue.length}</span>
                <Icon name={overdueOpen ? "chevdown" : "chevron"} size={18} />
              </button>
              {overdueOpen && overdue.map((t) => <Row key={t.id} t={t} />)}
            </>
          )}
          <Section id="kut" title="KÜTÜPHANE" items={normalToday.filter((t) => !!(t.bookmark_id || t.reading_ref || t.related_library_item_id) && !t.kind.startsWith("kaza"))} />
          <Section id="nova" title="NOVA" items={normalToday.filter((t) => t.kind === "nova")} />
          <Section id="namaz" title="NAMAZ" items={normalToday.filter((t) => t.kind === "kaza" || t.kind === "kaza_oruc")} />
          <Section id="diger" title="DİĞER" items={normalToday.filter((t) => !(t.bookmark_id || t.reading_ref || t.related_library_item_id) && !["nova", "kaza", "kaza_oruc"].includes(t.kind))} />
          {completedToday.length > 0 && (
            <>
              <button className="sec completed" onClick={() => setDoneOpen(!doneOpen)}>
                <span>TAMAMLANANLAR · {completedToday.length}</span>
                <Icon name={doneOpen ? "chevdown" : "chevron"} size={18} />
              </button>
              {doneOpen && completedToday.map((t) => <Row key={t.id} t={t} />)}
            </>
          )}
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
      {sheet && <TodoSheet lists={lists} groups={groups} defaultListId={listId ?? null} onClose={() => setSheet(false)} onSaved={() => { setSheet(false); void reload(); }} />}
      {editT && <TodoSheet edit={editT} lists={lists} groups={groups} defaultListId={null} onClose={() => setEditT(null)} onSaved={() => { setEditT(null); void reload(); }} />}
      {act && (
        <>
          <div className="scrim show" style={{ zIndex: 40 }} onClick={() => setAct(null)} />
          <div className="sheet actsheet" role="dialog" aria-label={act.title}>
            <div className="grab" />
            <div className="sheethead"><h2 style={{ fontSize: 18 }}>{act.title}</h2><button className="iconbtn" onClick={() => setAct(null)} aria-label="Kapat"><Icon name="close" size={22} /></button></div>
            {(() => { const pl = placeOf(act); return pl && <div className="posbox"><Icon name="bookmark" size={18} /><div><b>{[pl.section, pl.book].filter(Boolean).join(" · ")}</b><b>{pl.live ? "Kaldığın yer: " : ""}{pl.label}</b>{pl.quote && <span>“{pl.quote.slice(0, 140)}”</span>}</div></div>; })()}
            <div className="card" style={{ padding: 0, marginTop: 12 }}>
              {(placeOf(act) || act.related_library_item_id) && !act.kind.startsWith("kaza") && <button className="rowbtn" onClick={() => { const t = act; setAct(null); void goRef(t); }}><Icon name="library" size={20} /> {placeOf(act)?.live ? "Kaldığım yere git" : placeOf(act) ? "Kitaptaki yere git" : "Kitaba git"}</button>}
              <button className="rowbtn" onClick={() => { const t = act; setAct(null); void circle(t); }}><Icon name="check" size={20} /> {isRecurring(act) && Math.max(1, act.per_day) > 1 ? `+1 (bugün ${doneOn(act)}/${act.per_day})` : isDoneToday(act) ? "Tamamlanmadı yap" : "Tamamlandı"}</button>
              {!act.kind.startsWith("kaza") && <button className="rowbtn" onClick={() => { const t = act; setAct(null); setEditT(t); }}><Icon name="pencil" size={20} /> Düzenle</button>}
              <button className="rowbtn" onClick={() => { const t = act; setAct(null); nav(`/yapilacaklar/g/${t.id}`); }}><Icon name="dots" size={20} /> Ayrıntılar</button>
              <button className="rowbtn danger" onClick={() => { const t = act; setAct(null); void delTask(t); }}><Icon name="close" size={20} /> Sil</button>
            </div>
            {placeOf(act)?.live && <p className="muted small" style={{ margin: "10px 2px 0" }}>Okurken ayracı taşıdıkça bu görev de yeni yeri gösterir.</p>}
          </div>
        </>
      )}
      {ask && <AskDialog title={ask === "list" ? "Yeni liste" : "Yeni grup"} placeholder="Ad" onClose={() => setAsk(null)} onSubmit={(v) => void (ask === "list" ? addList(v) : addGroup(v))} />}
    </div>
  );
}
