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
  quran?: {
    tracking?: boolean;
    position?: {
      nodeId?: string;
      page?: number;
      juz?: number;
      surahTitle?: string;
      surahNo?: number;
      ayahNo?: number;
      updatedAt?: string;
    };
  };
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
  defaultReminders?: Array<{ method: string; minutes: number }>;
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
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method: "popup"; minutes: number }>;
  };
};

type CalendarState = {
  account_id: string;
  calendar_id: string;
  event_id: string;
  occurrence_date: string;
  is_completed: boolean;
};

type EventDraft = {
  id: string;
  accountId: string;
  calendarId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  description: string;
  location: string;
  reminderMode: "default" | "none" | "custom";
  reminderMinutes: number[];
};

type CalendarHoverEditor = {
  event: CalendarEvent;
  x: number;
  y: number;
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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function plainCalendarText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|ol|ul)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function reminderMinuteLabel(minutes: number) {
  if (minutes === 0) return "Etkinlik saatinde";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "1 gün önce" : `${days} gün önce`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 saat önce" : `${hours} saat önce`;
  }
  return `${minutes} dk önce`;
}

function eventToDraft(event: CalendarEvent): EventDraft {
  const start = eventStart(event) || new Date();
  const end = eventEnd(event) || addDays(start, 0);
  const overrides = event.reminders?.overrides?.map(item => item.minutes).filter(Number.isFinite) ?? [];
  const reminderMode: EventDraft["reminderMode"] =
    event.reminders?.useDefault === false ? (overrides.length ? "custom" : "none") : "default";
  return {
    id: event.id,
    accountId: event.accountId,
    calendarId: event.calendarId,
    title: event.summary,
    date: dateKey(start),
    startTime: start.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hour12:false}),
    endTime: end.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hour12:false}),
    allDay: event.allDay,
    description: plainCalendarText(event.description || ""),
    location: event.location || "",
    reminderMode,
    reminderMinutes: overrides.sort((a,b)=>a-b),
  };
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

export function TodoList({ onOpenTodo, compact = false }: { onOpenTodo?: (todo: Todo) => void | Promise<void>; compact?: boolean }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarStates, setCalendarStates] = useState<Record<string, boolean>>({});
  const [calendarNames, setCalendarNames] = useState<Record<string,{summary:string;color:string|null}>>({});
  const [calendarAccounts, setCalendarAccounts] = useState<CalendarAccount[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [calendarHover, setCalendarHover] = useState<CalendarHoverEditor | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<EventDraft | null>(null);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const hoverOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      setCalendarAccounts(accounts);
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
  useEffect(() => {
    const refreshTodos = () => void loadTodos();
    window.addEventListener("lumen-todos-changed", refreshTodos);
    return () => window.removeEventListener("lumen-todos-changed", refreshTodos);
  }, [loadTodos]);
  useEffect(() => { void loadCalendarForDate(selectedDate); }, [selectedDate, loadCalendarForDate]);
  useEffect(() => {
    const refresh = () => void loadCalendarForDate(selectedDate);
    window.addEventListener("lumen-calendar-sources-changed", refresh);
    return () => window.removeEventListener("lumen-calendar-sources-changed", refresh);
  }, [selectedDate, loadCalendarForDate]);

  useEffect(() => () => {
    if (hoverOpenTimer.current) clearTimeout(hoverOpenTimer.current);
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
  }, []);

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
    else {
      await loadTodos();
      window.dispatchEvent(new CustomEvent("lumen-todos-changed"));
    }
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
            {meta.quran?.tracking && meta.quran.position && (
              <p className="todoQuranPosition">
                🔖 Kaldığın yer: Sayfa {meta.quran.position.page || "—"}
                {meta.quran.position.juz ? ` · Cüz ${meta.quran.position.juz}` : ""}
                {meta.quran.position.surahTitle ? ` · ${meta.quran.position.surahTitle}` : ""}
                {meta.quran.position.ayahNo ? ` ${meta.quran.position.ayahNo}. ayet` : ""}
              </p>
            )}
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


  function cancelCalendarHoverOpen() {
    if (hoverOpenTimer.current) clearTimeout(hoverOpenTimer.current);
    hoverOpenTimer.current = null;
  }

  function cancelCalendarHoverClose() {
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = null;
  }

  function scheduleCalendarHover(event: CalendarEvent, target: HTMLElement) {
    if (window.matchMedia("(hover: none)").matches) return;
    cancelCalendarHoverOpen();
    cancelCalendarHoverClose();

    const rect = target.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    const estimatedHeight = 390;
    const gap = 10;
    let x = rect.left - width - gap;
    if (x < 12) x = rect.right + gap;
    x = Math.max(12, Math.min(x, window.innerWidth - width - 12));
    let y = rect.top;
    if (y + estimatedHeight > window.innerHeight - 12) y = window.innerHeight - estimatedHeight - 12;
    y = Math.max(12, y);

    hoverOpenTimer.current = setTimeout(() => {
      setCalendarHover({event,x,y});
      setCalendarDraft(eventToDraft(event));
      hoverOpenTimer.current = null;
    }, 180);
  }

  function scheduleCalendarHoverClose() {
    cancelCalendarHoverOpen();
    cancelCalendarHoverClose();
    hoverCloseTimer.current = setTimeout(() => {
      setCalendarHover(null);
      setCalendarDraft(null);
      hoverCloseTimer.current = null;
    }, 160);
  }

  function keepCalendarHoverOpen() {
    cancelCalendarHoverClose();
  }

  async function persistCalendarDraft(current: EventDraft) {
    if (!current.title.trim()) throw new Error("Başlık gerekli.");
    const headers = await authHeaders();
    let eventPayload: Record<string, unknown>;

    if (current.allDay) {
      const nextDay = addDays(new Date(current.date + "T00:00:00"), 1);
      eventPayload = {
        summary: current.title.trim(),
        description: current.description,
        location: current.location,
        start: {date: current.date},
        end: {date: dateKey(nextDay)},
      };
    } else {
      const start = new Date(`${current.date}T${current.startTime}:00`);
      const end = new Date(`${current.date}T${current.endTime}:00`);
      if (end <= start) end.setDate(end.getDate() + 1);
      eventPayload = {
        summary: current.title.trim(),
        description: current.description,
        location: current.location,
        start: {dateTime: start.toISOString()},
        end: {dateTime: end.toISOString()},
      };
    }

    eventPayload.reminders =
      current.reminderMode === "default"
        ? {useDefault:true}
        : current.reminderMode === "none"
          ? {useDefault:false,overrides:[]}
          : {
              useDefault:false,
              overrides:current.reminderMinutes.map(minutes => ({method:"popup",minutes})),
            };

    const response = await fetch("/api/google-calendar/events", {
      method:"PATCH",
      headers,
      body:JSON.stringify({
        accountId:current.accountId,
        calendarId:current.calendarId,
        eventId:current.id,
        event:eventPayload,
      }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Etkinlik kaydedilemedi.");
  }

  async function saveCalendarHover() {
    if (!calendarDraft) return;
    setCalendarSaving(true);
    try {
      await persistCalendarDraft(calendarDraft);
      setCalendarHover(null);
      setCalendarDraft(null);
      await loadCalendarForDate(selectedDate);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Etkinlik kaydedilemedi.");
    } finally {
      setCalendarSaving(false);
    }
  }

  function ReminderEditor({draft,currentSet}:{draft:EventDraft;currentSet:(next:EventDraft)=>void}) {
    const presets = [
      {label:"10 dk",minutes:10},
      {label:"30 dk",minutes:30},
      {label:"1 saat",minutes:60},
      {label:"1 gün",minutes:1440},
    ];
    const selectedCalendar = calendarAccounts
      .find(account=>account.id===draft.accountId)
      ?.calendars.find(calendar=>calendar.id===draft.calendarId);
    const defaults = selectedCalendar?.defaultReminders || [];
    const defaultText = defaults.length
      ? defaults.map(item=>reminderMinuteLabel(Number(item.minutes || 0))).join(" · ")
      : "Bu takvimde varsayılan hatırlatma yok";

    function choosePreset(minutes:number) {
      const active=draft.reminderMode==="custom" && draft.reminderMinutes.includes(minutes);
      if(active) {
        const nextMinutes=draft.reminderMinutes.filter(value=>value!==minutes);
        currentSet({
          ...draft,
          reminderMode:nextMinutes.length ? "custom" : "none",
          reminderMinutes:nextMinutes,
        });
        return;
      }
      const base=draft.reminderMode==="custom" ? draft.reminderMinutes : [];
      currentSet({
        ...draft,
        reminderMode:"custom",
        reminderMinutes:[...base,minutes].filter((value,index,array)=>array.indexOf(value)===index).sort((a,b)=>a-b),
      });
    }

    return (
      <div className="calendarReminderEditor calendarReminderButtons compact">
        <div className="calendarReminderInline">
          <span className="calendarReminderLabel">Hatırlatma</span>
          <div className="calendarReminderChoiceRow">
            <button
              type="button"
              className={draft.reminderMode==="default" ? "active" : ""}
              onClick={()=>currentSet({...draft,reminderMode:"default",reminderMinutes:[]})}
            >
              Varsayılan
            </button>
            <button
              type="button"
              className={draft.reminderMode==="none" ? "active" : ""}
              onClick={()=>currentSet({...draft,reminderMode:"none",reminderMinutes:[]})}
            >
              Yok
            </button>
            {presets.map(item=>(
              <button
                type="button"
                key={item.minutes}
                className={draft.reminderMode==="custom" && draft.reminderMinutes.includes(item.minutes) ? "active" : ""}
                onClick={()=>choosePreset(item.minutes)}
              >
                {item.label}
              </button>
            ))}
            <input
              type="number"
              min={0}
              step={5}
              placeholder="dk"
              title="Özel dakika"
              onKeyDown={e=>{
                if(e.key!=="Enter") return;
                const value=Number(e.currentTarget.value);
                if(Number.isFinite(value) && value>=0) {
                  const base=draft.reminderMode==="custom" ? draft.reminderMinutes : [];
                  currentSet({
                    ...draft,
                    reminderMode:"custom",
                    reminderMinutes:[...base,value].filter((item,index,array)=>array.indexOf(item)===index).sort((a,b)=>a-b),
                  });
                  e.currentTarget.value="";
                }
              }}
            />
          </div>
        </div>
        {draft.reminderMode==="default" && (
          <div className="calendarReminderDefaultText">Varsayılan: {defaultText}</div>
        )}
      </div>
    );
  }

  function renderCalendarEvent(event: CalendarEvent) {
    const done = Boolean(calendarStates[eventStateKey(event,selectedDate)]);
    const meta = calendarNames[event.calendarKey];
    return (
      <article
        className={"todoCard calendarAutoTodo " + (done ? "done" : "")}
        key={"cal:"+eventStateKey(event,selectedDate)}
        onMouseEnter={e=>scheduleCalendarHover(event,e.currentTarget)}
        onMouseLeave={scheduleCalendarHoverClose}
      >
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
    <section className={"todoPage card " + (compact ? "todoPageCompact" : "")} onPointerDown={e => { if (e.target === e.currentTarget) setEditMenu(null); }}>
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


      {calendarHover && calendarDraft && (
        <div
          className="calendarEventPreview calendarEventQuickEditor todoCalendarHoverEditor"
          style={{left:calendarHover.x,top:calendarHover.y,["--preview-color" as string]:calendarNames[calendarHover.event.calendarKey]?.color || "var(--accent)"}}
          onMouseEnter={keepCalendarHoverOpen}
          onMouseLeave={scheduleCalendarHoverClose}
          role="dialog"
          aria-label={calendarHover.event.summary + " etkinlik ayrıntıları"}
        >
          <div className="calendarEventPreviewAccent"/>
          <input
            className="calendarQuickTitle"
            value={calendarDraft.title}
            onChange={e=>setCalendarDraft({...calendarDraft,title:e.target.value})}
            onFocus={keepCalendarHoverOpen}
            aria-label="Etkinlik başlığı"
          />
          <div className="calendarQuickDateRow">
            <input type="date" value={calendarDraft.date} onChange={e=>setCalendarDraft({...calendarDraft,date:e.target.value})}/>
            <label className="calendarQuickAllDay">
              <input type="checkbox" checked={calendarDraft.allDay} onChange={e=>setCalendarDraft({...calendarDraft,allDay:e.target.checked})}/>
              Tüm gün
            </label>
          </div>
          {!calendarDraft.allDay && (
            <div className="calendarQuickTimeRow">
              <input type="time" value={calendarDraft.startTime} onChange={e=>setCalendarDraft({...calendarDraft,startTime:e.target.value})}/>
              <span>–</span>
              <input type="time" value={calendarDraft.endTime} onChange={e=>setCalendarDraft({...calendarDraft,endTime:e.target.value})}/>
            </div>
          )}
          <select
            className="calendarQuickCalendar"
            value={calendarDraft.accountId+"|"+calendarDraft.calendarId}
            onChange={e=>{
              const split=e.target.value.indexOf("|");
              setCalendarDraft({...calendarDraft,accountId:e.target.value.slice(0,split),calendarId:e.target.value.slice(split+1)});
            }}
          >
            {calendarAccounts.flatMap(account=>account.calendars
              .filter(calendar=>calendar.accessRole==="owner"||calendar.accessRole==="writer")
              .map(calendar=><option key={account.id+"|"+calendar.id} value={account.id+"|"+calendar.id}>{account.email} · {calendar.summary}</option>)
            )}
          </select>
          <input
            className="calendarQuickLocation"
            placeholder="Konum"
            value={calendarDraft.location}
            onChange={e=>setCalendarDraft({...calendarDraft,location:e.target.value})}
          />
          <textarea
            className="calendarQuickDescription"
            placeholder="Açıklama"
            rows={3}
            value={calendarDraft.description}
            onChange={e=>setCalendarDraft({...calendarDraft,description:e.target.value})}
          />
          <ReminderEditor draft={calendarDraft} currentSet={setCalendarDraft}/>
          <div className="calendarQuickTodoRow">
            <button
              className={calendarStates[eventStateKey(calendarHover.event,selectedDate)] ? "calendarTodoDone active" : "calendarTodoDone"}
              onClick={()=>void toggleCalendarDone(calendarHover.event)}
            >
              {calendarStates[eventStateKey(calendarHover.event,selectedDate)] ? "✓ Tamamlandı" : "○ Tamamlandı olarak işaretle"}
            </button>
            <span className="calendarAutoTodoHint">TODO'da otomatik görünür</span>
          </div>
          <div className="calendarQuickActions">
            <span className="calendarQuickSource">
              <i style={calendarNames[calendarHover.event.calendarKey]?.color?{backgroundColor:calendarNames[calendarHover.event.calendarKey]?.color || undefined}:undefined}/>
              {calendarNames[calendarHover.event.calendarKey]?.summary || "Takvim"}
            </span>
            <button className="secondary" onClick={()=>{setCalendarHover(null);setCalendarDraft(null);}}>Kapat</button>
            <button className="primary" disabled={calendarSaving || !calendarDraft.title.trim()} onClick={()=>void saveCalendarHover()}>
              {calendarSaving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </div>
      )}

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
