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
  source?: "document" | "segment" | "calendar";
};

type CalendarInfo = {
  id: string;
  summary: string;
  accessRole: string;
  backgroundColor: string | null;
};

type CalendarAccount = {
  id: string;
  email: string;
  calendars: CalendarInfo[];
};

type CalendarEvent = {
  id: string;
  accountId: string;
  calendarId: string;
  calendarKey: string;
  summary: string;
  description: string;
  location: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  status: string;
};

type CalendarState = {
  account_id: string;
  calendar_id: string;
  event_id: string;
  occurrence_date: string;
  is_completed: boolean;
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

function eventStart(event: CalendarEvent) {
  if (!event.start) return null;
  return new Date(event.start + (event.allDay && !event.start.includes("T") ? "T00:00:00" : ""));
}

function eventEnd(event: CalendarEvent) {
  if (!event.end) return null;
  return new Date(event.end + (event.allDay && !event.end.includes("T") ? "T00:00:00" : ""));
}

function eventStateKey(event: CalendarEvent, occurrenceDate: string) {
  return `${event.accountId}|${event.calendarId}|${event.id}|${occurrenceDate}`;
}

function eventTime(event: CalendarEvent) {
  if (event.allDay) return "Tüm gün";
  const start = eventStart(event);
  const end = eventEnd(event);
  if (!start) return "";
  const from = start.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"});
  const to = end?.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"});
  return to ? `${from}–${to}` : from;
}

export function TodoList({ onOpenTodo }: { onOpenTodo?: (todo: Todo) => void | Promise<void> }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarStates, setCalendarStates] = useState<Record<string, boolean>>({});
  const [calendarNames, setCalendarNames] = useState<Record<string,{summary:string;color:string|null}>>({});
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [message, setMessage] = useState("Yükleniyor...");
  const [editMenu, setEditMenu] = useState<{todo:Todo;x:number;y:number}|null>(null);
  const [editTodo, setEditTodo] = useState<Todo | null>(null);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Oturum bulunamadı.");
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }, []);

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

  const loadCalendarForDate = useCallback(async (key: string) => {
    setLoadingCalendar(true);
    try {
      const headers = await authHeaders();
      const [accountsResponse, prefsResult] = await Promise.all([
        fetch("/api/google-calendar/accounts", { headers }),
        supabase.from("user_preferences").select("preferences").maybeSingle(),
      ]);
      const accountsJson = await accountsResponse.json();
      if (!accountsResponse.ok) throw new Error(accountsJson.error || "Takvimler alınamadı.");

      const accounts = (accountsJson.accounts || []) as CalendarAccount[];
      const flat = accounts.flatMap(account => account.calendars.map(calendar => ({
        ...calendar,
        accountId: account.id,
        key: `${account.id}|${calendar.id}`,
      })));

      const prefs = (prefsResult.data?.preferences ?? {}) as Record<string, unknown>;
      const savedKeys = Array.isArray(prefs.calendarTodoEnabledKeys)
        ? prefs.calendarTodoEnabledKeys.filter(item => typeof item === "string") as string[]
        : null;
      const enabledKeys = new Set(
        savedKeys ?? flat
          .filter(calendar => calendar.accessRole === "owner" || calendar.accessRole === "writer")
          .map(calendar => calendar.key)
      );

      const enabled = flat.filter(calendar => enabledKeys.has(calendar.key));
      const names: Record<string,{summary:string;color:string|null}> = {};
      for (const calendar of flat) {
        names[calendar.key] = { summary: calendar.summary, color: calendar.backgroundColor };
      }
      setCalendarNames(names);

      if (!enabled.length) {
        setCalendarEvents([]);
        setCalendarStates({});
        return;
      }

      const start = new Date(key + "T00:00:00");
      const end = new Date(start);
      end.setDate(end.getDate()+1);
      const params = new URLSearchParams({timeMin:start.toISOString(),timeMax:end.toISOString()});
      for (const calendar of enabled) params.append("calendar", calendar.key);

      const [eventsResponse, statesResult] = await Promise.all([
        fetch(`/api/google-calendar/events?${params.toString()}`, { headers }),
        supabase
          .from("calendar_event_state")
          .select("account_id,calendar_id,event_id,occurrence_date,is_completed")
          .eq("occurrence_date", key),
      ]);

      const eventsJson = await eventsResponse.json();
      if (!eventsResponse.ok) throw new Error(eventsJson.error || "Takvim etkinlikleri alınamadı.");
      if (statesResult.error) throw statesResult.error;

      const nextEvents = ((eventsJson.events || []) as CalendarEvent[])
        .filter(event => event.status !== "cancelled")
        .sort((a,b) => {
          if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
          return String(a.start || "").localeCompare(String(b.start || ""));
        });
      const nextStates: Record<string,boolean> = {};
      for (const state of (statesResult.data || []) as CalendarState[]) {
        nextStates[`${state.account_id}|${state.calendar_id}|${state.event_id}|${state.occurrence_date}`] = Boolean(state.is_completed);
      }

      setCalendarEvents(nextEvents);
      setCalendarStates(nextStates);
    } catch (error) {
      setCalendarEvents([]);
      setMessage(error instanceof Error ? error.message : "Takvim etkinlikleri alınamadı.");
    } finally {
      setLoadingCalendar(false);
    }
  }, [authHeaders]);

  useEffect(() => { void loadTodos(); }, [loadTodos]);
  useEffect(() => { void loadCalendarForDate(selectedDate); }, [selectedDate, loadCalendarForDate]);

  const regularVisible = useMemo(
    () => todos.filter(todo => parseMeta(todo.notes).source !== "calendar" && occurs(parseMeta(todo.notes), selectedDate)),
    [todos, selectedDate]
  );

  const regularActive = useMemo(
    () => regularVisible.filter(todo => !stateFor(todo, selectedDate).done),
    [regularVisible, selectedDate]
  );
  const regularCompleted = useMemo(
    () => regularVisible.filter(todo => stateFor(todo, selectedDate).done),
    [regularVisible, selectedDate]
  );

  const calendarActive = useMemo(
    () => calendarEvents.filter(event => !calendarStates[eventStateKey(event,selectedDate)]),
    [calendarEvents,calendarStates,selectedDate]
  );
  const calendarCompleted = useMemo(
    () => calendarEvents.filter(event => calendarStates[eventStateKey(event,selectedDate)]),
    [calendarEvents,calendarStates,selectedDate]
  );

  const totalCount = regularVisible.length + calendarEvents.length;
  const completedCount = regularCompleted.length + calendarCompleted.length;

  async function remove(id: string) {
    if (!window.confirm("Bu Todo silinsin mi?")) return;
    const { error } = await supabase.from("todos").delete().eq("id", id);
    if (error) setMessage(error.message);
    else await loadTodos();
  }

  async function toggleCalendarDone(event: CalendarEvent) {
    const stateKey = eventStateKey(event,selectedDate);
    const next = !calendarStates[stateKey];
    const { data } = await supabase.auth.getSession();
    const ownerId = data.session?.user.id;
    if (!ownerId) {
      setMessage("Oturum bulunamadı.");
      return;
    }

    setCalendarStates(current => ({...current,[stateKey]:next}));
    const { error } = await supabase.from("calendar_event_state").upsert({
      owner_id: ownerId,
      account_id: event.accountId,
      calendar_id: event.calendarId,
      event_id: event.id,
      occurrence_date: selectedDate,
      is_completed: next,
      completed_at: next ? new Date().toISOString() : null,
    }, { onConflict:"owner_id,account_id,calendar_id,event_id,occurrence_date" });

    if (error) {
      setCalendarStates(current => ({...current,[stateKey]:!next}));
      setMessage(error.message);
    }
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
            onClick={e => e.stopPropagation()}
          >
            {target}/{count}
          </div>
        </button>
        <button className="todoDelete" onClick={() => remove(todo.id)}>×</button>
      </article>
    );
  }

  function renderCalendarEvent(event: CalendarEvent) {
    const done = Boolean(calendarStates[eventStateKey(event,selectedDate)]);
    const meta = calendarNames[event.calendarKey];
    return (
      <article className={"todoCard calendarAutoTodo " + (done ? "done" : "")} key={"cal:"+eventStateKey(event,selectedDate)}>
        <button
          className={"calendarTodoCheck " + (done ? "done" : "")}
          onClick={() => void toggleCalendarDone(event)}
          aria-label={done ? "Tamamlandı işaretini kaldır" : "Tamamlandı olarak işaretle"}
        >
          {done ? "✓" : ""}
        </button>
        <div className="calendarTodoTime">{event.allDay ? "Tüm gün" : eventTime(event)}</div>
        <div className="calendarTodoContent">
          <div className="calendarTodoTitleLine">
            <span className="calendarTodoDot" style={meta?.color?{backgroundColor:meta.color}:undefined}/>
            <strong>{event.summary}</strong>
          </div>
          {event.location && <p className="calendarTodoLocation">⌖ {event.location}</p>}
          {event.description && <p className="calendarTodoDescription">{event.description}</p>}
          <span className="todoCalendarBadge">▦ {meta?.summary || "Takvim"}</span>
        </div>
      </article>
    );
  }

  function sortRegular(items: Todo[]) {
    return [...items].sort((a,b) => {
      const ta = a.due_at && a.due_at.startsWith(selectedDate) ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.due_at && b.due_at.startsWith(selectedDate) ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  }

  return (
    <section className="todoPage card" onPointerDown={e => { if (e.target === e.currentTarget) setEditMenu(null); }}>
      <div className="todoPageHead">
        <h2>Günlük Todo</h2>
        <span>{completedCount} / {totalCount}</span>
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
          {calendarActive.map(renderCalendarEvent)}
          {sortRegular(regularActive).map(renderTodo)}
          {!calendarActive.length && !regularActive.length && !loadingCalendar && <div className="todoEmpty">Bekleyen görev veya etkinlik yok.</div>}
          {loadingCalendar && <div className="todoEmpty">Takvim etkinlikleri yükleniyor…</div>}
        </div>
      </div>

      <div className="todoSection completedTodoSection">
        <h3>Tamamlandı</h3>
        <div className="todoCards">
          {calendarCompleted.map(renderCalendarEvent)}
          {sortRegular(regularCompleted).map(renderTodo)}
          {!calendarCompleted.length && !regularCompleted.length && <div className="todoEmpty">Henüz tamamlanan görev yok.</div>}
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
