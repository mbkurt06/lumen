import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { supabase } from "../lib/supabase";
import { confirmDeleteTodo, bumpProgress, doneOn, goalMode, isRecurring, occursOn, periodText, placeOf, recurrenceText, taskState, useTodos, ymd } from "../lib/todo";
import { TodoSheet } from "./TodoSheet";

const addDays = (d: string, n: number) => ymd(new Date(new Date(d + "T12:00:00").getTime() + n * 86400000));

export function TodoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { todos, lists, groups, loaded, setTodos, reload } = useTodos();
  const [edit, setEdit] = useState(false);
  const t = todos.find((x) => x.id === id);
  if (!t) return (<><PageHeader back title={loaded ? "Görev bulunamadı" : "Yükleniyor…"} /></>);
  const list = lists.find((l) => l.id === t.list_id);
  const pl = placeOf(t);
  const rec = isRecurring(t);
  const per = Math.max(1, t.per_day);
  const cnt = doneOn(t);
  const bump = async (d: number) => {
    const progress = await bumpProgress(t, d);
    setTodos((s) => s.map((x) => (x.id === t.id ? { ...x, progress } : x)));
  };
  const toggle = async () => {
    const done = !t.is_completed;
    setTodos((s) => s.map((x) => (x.id === t.id ? { ...x, is_completed: done, completed_at: done ? new Date().toISOString() : null } : x)));
    await supabase.from("todos").update({ is_completed: done, completed_at: done ? new Date().toISOString() : null }).eq("id", t.id);
  };
  const del = async () => {
    if (!confirmDeleteTodo(t, todos.filter((x) => x.parent_todo_id === t.id).length)) return;
    await supabase.from("todos").delete().eq("id", t.id);
    nav(-1);
  };
  // son 28 gün: yapılacak günler ve yapılanlar
  const today = ymd();
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i - 27)).filter((d) => occursOn(t, d) || (t.progress?.[d] ?? 0) > 0);
  const full = days.filter((d) => (t.progress?.[d] ?? 0) >= per).length;
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = addDays(today, -i);
    if (!occursOn(t, d)) { if (d < (t.start_date ?? today)) break; continue; }
    if ((t.progress?.[d] ?? 0) >= per) streak++; else if (d !== today) break;
  }

  return (
    <>
      <PageHeader back title={t.title} subtitle={[list?.title, rec ? recurrenceText(t) : t.due_at ? "Son tarih " + new Date(t.due_at).toLocaleDateString("tr-TR", { day: "numeric", month: "long" }) : ""].filter(Boolean).join(" · ")}
        right={<button className="iconbtn" onClick={() => setEdit(true)} aria-label="Düzenle"><Icon name="pencil" size={22} /></button>} />
      {pl && (
        <div className="card" style={{ margin: "10px 16px" }}>
          <div className="muted small">{[pl.section, pl.book].filter(Boolean).join(" · ")}</div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>{pl.live ? "Kaldığın yer: " : ""}{pl.label}</div>
          {pl.quote && <div className="muted small" style={{ marginTop: 4 }}>“{pl.quote}”</div>}
          <button className="primary" style={{ marginTop: 12 }} onClick={() => pl.docId && nav(`/kutuphane/${pl.docId}`, { state: { nid: pl.nodeId, word: t.place?.word ?? undefined, taskId: t.id, ctx: taskState(t).ctx, startPage: t.place?.page ?? undefined } })}>{pl.live ? "Kaldığım yere git" : "Kitaptaki yere git"}</button>
        </div>
      )}
      {t.notes && <div className="card" style={{ margin: "10px 16px" }}><p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{t.notes}</p></div>}
      {rec ? (
        <>
          <div className="card" style={{ margin: "10px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><b>Bugün</b><b style={{ color: "var(--accent)" }}>{cnt} / {per}</b></div>
            <div className="tbar" style={{ margin: "10px 0" }}><i style={{ width: `${Math.min(100, (cnt / per) * 100)}%` }} /></div>
            <div className="seg">
              <button onClick={() => void bump(-1)}>−1</button>
              <button className="on" onClick={() => void bump(1)}>+1</button>
            </div>
          </div>
          {days.length > 0 && (
            <div className="card" style={{ margin: "10px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><b>Son 4 hafta</b><span className="muted">{full} / {days.length} gün</span></div>
              <div className="plangrid">{days.map((d) => { const v = t.progress?.[d] ?? 0; return (<span key={d} title={d} className={v >= per ? "done" : d === today ? "today" : v ? "" : "missed"}>{Number(d.slice(8, 10))}</span>); })}</div>
              <div className="legend"><span><i className="done" /> Yapıldı</span><span><i className="missed" /> Kaçırıldı</span><span><i className="today" /> Bugün</span></div>
            </div>
          )}
          <div className="stats3">
            <div className="card"><b>{streak}</b><span className="muted small">gün seri</span></div>
            <div className="card"><b>{Object.values(t.progress ?? {}).reduce((a, b) => a + b, 0)}</b><span className="muted small">toplam</span></div>
            <div className="card"><b>{t.end_date ? Math.max(0, Math.round((Date.parse(t.end_date) - Date.parse(today)) / 86400000)) : "∞"}</b><span className="muted small">gün kaldı</span></div>
          </div>
        </>
      ) : (
        <div className="card" style={{ margin: "10px 16px" }}>
          <button className={t.is_completed ? "secondary" : "primary"} onClick={() => void toggle()}>{t.is_completed ? "Tamamlanmadı yap" : "Tamamlandı"}</button>
        </div>
      )}
      {t.page_goal && (() => {
        const st = taskState(t);
        const ps = st.periods.slice(-14).reverse();
        const unit = t.page_goal.unit ?? "sayfa";
        const seq = goalMode(t.page_goal) === "seq";
        const laps = [...(t.laps ?? [])].reverse();
        const noTarget = seq && !t.page_goal.n;
        const dayN = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
        return (
          <>
          {seq && (
            <div className="card" style={{ margin: "10px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><b>{st.total ? `${t.page_goal.loop ? `${st.lap}. tur` : "İlerleme"}` : "Okuma"}</b><b style={{ color: "var(--accent)" }}>{st.total ? `${st.lapRead}/${st.total}` : `bugün ${st.todayCount}`}</b></div>
              {st.total > 0 && <div className="tbar" style={{ margin: "10px 0 4px" }}><i style={{ width: `${Math.min(100, (st.lapRead / st.total) * 100)}%` }} /></div>}
              {laps.length > 0 && (<>
                <div className="muted small" style={{ marginTop: 10 }}>Tamamlanan turlar · ortalama {Math.round(laps.reduce((n, l) => n + dayN(l.a, l.b), 0) / laps.length)} günde bir</div>
                {laps.slice(0, 8).map((l) => (<div key={l.n} className="prow"><span>{l.n}. tur</span><span className="pst ok">{periodText({ a: l.a, b: l.b })} · {dayN(l.a, l.b)} gün</span></div>))}
              </>)}
            </div>
          )}
          {ps.length > 0 && (
          <div className="card" style={{ margin: "10px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><b>{seq ? "Gün gün" : t.strict ? "Zorunlu · dönemler" : "Dönemler"}</b><span className="muted small">{noTarget ? `ortalama ${Math.round(ps.reduce((n, p) => n + p.got, 0) / ps.length)} ${unit}/gün` : `${ps.filter((p) => p.got >= p.need).length}/${ps.length} tam`}</span></div>
            {ps.map((p) => {
              const cur = p === st.cur;
              const state = p.skipped ? "atlandı" : p.got >= p.need ? "tam" : cur ? "sürüyor" : t.strict ? "tamamlanmadı" : "eksik";
              return (
                <div key={p.a} className="prow">
                  <span>{periodText(p)}</span>
                  <span className={"pst " + (noTarget ? (p.got ? "ok" : "") : p.skipped ? "sk" : p.got >= p.need ? "ok" : cur ? "" : t.strict ? "bad" : "part")}>{noTarget ? `${p.got} ${unit}` : `${p.got}/${cur ? st.target : p.need} ${unit} · ${state}`}</span>
                </div>
              );
            })}
          </div>
          )}
          </>
        );
      })()}
      <div className="card" style={{ margin: "10px 16px", padding: 0 }}>
        <button className="rowbtn danger" onClick={() => void del()}>Görevi sil</button>
      </div>
      {edit && <TodoSheet edit={t} lists={lists} groups={groups} defaultListId={null} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void reload(); }} />}
    </>
  );
}
