"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { TodoDialog } from "@/components/TodoDialog";

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
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

function stateFor(todo: Todo, key: string) {
  const meta = parseMeta(todo.notes);
  const target = Math.max(1, Number(meta.schedule?.target || 1));
  const count = Math.min(target, Number(meta.schedule?.history?.[key]?.count || 0));
  return { meta, target, count, done: count >= target };
}

export function TodoList({ onOpenTodo }: { onOpenTodo?: (todo: Todo) => void | Promise<void> }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [message, setMessage] = useState("Yükleniyor...");
  const [editMenu, setEditMenu] = useState<{todo:Todo;x:number;y:number}|null>(null);
  const [editTodo, setEditTodo] = useState<Todo | null>(null);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const active = useMemo(
    () => visible.filter(todo => !stateFor(todo, selectedDate).done),
    [visible, selectedDate]
  );

  const completed = useMemo(
    () => visible.filter(todo => stateFor(todo, selectedDate).done),
    [visible, selectedDate]
  );

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

  function startEdit(todo: Todo, e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => {
      setEditMenu({ todo, x: e.clientX, y: e.clientY });
    }, 650);
  }

  function stopEdit(e?: React.PointerEvent<HTMLDivElement>) {
    e?.stopPropagation();
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = null;
  }

  function renderTodo(todo: Todo) {
    const { meta, target, count, done } = stateFor(todo, selectedDate);
    return (
      <article className={"todoCard " + (done ? "done" : "")} key={todo.id}>
        <button className="todoOpen todoNavigate" onClick={() => onOpenTodo?.(todo)}>
          {done && <div className="todoCompletedCheck">✓</div>}
          <div className="todoMain">
            <strong>{todo.title}</strong>
            {meta.description && <p>{meta.description}</p>}
          </div>
          <div
            className={"todoTargetPill " + (done ? "done" : "")}
            onPointerDown={e => startEdit(todo, e)}
            onPointerUp={stopEdit}
            onPointerCancel={stopEdit}
            onContextMenu={e => e.preventDefault()}
          >
            {target}/{count}
          </div>
        </button>
        <button className="todoDelete" onClick={() => remove(todo.id)}>×</button>
      </article>
    );
  }

  return (
    <section className="todoPage card" onPointerDown={e => { if (e.target === e.currentTarget) setEditMenu(null); }}>
      <div className="todoPageHead">
        <h2>Günlük Todo</h2>
        <span>{completed.length} / {visible.length}</span>
      </div>

      <div className="todoDateNav">
        <button className="secondary" onClick={() => shift(-1)}>‹</button>
        <input className="input" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
        <button className="secondary" onClick={() => shift(1)}>›</button>
        <button className="secondary" onClick={() => setSelectedDate(dateKey(new Date()))}>Bugün</button>
      </div>

      <div className="todoSection">
        <h3>Yapılacaklar</h3>
        <div className="todoCards">
          {active.map(renderTodo)}
          {!active.length && <div className="todoEmpty">Bekleyen görev yok.</div>}
        </div>
      </div>

      <div className="todoSection completedTodoSection">
        <h3>Tamamlandı</h3>
        <div className="todoCards">
          {completed.map(renderTodo)}
          {!completed.length && <div className="todoEmpty">Henüz tamamlanan görev yok.</div>}
        </div>
      </div>

      {editMenu && (
        <button
          className="counterResetPopover todoEditPopover"
          style={{left:Math.max(8,editMenu.x-42),top:Math.max(8,editMenu.y-58),right:"auto",bottom:"auto"}}
          onClick={() => { setEditTodo(editMenu.todo); setEditMenu(null); }}
        >
          Düzenle
        </button>
      )}

      {editTodo && (
        <TodoDialog
          open={true}
          onClose={() => setEditTodo(null)}
          onSaved={async () => { await loadTodos(); setEditTodo(null); }}
          title={editTodo.title}
          defaultTarget={stateFor(editTodo, selectedDate).target}
          libraryItemId={editTodo.related_library_item_id}
          contentNodeId={editTodo.related_content_node_id}
          editTodo={{id:editTodo.id,notes:editTodo.notes}}
        />
      )}

      {message && <p className="muted">{message}</p>}
    </section>
  );
}
