import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { supabase } from "../lib/supabase";

type Todo = {
  id: string;
  title: string;
  is_completed: boolean;
  due_at: string | null;
  list_id: string | null;
  priority: number;
  created_at: string;
};
type List = { id: string; title: string };
type View = "gunum" | "hepsi" | "bitti";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function Todo() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [view, setView] = useState<View>("gunum");
  const [listId, setListId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [t, l] = await Promise.all([
      supabase.from("todos").select("id,title,is_completed,due_at,list_id,priority,created_at").order("created_at", { ascending: false }).limit(500),
      supabase.from("todo_lists").select("id,title").order("sort_order").order("created_at"),
    ]);
    if (t.error) setErr(t.error.message); else setTodos((t.data ?? []) as Todo[]);
    if (!l.error) setLists((l.data ?? []) as List[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const title = text.trim();
    if (!title) return;
    setText("");
    const due = view === "gunum" ? new Date().toISOString() : null;
    const { error } = await supabase.from("todos").insert({ title, due_at: due, list_id: listId });
    if (error) setErr(error.message);
    void load();
  };
  const toggle = async (t: Todo) => {
    setTodos((s) => s.map((x) => (x.id === t.id ? { ...x, is_completed: !x.is_completed } : x)));
    await supabase.from("todos").update({ is_completed: !t.is_completed, completed_at: t.is_completed ? null : new Date().toISOString() }).eq("id", t.id);
  };
  const remove = async (t: Todo) => {
    setTodos((s) => s.filter((x) => x.id !== t.id));
    await supabase.from("todos").delete().eq("id", t.id);
  };
  const addList = async () => {
    const name = window.prompt("Liste adı");
    if (!name?.trim()) return;
    await supabase.from("todo_lists").insert({ title: name.trim() });
    void load();
  };

  const eod = new Date(startOfDay(new Date()).getTime() + 86400000);
  let shown = todos.filter((t) => (listId ? t.list_id === listId : true));
  if (view === "gunum") shown = shown.filter((t) => !t.is_completed && t.due_at && new Date(t.due_at) < eod);
  else if (view === "hepsi") shown = shown.filter((t) => !t.is_completed);
  else shown = shown.filter((t) => t.is_completed);

  const overdue = (t: Todo) => !t.is_completed && t.due_at && new Date(t.due_at) < startOfDay(new Date());

  return (
    <>
      <PageHeader title="Yapılacaklar" subtitle={new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })} />
      <div className="tabs2">
        <button className={"chip" + (view === "gunum" ? " on" : "")} onClick={() => setView("gunum")}>Günüm</button>
        <button className={"chip" + (view === "hepsi" ? " on" : "")} onClick={() => setView("hepsi")}>Tümü</button>
        <button className={"chip" + (view === "bitti" ? " on" : "")} onClick={() => setView("bitti")}>Biten</button>
      </div>
      <div className="tabs2">
        <button className={"chip" + (listId === null ? " on" : "")} onClick={() => setListId(null)}>Tüm listeler</button>
        {lists.map((l) => (
          <button key={l.id} className={"chip" + (listId === l.id ? " on" : "")} onClick={() => setListId(l.id)}>{l.title}</button>
        ))}
        <button className="chip" onClick={addList}>＋ Liste</button>
      </div>
      <div className="addbar">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} placeholder={view === "gunum" ? "Bugüne görev ekle…" : "Görev ekle…"} />
        <button onClick={() => void add()}>Ekle</button>
      </div>
      {err && <p className="error" style={{ padding: "0 16px" }}>{err}</p>}
      <div className="card" style={{ margin: "10px 16px", padding: 0 }}>
        {shown.length === 0 && <p className="muted" style={{ padding: "14px 16px", margin: 0 }}>{view === "gunum" ? "Bugün için görev yok." : "Görev yok."}</p>}
        {shown.map((t) => (
          <div key={t.id} className="trow">
            <button className={"tcheck" + (t.is_completed ? " on" : "")} onClick={() => void toggle(t)} aria-label="Tamamla">{t.is_completed ? "✓" : ""}</button>
            <div className={"ttitle" + (t.is_completed ? " done" : "")}>
              {t.title}
              {overdue(t) && <div className="small late">Gecikmiş · {new Date(t.due_at!).toLocaleDateString("tr-TR")}</div>}
            </div>
            <button className="tdel" onClick={() => void remove(t)} aria-label="Sil">×</button>
          </div>
        ))}
      </div>
    </>
  );
}
