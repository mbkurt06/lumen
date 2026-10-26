import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";
import { bumpCount, planDayIndex, planStats, todayCount, useTodos, ymd } from "../lib/todo";

export function TodoDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { todos, lists, loaded, setTodos } = useTodos();
  const t = todos.find((x) => x.id === id);
  if (!t) return (<><PageHeader back title={loaded ? "Görev bulunamadı" : "Yükleniyor…"} /></>);
  const list = lists.find((l) => l.id === t.list_id);
  const p = t.plan;
  const cnt = p ? todayCount(t) : 0;
  const st = p ? planStats(p) : null;
  const bump = async (d: number) => {
    const plan = await bumpCount(t, d);
    if (plan) setTodos((s) => s.map((x) => (x.id === t.id ? { ...x, plan } : x)));
  };
  const del = async () => {
    if (!window.confirm("Bu görev silinsin mi?")) return;
    await supabase.from("todos").delete().eq("id", t.id);
    nav(-1);
  };
  const dayCells = p ? Array.from({ length: p.days }, (_, i) => {
    const day = ymd(new Date((Math.round(Date.UTC(+p.start.slice(0, 4), +p.start.slice(5, 7) - 1, +p.start.slice(8, 10)) / 86400000) + i) * 86400000 + 12 * 3600000));
    const full = (p.done?.[day] ?? 0) >= p.daily;
    const idx = planDayIndex(p);
    return { i: i + 1, cls: full ? "done" : i + 1 === idx ? "today" : i + 1 < idx ? "missed" : "" };
  }) : [];
  return (
    <>
      <PageHeader back title={t.title} subtitle={list?.title} />
      {p && st ? (
        <>
          <div className="card" style={{ margin: "10px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><b>Bugün</b><b style={{ color: "var(--accent)" }}>{cnt} / {p.daily} tekrar</b></div>
            <div className="tbar" style={{ margin: "10px 0" }}><i style={{ width: `${Math.min(100, (cnt / p.daily) * 100)}%` }} /></div>
            <div className="seg">
              <button onClick={() => void bump(-1)}>−1</button>
              <button className="on" onClick={() => void bump(1)}>+1 tekrar</button>
            </div>
            {t.related_library_item_id && <button className="primary" style={{ marginTop: 10 }} onClick={() => nav(`/kutuphane/${t.related_library_item_id}`)}>Kütüphanede aç</button>}
          </div>
          <div className="card" style={{ margin: "10px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><b>{p.days} günlük plan</b><span className="muted">Gün {Math.max(1, st.idx)}</span></div>
            <div className="plangrid">{dayCells.map((c) => (<span key={c.i} className={c.cls}>{c.i}</span>))}</div>
            <div className="legend"><span><i className="done" /> Yapıldı</span><span><i className="missed" /> Kaçırıldı</span><span><i className="today" /> Bugün</span></div>
          </div>
          <div className="stats3">
            <div className="card"><b>{st.streak}</b><span className="muted small">gün seri</span></div>
            <div className="card"><b>{st.missed}</b><span className="muted small">kaçırılan</span></div>
            <div className="card"><b>{st.left}</b><span className="muted small">gün kaldı</span></div>
          </div>
        </>
      ) : (
        <div className="card" style={{ margin: "10px 16px" }}>
          {t.due_at && <p style={{ margin: 0 }}>Son tarih: {new Date(t.due_at).toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}</p>}
          {t.notes && <p className="muted">{t.notes}</p>}
          {t.related_library_item_id && <button className="primary" style={{ marginTop: 10 }} onClick={() => nav(`/kutuphane/${t.related_library_item_id}`)}>Devam et</button>}
          {!t.due_at && !t.notes && !t.related_library_item_id && <p className="muted" style={{ margin: 0 }}>Ek bilgi yok.</p>}
        </div>
      )}
      <div className="card" style={{ margin: "10px 16px", padding: 0 }}>
        <button className="rowbtn danger" onClick={() => void del()}>Görevi sil</button>
      </div>
    </>
  );
}
