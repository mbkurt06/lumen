"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Todo = {
  id: string;
  title: string;
  notes: string | null;
  is_completed: boolean;
  due_at: string | null;
  related_library_item_id: string | null;
  related_content_node_id: string | null;
  created_at: string;
};

type TodoMeta = {
  description?: string;
  schedule?: {
    mode?: "single" | "range" | "days" | "forever";
    startDate?: string;
    endDate?: string | null;
    durationDays?: number | null;
    target?: number;
    history?: Record<string, { count?: number; completedAt?: string | null }>;
  };
  source?: "document" | "segment";
};

function parseMeta(notes: string | null): TodoMeta {
  if (!notes) return {};
  try { return JSON.parse(notes) as TodoMeta; } catch { return { description: notes }; }
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function occurs(meta: TodoMeta, key: string) {
  const s = meta.schedule;
  if (!s?.startDate) return true;
  if (key < s.startDate) return false;
  if (s.mode === "single") return key === s.startDate;
  if (s.mode === "range") return !s.endDate || key <= s.endDate;
  if (s.mode === "days") {
    const start = new Date(s.startDate + "T00:00:00");
    const current = new Date(key + "T00:00:00");
    const diff = Math.floor((current.getTime() - start.getTime()) / 86400000);
    return diff >= 0 && diff < Math.max(1, s.durationDays || 1);
  }
  return true;
}

export function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [message, setMessage] = useState("Yükleniyor...");

  const loadTodos = useCallback(async () => {
    const { data, error } = await supabase
      .from("todos")
      .select("id,title,notes,is_completed,due_at,related_library_item_id,related_content_node_id,created_at")
      .order("created_at", { ascending: true });

    if (error) setMessage("Todo okunamadı: " + error.message);
    else {
      setTodos(data ?? []);
      setMessage("");
    }
  }, []);

  useEffect(() => { loadTodos(); }, [loadTodos]);

  const visible = useMemo(
    () => todos.filter(todo => occurs(parseMeta(todo.notes), selectedDate)),
    [todos, selectedDate]
  );

  async function toggle(todo: Todo) {
    const meta = parseMeta(todo.notes);
    const target = Math.max(1, meta.schedule?.target || 1);
    const history = { ...(meta.schedule?.history || {}) };
    const current = history[selectedDate] || { count: 0, completedAt: null };
    const done = (current.count || 0) >= target;
    history[selectedDate] = done
      ? { count: 0, completedAt: null }
      : { count: target, completedAt: new Date().toISOString() };

    const nextMeta = {
      ...meta,
      schedule: { ...meta.schedule, history },
    };

    const { error } = await supabase
      .from("todos")
      .update({
        notes: JSON.stringify(nextMeta),
        is_completed: meta.schedule?.mode === "single" ? !done : false,
      })
      .eq("id", todo.id);

    if (error) setMessage(error.message);
    else await loadTodos();
  }

  async function remove(id: string) {
    if (!window.confirm("Bu Todo silinsin mi?")) return;
    const { error } = await supabase.from("todos").delete().eq("id", id);
    if (error) setMessage(error.message);
    else await loadTodos();
  }

  function shift(days: number) {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + days);
    setSelectedDate(dateKey(d));
  }

  return (
    <section className="todoPage card">
      <div className="todoPageHead">
        <h2>Günlük Todo</h2>
        <span>{visible.filter(t => {
          const m=parseMeta(t.notes); const h=m.schedule?.history?.[selectedDate];
          return (h?.count||0) >= Math.max(1,m.schedule?.target||1);
        }).length} / {visible.length}</span>
      </div>

      <div className="todoDateNav">
        <button className="secondary" onClick={() => shift(-1)}>‹</button>
        <input className="input" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
        <button className="secondary" onClick={() => shift(1)}>›</button>
        <button className="secondary" onClick={() => setSelectedDate(dateKey(new Date()))}>Bugün</button>
      </div>

      <div className="todoCards">
        {visible.map(todo => {
          const meta = parseMeta(todo.notes);
          const target = Math.max(1, meta.schedule?.target || 1);
          const count = Math.min(target, meta.schedule?.history?.[selectedDate]?.count || 0);
          const done = count >= target;
          return (
            <article className={"todoCard " + (done ? "done" : "")} key={todo.id}>
              <button className="todoOpen" onClick={() => toggle(todo)}>
                <div className="todoCheck">{done ? "✓" : ""}</div>
                <div className="todoMain">
                  <strong>{todo.title}</strong>
                  {meta.description && <p>{meta.description}</p>}
                  <div className="todoProgress"><span>{count} / {target}</span></div>
                </div>
              </button>
              <button className="todoDelete" onClick={() => remove(todo.id)}>×</button>
            </article>
          );
        })}
        {!visible.length && <div className="todoEmpty">Bu tarihte görev yok.</div>}
      </div>

      {message && <p className="muted">{message}</p>}
    </section>
  );
}
