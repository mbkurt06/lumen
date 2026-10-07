"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

type ViewMode = "year" | "month" | "week" | "3day" | "day" | "list";
type ListRange = "day" | "week" | "month" | "year" | "remainingYear" | "custom";
type MonthDensity = "comfortable" | "compact";

type CalendarInfo = {
  id: string;
  summary: string;
  primary: boolean;
  selected: boolean;
  backgroundColor: string | null;
  foregroundColor: string | null;
  accessRole: string;
  timeZone: string | null;
  defaultReminders?: Array<{ method: string; minutes: number }>;
};

type CalendarAccount = {
  id: string;
  email: string;
  displayName: string | null;
  calendars: CalendarInfo[];
  error?: string;
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
  htmlLink: string;
  colorId: string | null;
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method: "popup"; minutes: number }>;
  };
};

type EventDraft = {
  id?: string;
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

type EventHoverPreview = {
  event: CalendarEvent;
  x: number;
  y: number;
};

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

function localDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}
function startOfWeek(date: Date) {
  const d = startOfDay(date);
  const weekday = (d.getDay() + 6) % 7;
  return addDays(d, -weekday);
}
function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}
function sameDay(a: Date, b: Date) {
  return localDateKey(a) === localDateKey(b);
}
function isoWeekNumber(date: Date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
function eventStart(event: CalendarEvent) {
  return event.start ? new Date(event.start + (event.allDay && !event.start.includes("T") ? "T00:00:00" : "")) : null;
}
function eventEnd(event: CalendarEvent) {
  return event.end ? new Date(event.end + (event.allDay && !event.end.includes("T") ? "T00:00:00" : "")) : null;
}
function timeLabel(event: CalendarEvent) {
  if (event.allDay) return "Tüm gün";
  const start = eventStart(event);
  return start ? start.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "";
}
function keyFor(accountId: string, calendarId: string) {
  return `${accountId}|${calendarId}`;
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

export function CalendarView({ user, externalSources = false }: { user: User; externalSources?: boolean }) {
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [todoCalendarKeys, setTodoCalendarKeys] = useState<Set<string> | null>(null);
  const [calendarCompletion, setCalendarCompletion] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [listRange, setListRange] = useState<ListRange>("month");
  const [customStart, setCustomStart] = useState(() => localDateKey(startOfMonth(new Date())));
  const [customEnd, setCustomEnd] = useState(() => localDateKey(addDays(addMonths(startOfMonth(new Date()), 1), -1)));
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [message, setMessage] = useState("");
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
  const [sourcePanelWidth, setSourcePanelWidth] = useState(250);
  const [sourcePanelResizing, setSourcePanelResizing] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const yearlyTodayRef = useRef<HTMLDivElement | null>(null);
  const [yearlyAutoScrollPending, setYearlyAutoScrollPending] = useState(false);
  const [monthDensity, setMonthDensity] = useState<MonthDensity>("comfortable");
  const [showWeekNumbers, setShowWeekNumbers] = useState(true);
  const [draggingEventKey, setDraggingEventKey] = useState<string | null>(null);
  const [monthDropDate, setMonthDropDate] = useState<string | null>(null);
  const [calendarPrefsOpen, setCalendarPrefsOpen] = useState(false);
  const [showWeekends, setShowWeekends] = useState(true);
  const [weekDaysMode, setWeekDaysMode] = useState<5 | 7>(7);
  const [dayStartHour, setDayStartHour] = useState(6);
  const [dayEndHour, setDayEndHour] = useState(22);
  const [hourDensity, setHourDensity] = useState<36 | 48 | 64>(48);
  const [autoScrollNow, setAutoScrollNow] = useState(true);
  const timeScrollRef = useRef<HTMLDivElement | null>(null);
  const [eventHover, setEventHover] = useState<EventHoverPreview | null>(null);
  const [hoverDraft, setHoverDraft] = useState<EventDraft | null>(null);
  const [hoverSaving, setHoverSaving] = useState(false);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const eventPreviewRef = useRef<HTMLDivElement | null>(null);
  const [draftPosition, setDraftPosition] = useState<{x:number;y:number}|null>(null);
  const eventEditorRef = useRef<HTMLDivElement | null>(null);

  const authHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Oturum bulunamadı.");
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }, []);

  const loadPreferences = useCallback(async () => {
    const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    const prefs = (data?.preferences ?? {}) as Record<string, unknown>;
    const hidden = Array.isArray(prefs.calendarHiddenKeys) ? prefs.calendarHiddenKeys.filter(x => typeof x === "string") as string[] : [];
    setHiddenKeys(new Set(hidden));
    if (Array.isArray(prefs.calendarTodoEnabledKeys)) {
      setTodoCalendarKeys(new Set(prefs.calendarTodoEnabledKeys.filter(x => typeof x === "string") as string[]));
    } else {
      setTodoCalendarKeys(null);
    }
    const savedView = prefs.calendarView;
    if (savedView === "year" || savedView === "month" || savedView === "week" || savedView === "3day" || savedView === "day" || savedView === "list") {
      setView(savedView);
    }

    const savedListRange = prefs.calendarListRange;
    if (
      savedListRange === "day" ||
      savedListRange === "week" ||
      savedListRange === "month" ||
      savedListRange === "year" ||
      savedListRange === "remainingYear" ||
      savedListRange === "custom"
    ) {
      setListRange(savedListRange);
    }

    if (typeof prefs.calendarAnchor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(prefs.calendarAnchor)) {
      const restoredAnchor = new Date(prefs.calendarAnchor + "T12:00:00");
      if (!Number.isNaN(restoredAnchor.getTime())) setAnchor(restoredAnchor);
    }

    if (typeof prefs.calendarCustomStart === "string") setCustomStart(prefs.calendarCustomStart);
    if (typeof prefs.calendarCustomEnd === "string") setCustomEnd(prefs.calendarCustomEnd);
    if (typeof prefs.calendarSourcesOpen === "boolean") setSourcePanelOpen(prefs.calendarSourcesOpen);
    if (typeof prefs.calendarSourcesWidth === "number") {
      setSourcePanelWidth(Math.max(180, Math.min(420, prefs.calendarSourcesWidth)));
    }
    if (prefs.calendarMonthDensity === "compact" || prefs.calendarMonthDensity === "comfortable") {
      setMonthDensity(prefs.calendarMonthDensity);
    }
    if (typeof prefs.calendarShowWeekNumbers === "boolean") {
      setShowWeekNumbers(prefs.calendarShowWeekNumbers);
    }
    if (typeof prefs.calendarShowWeekends === "boolean") setShowWeekends(prefs.calendarShowWeekends);
    if (prefs.calendarWeekDaysMode === 5 || prefs.calendarWeekDaysMode === 7) setWeekDaysMode(prefs.calendarWeekDaysMode);
    if (typeof prefs.calendarDayStartHour === "number") setDayStartHour(Math.max(0, Math.min(12, prefs.calendarDayStartHour)));
    if (typeof prefs.calendarDayEndHour === "number") setDayEndHour(Math.max(12, Math.min(24, prefs.calendarDayEndHour)));
    if (prefs.calendarHourDensity === 36 || prefs.calendarHourDensity === 48 || prefs.calendarHourDensity === 64) setHourDensity(prefs.calendarHourDensity);
    if (typeof prefs.calendarAutoScrollNow === "boolean") setAutoScrollNow(prefs.calendarAutoScrollNow);
  }, []);

  const saveCalendarPrefs = useCallback(async (nextHidden: Set<string>, nextView = view) => {
    const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    const old = (data?.preferences ?? {}) as Record<string, unknown>;
    await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: {
        ...old,
        calendarHiddenKeys: [...nextHidden],
        calendarView: nextView,
      },
    });
  }, [user.id, view]);

  const saveMonthPrefs = useCallback(async (density: MonthDensity, weekNumbers: boolean) => {
    const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    const old = (data?.preferences ?? {}) as Record<string, unknown>;
    await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: {
        ...old,
        calendarMonthDensity: density,
        calendarShowWeekNumbers: weekNumbers,
      },
    });
  }, [user.id]);

  const saveViewPrefs = useCallback(async (patch: Record<string, unknown>) => {
    const { data } = await supabase.from("user_preferences").select("preferences").maybeSingle();
    const old = (data?.preferences ?? {}) as Record<string, unknown>;
    await supabase.from("user_preferences").upsert({
      owner_id: user.id,
      preferences: { ...old, ...patch },
    });
  }, [user.id]);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/google-calendar/accounts", { headers });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Google takvim hesapları alınamadı.");
      setAccounts(json.accounts || []);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google takvim hesapları alınamadı.");
    } finally {
      setLoadingAccounts(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadPreferences();
    void loadAccounts();

    const params = new URLSearchParams(location.search);
    if (params.get("calendar") === "connected") {
      setMessage("Google Takvim hesabı bağlandı.");
      history.replaceState({}, "", location.pathname);
    } else if (params.get("calendar") === "error") {
      setMessage(params.get("message") || "Google Takvim bağlantısı başarısız.");
      history.replaceState({}, "", location.pathname);
    }
  }, [loadAccounts, loadPreferences]);

  const flatCalendars = useMemo(() =>
    accounts.flatMap(account => account.calendars.map(calendar => ({
      ...calendar,
      accountId: account.id,
      accountEmail: account.email,
      key: keyFor(account.id, calendar.id),
    }))), [accounts]);

  const visibleCalendars = useMemo(
    () => flatCalendars.filter(calendar => !hiddenKeys.has(calendar.key)),
    [flatCalendars, hiddenKeys]
  );

  const range = useMemo(() => {
    if (view === "year") {
      const start = startOfYear(anchor);
      return { start, end: new Date(anchor.getFullYear() + 1, 0, 1) };
    }
    if (view === "month") {
      const monthStart = startOfMonth(anchor);
      const start = startOfWeek(monthStart);
      const nextMonth = addMonths(monthStart, 1);
      const endWeek = startOfWeek(nextMonth);
      const end = endWeek < nextMonth ? addDays(endWeek, 7) : endWeek;
      return { start, end };
    }
    if (view === "week") {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 7) };
    }
    if (view === "3day") {
      const start = startOfDay(anchor);
      return { start, end: addDays(start, 3) };
    }
    if (view === "day") {
      const start = startOfDay(anchor);
      return { start, end: addDays(start, 1) };
    }

    if (listRange === "custom") {
      const start = new Date(customStart + "T00:00:00");
      const end = addDays(new Date(customEnd + "T00:00:00"), 1);
      return { start, end };
    }
    if (listRange === "day") {
      const start = startOfDay(anchor);
      return { start, end: addDays(start, 1) };
    }
    if (listRange === "week") {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 7) };
    }
    if (listRange === "year") {
      const start = startOfYear(anchor);
      return { start, end: new Date(anchor.getFullYear() + 1, 0, 1) };
    }
    if (listRange === "remainingYear") {
      const today = startOfDay(new Date());
      const targetYear = today.getFullYear();
      return { start: today, end: new Date(targetYear + 1, 0, 1) };
    }
    const start = startOfMonth(anchor);
    return { start, end: addMonths(start, 1) };
  }, [anchor, view, listRange, customStart, customEnd]);

  const loadEvents = useCallback(async () => {
    if (!visibleCalendars.length) {
      setEvents([]);
      return;
    }
    setLoadingEvents(true);
    try {
      const headers = await authHeaders();
      const params = new URLSearchParams({
        timeMin: range.start.toISOString(),
        timeMax: range.end.toISOString(),
      });
      for (const calendar of visibleCalendars) params.append("calendar", calendar.key);
      const response = await fetch(`/api/google-calendar/events?${params.toString()}`, { headers });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Etkinlikler alınamadı.");
      const nextEvents = (json.events || []) as CalendarEvent[];
      setEvents(nextEvents);

      const startKey = localDateKey(range.start);
      const endKey = localDateKey(addDays(range.end,-1));
      const { data: completionRows, error: completionError } = await supabase
        .from("calendar_event_state")
        .select("account_id,calendar_id,event_id,occurrence_date,is_completed")
        .gte("occurrence_date", startKey)
        .lte("occurrence_date", endKey);
      if (completionError) throw completionError;

      const nextCompletion: Record<string,boolean> = {};
      for (const row of completionRows || []) {
        nextCompletion[`${row.account_id}|${row.calendar_id}|${row.event_id}|${row.occurrence_date}`] = Boolean(row.is_completed);
      }
      setCalendarCompletion(nextCompletion);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Etkinlikler alınamadı.");
    } finally {
      setLoadingEvents(false);
    }
  }, [authHeaders, range.start.getTime(), range.end.getTime(), visibleCalendars.map(x => x.key).join("§")]);

  useEffect(() => {
    if (!loadingAccounts) void loadEvents();
  }, [loadingAccounts, loadEvents]);

  useEffect(() => {
    const refresh = () => {
      void loadPreferences();
      void loadAccounts();
    };
    window.addEventListener("lumen-calendar-sources-changed", refresh);
    return () => window.removeEventListener("lumen-calendar-sources-changed", refresh);
  }, [loadPreferences, loadAccounts]);

  async function connectGoogle() {
    if (googleConnecting) return;
    setGoogleConnecting(true);
    setMessage("");
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/google-calendar/connect", { method: "POST", headers });
      const json = await response.json();
      if (!response.ok) {
        if (json.code === "GOOGLE_CALENDAR_NOT_CONFIGURED") {
          throw new Error("Google Takvim bağlantısı henüz yapılandırılmamış. Ayarlar → Google Takvim bölümündeki OAuth bilgilerini tamamlayın.");
        }
        throw new Error(json.error || "Google hesabı bağlantısı başlatılamadı.");
      }
      if (!json.url) throw new Error("Google yetkilendirme adresi oluşturulamadı.");
      window.location.assign(json.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google hesabı bağlantısı başlatılamadı.");
      setGoogleConnecting(false);
    }
  }

  async function disconnectAccount(accountId: string) {
    if (!confirm("Bu Google hesabını Lumen Takvim'den kaldırmak istiyor musunuz?")) return;
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/google-calendar/accounts", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ accountId }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Hesap kaldırılamadı.");
      await loadAccounts();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Hesap kaldırılamadı.");
    }
  }

  function toggleCalendar(key: string) {
    setHiddenKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      void saveCalendarPrefs(next);
      return next;
    });
  }

  function defaultTodoCalendarKeys() {
    return new Set(
      flatCalendars
        .filter(calendar => calendar.accessRole === "owner" || calendar.accessRole === "writer")
        .map(calendar => calendar.key)
    );
  }

  function isTodoCalendarEnabled(calendar: {key:string;accessRole:string}) {
    return (todoCalendarKeys ?? defaultTodoCalendarKeys()).has(calendar.key);
  }

  function toggleTodoCalendar(key: string) {
    setTodoCalendarKeys(current => {
      const next = new Set(current ?? defaultTodoCalendarKeys());
      if (next.has(key)) next.delete(key);
      else next.add(key);
      void saveViewPrefs({ calendarTodoEnabledKeys:[...next] });
      return next;
    });
  }

  function completionKey(event: CalendarEvent, date: Date | string) {
    const day = typeof date === "string" ? date : localDateKey(date);
    return `${event.accountId}|${event.calendarId}|${event.id}|${day}`;
  }

  function isEventCompleted(event: CalendarEvent, date?: Date) {
    const fallback = eventStart(event) || new Date();
    return Boolean(calendarCompletion[completionKey(event,date ?? fallback)]);
  }

  async function toggleEventCompleted(event: CalendarEvent, date?: Date) {
    const occurrence = localDateKey(date ?? eventStart(event) ?? new Date());
    const key = completionKey(event, occurrence);
    const next = !calendarCompletion[key];

    setCalendarCompletion(current => ({...current,[key]:next}));
    const { error } = await supabase.from("calendar_event_state").upsert({
      owner_id:user.id,
      account_id:event.accountId,
      calendar_id:event.calendarId,
      event_id:event.id,
      occurrence_date:occurrence,
      is_completed:next,
      completed_at:next ? new Date().toISOString() : null,
    }, { onConflict:"owner_id,account_id,calendar_id,event_id,occurrence_date" });

    if (error) {
      setCalendarCompletion(current => ({...current,[key]:!next}));
      setMessage(error.message);
    }
  }

  function setViewAndSave(next: ViewMode) {
    setView(next);
    let nextAnchor = anchor;

    if (next === "list" && listRange === "year") {
      nextAnchor = new Date();
      setAnchor(nextAnchor);
      setYearlyAutoScrollPending(true);
    }

    void saveViewPrefs({
      calendarView: next,
      calendarListRange: listRange,
      calendarAnchor: localDateKey(nextAnchor),
    });
  }

  function setListRangeAndScroll(next: ListRange) {
    setListRange(next);
    let nextAnchor = anchor;

    if (next === "year") {
      nextAnchor = new Date();
      setAnchor(nextAnchor);
      setYearlyAutoScrollPending(true);
    } else if (next === "remainingYear") {
      nextAnchor = new Date();
      setAnchor(nextAnchor);
      setYearlyAutoScrollPending(false);
    }

    void saveViewPrefs({
      calendarView: "list",
      calendarListRange: next,
      calendarAnchor: localDateKey(nextAnchor),
    });
  }

  useEffect(() => {
    if (!yearlyAutoScrollPending) return;
    if (view !== "list" || listRange !== "year" || loadingEvents) return;

    const id = window.requestAnimationFrame(() => {
      yearlyTodayRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      window.scrollBy({ top: -76, behavior: "auto" });
      setYearlyAutoScrollPending(false);
    });

    return () => window.cancelAnimationFrame(id);
  }, [yearlyAutoScrollPending, view, listRange, loadingEvents, events.length]);

  function move(delta: number) {
    let next: Date;
    if (view === "year") next = new Date(anchor.getFullYear() + delta, anchor.getMonth(), 1);
    else if (view === "month") next = addMonths(anchor, delta);
    else if (view === "week") next = addDays(anchor, delta * 7);
    else if (view === "3day") next = addDays(anchor, delta * 3);
    else if (view === "day") next = addDays(anchor, delta);
    else {
      const step = listRange === "year" ? 365 : listRange === "remainingYear" ? 365 : listRange === "month" ? 31 : listRange === "week" ? 7 : 1;
      next = addDays(anchor, delta * step);
    }
    setAnchor(next);
    void saveViewPrefs({ calendarAnchor: localDateKey(next) });
  }

  function goToday() {
    const today = new Date();
    setAnchor(today);
    void saveViewPrefs({ calendarAnchor: localDateKey(today) });
  }

  function toggleSourcesPanel() {
    setSourcePanelOpen(open => {
      const next = !open;
      void saveViewPrefs({ calendarSourcesOpen: next });
      return next;
    });
  }

  function beginSourcesResize(event: React.PointerEvent<HTMLDivElement>) {
    if (window.innerWidth <= 800) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sourcePanelWidth;
    setSourcePanelResizing(true);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      setSourcePanelWidth(Math.max(180, Math.min(420, startWidth + delta)));
    };

    const onUp = (upEvent: PointerEvent) => {
      const delta = startX - upEvent.clientX;
      const nextWidth = Math.max(180, Math.min(420, startWidth + delta));
      setSourcePanelWidth(nextWidth);
      setSourcePanelResizing(false);
      void saveViewPrefs({ calendarSourcesWidth: nextWidth });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const title = useMemo(() => {
    if (view === "year") return String(anchor.getFullYear());
    if (view === "month") return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
    if (view === "day") return anchor.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (view === "3day") {
      const end = addDays(anchor, 2);
      return `${anchor.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    if (view === "week") {
      const start = startOfWeek(anchor);
      const end = addDays(start, 6);
      return `${start.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    if (view === "list" && listRange === "remainingYear") return "Bugünden yıl sonuna";
    return "Etkinlik listesi";
  }, [anchor, view]);

  function eventOccursOn(event: CalendarEvent, date: Date) {
    const start = eventStart(event);
    const end = eventEnd(event);
    if (!start) return false;

    const dayStart = startOfDay(date).getTime();
    const dayEnd = addDays(startOfDay(date), 1).getTime();

    const eventStartMs = start.getTime();
    let eventEndMs = end?.getTime() ?? (eventStartMs + 1);

    // Google all-day event end dates are exclusive.
    if (event.allDay && end) eventEndMs = Math.max(eventStartMs + 1, eventEndMs - 1);

    return eventStartMs < dayEnd && eventEndMs >= dayStart;
  }

  function eventsOn(date: Date) {
    return events.filter(event => eventOccursOn(event, date));
  }

  function calendarMeta(event: CalendarEvent) {
    return flatCalendars.find(calendar => calendar.key === event.calendarKey);
  }

  function cancelHoverOpen() {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
  }

  function cancelHoverClose() {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }

  function scheduleEventHover(event: CalendarEvent, target: HTMLElement) {
    if (window.matchMedia("(hover: none)").matches) return;
    cancelHoverOpen();
    cancelHoverClose();

    const rect = target.getBoundingClientRect();
    const cardWidth = Math.min(360, window.innerWidth - 24);
    const cardHeight = 280;
    const gap = 10;

    let x = rect.right + gap;
    if (x + cardWidth > window.innerWidth - 12) x = rect.left - cardWidth - gap;
    x = Math.max(12, Math.min(x, window.innerWidth - cardWidth - 12));

    let y = rect.top;
    if (y + cardHeight > window.innerHeight - 12) y = window.innerHeight - cardHeight - 12;
    y = Math.max(12, y);

    hoverOpenTimerRef.current = window.setTimeout(() => {
      setEventHover({ event, x, y });
      setHoverDraft(eventToDraft(event));
      hoverOpenTimerRef.current = null;
    }, 180);
  }

  function scheduleHoverClose() {
    cancelHoverOpen();
    cancelHoverClose();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setEventHover(null);
      setHoverDraft(null);
      hoverCloseTimerRef.current = null;
    }, 140);
  }

  function keepHoverOpen() {
    cancelHoverClose();
  }

  function formatHoverDate(event: CalendarEvent) {
    const start = eventStart(event);
    const end = eventEnd(event);
    if (!start) return "";

    if (event.allDay) {
      const effectiveEnd = end ? addDays(startOfDay(end), -1) : start;
      if (effectiveEnd && !sameDay(start, effectiveEnd)) {
        return `${start.toLocaleDateString("tr-TR",{weekday:"short",day:"numeric",month:"long"})} – ${effectiveEnd.toLocaleDateString("tr-TR",{weekday:"short",day:"numeric",month:"long",year:"numeric"})} · Tüm gün`;
      }
      return `${start.toLocaleDateString("tr-TR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · Tüm gün`;
    }

    const date = start.toLocaleDateString("tr-TR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
    const startTime = start.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"});
    const endTime = end?.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"});
    return `${date} · ${startTime}${endTime ? "–"+endTime : ""}`;
  }

  function formatHoverDuration(event: CalendarEvent) {
    if (event.allDay) return "";
    const start = eventStart(event);
    const end = eventEnd(event);
    if (!start || !end) return "";
    const minutes = Math.max(0, Math.round((end.getTime()-start.getTime())/60000));
    if (minutes < 60) return `${minutes} dk`;
    const hours = Math.floor(minutes/60);
    const rest = minutes%60;
    return rest ? `${hours} sa ${rest} dk` : `${hours} sa`;
  }

  function calendarEventLinkKey(event: Pick<CalendarEvent,"accountId"|"calendarId"|"id">) {
    return `${event.accountId}|${event.calendarId}|${event.id}`;
  }

  function eventToDraft(event: CalendarEvent): EventDraft {
    const start = eventStart(event) || new Date();
    const end = eventEnd(event) || addDays(start, 0);
    return {
      id: event.id,
      accountId: event.accountId,
      calendarId: event.calendarId,
      title: event.summary,
      date: localDateKey(start),
      startTime: event.allDay ? "09:00" : start.toTimeString().slice(0,5),
      endTime: event.allDay ? "10:00" : end.toTimeString().slice(0,5),
      allDay: event.allDay,
      description: plainCalendarText(event.description || ""),
      location: event.location,
      reminderMode: event.reminders?.useDefault === false
        ? ((event.reminders?.overrides?.length || 0) > 0 ? "custom" : "none")
        : "default",
      reminderMinutes: (event.reminders?.overrides || []).map(item => Number(item.minutes)).filter(Number.isFinite),
    };
  }

  function positionForPoint(x: number, y: number, width = 420, height = 560) {
    const gap = 10;
    let left = x + gap;
    if (left + width > window.innerWidth - 12) left = x - width - gap;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));

    let top = y;
    if (top + height > window.innerHeight - 12) top = Math.max(12, window.innerHeight - height - 12);
    return {x:left,y:top};
  }

  function openNewEvent(
    date = anchor,
    options?: {x?:number;y?:number;startTime?:string;endTime?:string}
  ) {
    const writable = visibleCalendars.find(calendar => calendar.accessRole === "owner" || calendar.accessRole === "writer");
    if (!writable) {
      setMessage("Etkinlik eklemek için yazma yetkili bir Google takvimi seçin.");
      return;
    }

    const pos = positionForPoint(
      options?.x ?? Math.max(20,window.innerWidth-520),
      options?.y ?? 74
    );
    setDraftPosition(pos);
    setDraft({
      accountId: writable.accountId,
      calendarId: writable.id,
      title: "",
      date: localDateKey(date),
      startTime: options?.startTime ?? "09:00",
      endTime: options?.endTime ?? "10:00",
      allDay: false,
      description: "",
      location: "",
      reminderMode:"default",
      reminderMinutes:[],
    });
  }

  function openEditEvent(event: CalendarEvent) {
    setEventHover(null);
    setHoverDraft(null);
    setDraftPosition(positionForPoint(Math.max(20,window.innerWidth-500),74));
    setDraft(eventToDraft(event));
  }

  async function moveEventToDate(event: CalendarEvent, date: Date) {
    const start = eventStart(event);
    if (!start) return;

    const end = eventEnd(event);
    const durationMs = end ? Math.max(0, end.getTime() - start.getTime()) : 60 * 60 * 1000;

    try {
      const headers = await authHeaders();
      let payload: any;

      if (event.allDay) {
        const originalStart = startOfDay(start);
        const originalEnd = end ? startOfDay(end) : addDays(originalStart, 1);
        const days = Math.max(1, Math.round((originalEnd.getTime() - originalStart.getTime()) / 86400000));
        payload = {
          start: { date: localDateKey(date) },
          end: { date: localDateKey(addDays(date, days)) },
        };
      } else {
        const nextStart = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          start.getHours(),
          start.getMinutes(),
          start.getSeconds()
        );
        const nextEnd = new Date(nextStart.getTime() + durationMs);
        payload = {
          start: { dateTime: nextStart.toISOString() },
          end: { dateTime: nextEnd.toISOString() },
        };
      }

      const response = await fetch("/api/google-calendar/events", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          accountId: event.accountId,
          calendarId: event.calendarId,
          eventId: event.id,
          event: payload,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Etkinlik taşınamadı.");
      setMessage("");
      await loadEvents();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Etkinlik taşınamadı.");
    }
  }

  async function persistEventDraft(current: EventDraft) {
    if (!current.title.trim()) throw new Error("Başlık gerekli.");
    const headers = await authHeaders();
    let eventPayload: any;

    if (current.allDay) {
      const nextDay = addDays(new Date(current.date + "T00:00:00"), 1);
      eventPayload = {
        summary: current.title.trim(),
        description: current.description,
        location: current.location,
        start: { date: current.date },
        end: { date: localDateKey(nextDay) },
      };
    } else {
      const start = new Date(`${current.date}T${current.startTime}:00`);
      const end = new Date(`${current.date}T${current.endTime}:00`);
      if (end <= start) end.setDate(end.getDate() + 1);
      eventPayload = {
        summary: current.title.trim(),
        description: current.description,
        location: current.location,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      };
    }

    eventPayload.reminders =
      current.reminderMode === "default"
        ? { useDefault:true }
        : current.reminderMode === "none"
          ? { useDefault:false, overrides:[] }
          : {
              useDefault:false,
              overrides:[...new Set(current.reminderMinutes)]
                .filter(minutes => Number.isFinite(minutes) && minutes >= 0)
                .slice(0,5)
                .map(minutes => ({method:"popup",minutes})),
            };

    const response = await fetch("/api/google-calendar/events", {
      method: current.id ? "PATCH" : "POST",
      headers,
      body: JSON.stringify({
        accountId: current.accountId,
        calendarId: current.calendarId,
        eventId: current.id,
        event: eventPayload,
      }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Etkinlik kaydedilemedi.");
    return json.event;
  }

  async function saveHoverEvent() {
    if (!hoverDraft || !eventHover) return;
    setHoverSaving(true);
    try {
      await persistEventDraft(hoverDraft);
      await loadEvents();
      setEventHover(null);
      setHoverDraft(null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Etkinlik kaydedilemedi.");
    } finally {
      setHoverSaving(false);
    }
  }

  async function saveEvent() {
    if (!draft) return;
    try {
      await persistEventDraft(draft);
      setDraft(null);
      setDraftPosition(null);
      await loadEvents();
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Etkinlik kaydedilemedi.");
    }
  }

  async function deleteEvent() {
    if (!draft?.id || !confirm("Etkinliği silmek istiyor musunuz?")) return;
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/google-calendar/events", {
        method: "DELETE",
        headers,
        body: JSON.stringify({
          accountId: draft.accountId,
          calendarId: draft.calendarId,
          eventId: draft.id,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Etkinlik silinemedi.");
      await supabase
        .from("calendar_event_state")
        .delete()
        .eq("account_id",draft.accountId)
        .eq("calendar_id",draft.calendarId)
        .eq("event_id",draft.id);
      setDraft(null);
      setDraftPosition(null);
      await loadEvents();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Etkinlik silinemedi.");
    }
  }

  function ReminderEditor({
    draft:current,
    setDraft:update,
    compact=false,
  }: {
    draft:EventDraft;
    setDraft:(next:EventDraft)=>void;
    compact?:boolean;
  }) {
    const presets = [
      {label:"10 dk",minutes:10},
      {label:"30 dk",minutes:30},
      {label:"1 saat",minutes:60},
      {label:"1 gün",minutes:1440},
    ];
    const selectedCalendar = flatCalendars.find(
      calendar => calendar.accountId === current.accountId && calendar.id === current.calendarId
    );
    const defaults = selectedCalendar?.defaultReminders || [];
    const defaultText = defaults.length
      ? defaults.map(item => reminderMinuteLabel(Number(item.minutes || 0))).join(" · ")
      : "Bu takvimde varsayılan hatırlatma yok";

    function choosePreset(minutes:number) {
      const active=current.reminderMode==="custom" && current.reminderMinutes.includes(minutes);
      if(active) {
        const nextMinutes=current.reminderMinutes.filter(value=>value!==minutes);
        update({
          ...current,
          reminderMode:nextMinutes.length ? "custom" : "none",
          reminderMinutes:nextMinutes,
        });
        return;
      }
      const base=current.reminderMode==="custom" ? current.reminderMinutes : [];
      update({
        ...current,
        reminderMode:"custom",
        reminderMinutes:[...base,minutes].filter((value,index,array)=>array.indexOf(value)===index).sort((a,b)=>a-b),
      });
    }

    return (
      <div className={"calendarReminderEditor calendarReminderButtons " + (compact ? "compact" : "")}>
        <div className="calendarReminderInline">
          <span className="calendarReminderLabel">Hatırlatma</span>
          <div className="calendarReminderChoiceRow">
            <button
              type="button"
              className={current.reminderMode==="default" ? "active" : ""}
              onClick={()=>update({...current,reminderMode:"default",reminderMinutes:[]})}
            >
              Varsayılan
            </button>
            <button
              type="button"
              className={current.reminderMode==="none" ? "active" : ""}
              onClick={()=>update({...current,reminderMode:"none",reminderMinutes:[]})}
            >
              Yok
            </button>
            {presets.map(item => (
              <button
                type="button"
                key={item.minutes}
                className={current.reminderMode==="custom" && current.reminderMinutes.includes(item.minutes) ? "active" : ""}
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
                  const base=current.reminderMode==="custom" ? current.reminderMinutes : [];
                  update({
                    ...current,
                    reminderMode:"custom",
                    reminderMinutes:[...base,value].filter((item,index,array)=>array.indexOf(item)===index).sort((a,b)=>a-b),
                  });
                  e.currentTarget.value="";
                }
              }}
            />
          </div>
        </div>
        {current.reminderMode==="default" && (
          <div className="calendarReminderDefaultText">Varsayılan: {defaultText}</div>
        )}
      </div>
    );
  }

  function renderEventChip(event: CalendarEvent, date?: Date) {
    const meta = calendarMeta(event);
    const start = eventStart(event);
    const end = eventEnd(event);
    const startsHere = date && start ? sameDay(start, date) : true;
    const effectiveEnd = event.allDay && end ? addDays(startOfDay(end), -1) : end;
    const endsHere = date && effectiveEnd ? sameDay(effectiveEnd, date) : true;
    const key = event.calendarKey + ":" + event.id;

    return (
      <button
        key={key}
        className={
          "calendarEventChip " +
          (!startsHere ? "continuesBefore " : "") +
          (!endsHere ? "continuesAfter " : "") +
          (draggingEventKey === key ? "dragging " : "") +
          (isEventCompleted(event,date) ? "completed" : "")
        }
        onClick={ev => { ev.stopPropagation(); setEventHover(null); openEditEvent(event); }}
        onMouseEnter={ev => scheduleEventHover(event, ev.currentTarget)}
        onMouseLeave={scheduleHoverClose}
        onFocus={ev => scheduleEventHover(event, ev.currentTarget)}
        onBlur={scheduleHoverClose}
        title={event.summary}
        draggable
        onDragStart={ev => {
          ev.stopPropagation();
          ev.dataTransfer.effectAllowed = "move";
          ev.dataTransfer.setData("text/plain", key);
          setDraggingEventKey(key);
        }}
        onDragEnd={() => {
          setDraggingEventKey(null);
          setMonthDropDate(null);
        }}
        style={meta?.backgroundColor ? {
          borderLeftColor: meta.backgroundColor,
          ["--event-color" as string]: meta.backgroundColor
        } : undefined}
      >
        {!event.allDay && startsHere && <small>{timeLabel(event)}</small>}
        {!startsHere && <small>↤</small>}
        <span>{isEventCompleted(event,date) ? "✓ " : ""}{event.summary}</span>
        {!endsHere && <small className="eventContinue">↦</small>}
      </button>
    );
  }

  function renderMonth() {
    const monthStart = startOfMonth(anchor);
    const gridStart = startOfWeek(monthStart);
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const weekRows = Array.from({ length: 6 }, (_, week) => days.slice(week * 7, week * 7 + 7));

    return (
      <div className={"calendarMonth " + monthDensity}>
        <div className="calendarMonthOptions">
          <div className="calendarDensitySwitch" aria-label="Ay görünümü yoğunluğu">
            <button
              className={monthDensity === "comfortable" ? "active" : ""}
              onClick={() => {
                setMonthDensity("comfortable");
                void saveMonthPrefs("comfortable", showWeekNumbers);
              }}
            >
              Rahat
            </button>
            <button
              className={monthDensity === "compact" ? "active" : ""}
              onClick={() => {
                setMonthDensity("compact");
                void saveMonthPrefs("compact", showWeekNumbers);
              }}
            >
              Kompakt
            </button>
          </div>
          <label className="calendarWeekNumberToggle">
            <input
              type="checkbox"
              checked={showWeekNumbers}
              onChange={event => {
                setShowWeekNumbers(event.target.checked);
                void saveMonthPrefs(monthDensity, event.target.checked);
              }}
            />
            Hafta no
          </label>
          <span className="calendarShortcutHint">T Bugün · M Ay · W Hafta · D Gün · L Liste</span>
        </div>

        <div className={"calendarMonthFrame " + (showWeekNumbers ? "withWeekNumbers" : "")}>
          <div className="calendarWeekdayRow">
            {showWeekNumbers && <div className="calendarWeekNumberHead">Hf</div>}
            {WEEKDAYS.map((day,index) => <div key={day} className={index >= 5 ? "weekend" : ""}>{day}</div>)}
          </div>

          <div className="calendarMonthRows">
            {weekRows.map((week, weekIndex) => (
              <div className="calendarMonthWeek" key={localDateKey(week[0])}>
                {showWeekNumbers && <div className="calendarWeekNumber">{isoWeekNumber(week[0])}</div>}
                {week.map((day, dayIndex) => {
                  const dayEvents = eventsOn(day);
                  const dayKey = localDateKey(day);
                  const writable = visibleCalendars.some(calendar => calendar.accessRole === "owner" || calendar.accessRole === "writer");

                  return (
                    <div
                      key={dayKey}
                      className={
                        "calendarMonthCell " +
                        (day.getMonth() === anchor.getMonth() ? "" : "outside ") +
                        (sameDay(day, new Date()) ? "today " : "") +
                        (dayIndex >= 5 ? "weekend " : "") +
                        (monthDropDate === dayKey ? "dropTarget" : "")
                      }
                      onDoubleClick={event => openNewEvent(day,{x:event.clientX,y:event.clientY})}
                      onDragOver={event => {
                        if (!draggingEventKey) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setMonthDropDate(dayKey);
                      }}
                      onDragLeave={() => {
                        if (monthDropDate === dayKey) setMonthDropDate(null);
                      }}
                      onDrop={event => {
                        event.preventDefault();
                        const key = event.dataTransfer.getData("text/plain") || draggingEventKey;
                        const dragged = events.find(item => item.calendarKey + ":" + item.id === key);
                        setMonthDropDate(null);
                        setDraggingEventKey(null);
                        if (dragged) void moveEventToDate(dragged, day);
                      }}
                    >
                      <div className="calendarCellHead">
                        <button
                          className="calendarDateNumber"
                          onClick={() => { setAnchor(day); void saveViewPrefs({ calendarAnchor:localDateKey(day), calendarView:"day" }); setViewAndSave("day"); }}
                          title="Gün görünümünü aç"
                        >
                          {day.getDate()}
                        </button>
                        {writable && (
                          <button
                            className="calendarQuickAdd"
                            onClick={event => {
                              event.stopPropagation();
                              const rect=event.currentTarget.getBoundingClientRect();
                              openNewEvent(day,{x:rect.right,y:rect.top});
                            }}
                            title="Bu güne etkinlik ekle"
                            aria-label="Etkinlik ekle"
                          >
                            +
                          </button>
                        )}
                      </div>
                      <div className="calendarCellEvents">
                        {dayEvents.slice(0, monthDensity === "compact" ? 5 : 4).map(event => renderEventChip(event, day))}
                        {dayEvents.length > (monthDensity === "compact" ? 5 : 4) && (
                          <button
                            className="calendarMore"
                            onClick={() => { setAnchor(day); setViewAndSave("day"); }}
                          >
                            +{dayEvents.length - (monthDensity === "compact" ? 5 : 4)} daha
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderYear() {
    const today = new Date();
    return (
      <div className="calendarYearGrid">
        {Array.from({ length: 12 }, (_, month) => {
          const monthDate = new Date(anchor.getFullYear(), month, 1);
          const start = startOfWeek(monthDate);
          const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
          const monthEvents = events.filter(event => {
            const e = eventStart(event);
            return e && e.getFullYear() === anchor.getFullYear() && e.getMonth() === month;
          });

          return (
            <div className="miniMonth" key={month}>
              <div className="miniMonthTop">
                <button className="miniMonthTitle" onClick={() => { setAnchor(monthDate); void saveViewPrefs({ calendarAnchor:localDateKey(monthDate), calendarView:"month" }); setViewAndSave("month"); }}>
                  {MONTHS[month]}
                </button>
                {monthEvents.length > 0 && <span className="miniMonthCount">{monthEvents.length}</span>}
              </div>
              <div className="miniWeekdays">
                {WEEKDAYS.map((d,i) => showWeekends || i < 5 ? <span key={d}>{d.slice(0,1)}</span> : null)}
              </div>
              <div className={"miniMonthGrid " + (!showWeekends ? "hideWeekends" : "")}>
                {days.map(day => {
                  const weekend = ((day.getDay()+6)%7) >= 5;
                  if (!showWeekends && weekend) return null;
                  const count = eventsOn(day).length;
                  return (
                    <button
                      key={localDateKey(day)}
                      className={
                        (day.getMonth() === month ? "" : "outside ") +
                        (sameDay(day, today) ? "today " : "") +
                        (count ? "hasEvents " : "")
                      }
                      onClick={() => { setAnchor(day); setViewAndSave("day"); }}
                      title={count ? `${count} etkinlik` : undefined}
                    >
                      <span>{day.getDate()}</span>
                      {count > 0 && <i>{count}</i>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderTimeView(daysCount: number) {
    let start = daysCount === 7 ? startOfWeek(anchor) : startOfDay(anchor);
    let days = Array.from({ length: daysCount }, (_, i) => addDays(start, i));

    if (daysCount === 7 && weekDaysMode === 5) {
      days = days.filter(day => ((day.getDay() + 6) % 7) < 5);
    } else if (!showWeekends && daysCount !== 1) {
      days = days.filter(day => ((day.getDay() + 6) % 7) < 5);
    }

    const hourHeight = hourDensity;
    const firstHour = Math.max(0, dayStartHour);
    const lastHour = Math.max(firstHour + 1, Math.min(24, dayEndHour));
    const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
    const totalHeight = hours.length * hourHeight;
    const now = new Date();
    const nowMinutes = (now.getHours() - firstHour) * 60 + now.getMinutes();
    const showNow = now.getHours() >= firstHour && now.getHours() < lastHour;
    const nowTop = (nowMinutes / 60) * hourHeight;

    return (
      <div className="calendarTimeView" style={{ ["--calendar-days" as string]: String(days.length) }}>
        <div className="calendarTimeHeader">
          <div className="calendarTimeCorner" />
          {days.map(day => (
            <button key={localDateKey(day)} className={sameDay(day,new Date()) ? "today" : ""} onClick={() => { setAnchor(day); setViewAndSave("day"); }}>
              <small>{day.toLocaleDateString("tr-TR",{weekday:"short"})}</small>
              <strong>{day.getDate()}</strong>
            </button>
          ))}
        </div>
        <div className="calendarAllDayRow">
          <div>Tüm gün</div>
          {days.map(day => <div key={localDateKey(day)}>{eventsOn(day).filter(e => e.allDay).map(event => renderEventChip(event, day))}</div>)}
        </div>
        <div className="calendarTimeScroll" ref={timeScrollRef}>
          <div className="calendarHourLabels">
            {hours.map(hour => <div key={hour} style={{height:hourHeight}}>{String(hour).padStart(2,"0")}:00</div>)}
          </div>
          <div className="calendarDayColumns">
            {days.map(day => (
              <div
                className={"calendarDayColumn " + (sameDay(day, now) ? "today" : "")}
                key={localDateKey(day)}
                style={{ height: totalHeight, ["--hour-height" as string]: `${hourHeight}px` }}
                onDoubleClick={event => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const y = event.clientY - rect.top;
                  const hour = Math.max(firstHour, Math.min(lastHour - 1, firstHour + Math.floor(y / hourHeight)));
                  openNewEvent(day,{
                    x:event.clientX,
                    y:event.clientY,
                    startTime:String(hour).padStart(2,"0")+":00",
                    endTime:String(Math.min(23,hour+1)).padStart(2,"0")+":00",
                  });
                }}
              >
                {sameDay(day, now) && showNow && (
                  <div className="calendarNowLine" style={{ top: nowTop }}>
                    <span>{now.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})}</span>
                  </div>
                )}
                {eventsOn(day).filter(e => !e.allDay).map(event => {
                  const startDate = eventStart(event);
                  const endDate = eventEnd(event);
                  if (!startDate) return null;
                  const startMinutes = (startDate.getHours()-firstHour)*60+startDate.getMinutes();
                  const duration = Math.max(30, endDate ? (endDate.getTime()-startDate.getTime())/60000 : 60);
                  if (startMinutes > (lastHour-firstHour)*60 || startMinutes + duration < 0) return null;
                  const meta = calendarMeta(event);
                  return (
                    <button
                      key={event.calendarKey+":"+event.id}
                      className={"calendarTimedEvent " + (isEventCompleted(event,day) ? "completed" : "")}
                      style={{
                        top:(startMinutes/60)*hourHeight,
                        height:Math.max(24,(duration/60)*hourHeight),
                        borderLeftColor:meta?.backgroundColor || undefined,
                        ["--event-color" as string]: meta?.backgroundColor || "var(--accent)"
                      }}
                      onClick={() => { setEventHover(null); openEditEvent(event); }}
                      onMouseEnter={ev => scheduleEventHover(event, ev.currentTarget)}
                      onMouseLeave={scheduleHoverClose}
                      onFocus={ev => scheduleEventHover(event, ev.currentTarget)}
                      onBlur={scheduleHoverClose}
                    >
                      <strong>{isEventCompleted(event,day) ? "✓ " : ""}{event.summary}</strong>
                      <small>{timeLabel(event)}</small>
                      {event.location && <small className="timedLocation">{event.location}</small>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderList() {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const start = eventStart(event);
      if (!start) continue;
      const key = localDateKey(start);
      const list = grouped.get(key) || [];
      list.push(event);
      grouped.set(key,list);
    }

    const entries = [...grouped.entries()];
    const today = startOfDay(new Date());
    let todayAnchorInserted = false;
    let lastMonthKey = "";

    return (
      <div className="calendarAgenda">
        {entries.map(([key,list]) => {
          const date = new Date(key+"T00:00:00");
          const monthKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
          const showMonthDivider =
            (listRange === "year" || listRange === "remainingYear") &&
            monthKey !== lastMonthKey;

          if (showMonthDivider) lastMonthKey = monthKey;

          const shouldPlaceTodayAnchor =
            view === "list" &&
            listRange === "year" &&
            yearlyAutoScrollPending &&
            !todayAnchorInserted &&
            date >= today;

          if (shouldPlaceTodayAnchor) todayAnchorInserted = true;

          return (
            <div key={key}>
              {showMonthDivider && (
                <div className="calendarMonthDivider">
                  <strong>{date.toLocaleDateString("tr-TR",{month:"long",year:"numeric"})}</strong>
                </div>
              )}

              {shouldPlaceTodayAnchor && (
                <div ref={yearlyTodayRef} className="calendarTodayAnchor">
                  <span>Bugün</span>
                </div>
              )}

              <section>
                <h3>{date.toLocaleDateString("tr-TR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</h3>
                {list.map(event => {
                  const meta=calendarMeta(event);
                  return (
                    <button
                      className={"agendaEvent " + (isEventCompleted(event,date) ? "completed" : "")}
                      key={event.calendarKey+":"+event.id}
                      onClick={()=>{ setEventHover(null); openEditEvent(event); }}
                      onMouseEnter={ev => scheduleEventHover(event, ev.currentTarget)}
                      onMouseLeave={scheduleHoverClose}
                      onFocus={ev => scheduleEventHover(event, ev.currentTarget)}
                      onBlur={scheduleHoverClose}
                    >
                      <span className="agendaTime">{timeLabel(event)}</span>
                      <span className="agendaDot" style={meta?.backgroundColor?{backgroundColor:meta.backgroundColor}:undefined}/>
                      <span className="agendaMain"><strong>{isEventCompleted(event,date) ? "✓ " : ""}{event.summary}</strong>{event.location&&<small>{event.location}</small>}</span>
                      <span className="agendaCalendar">{meta?.summary}</span>
                    </button>
                  );
                })}
              </section>
            </div>
          );
        })}

        {view === "list" && listRange === "year" && !todayAnchorInserted && (
          <div ref={yearlyTodayRef} className="calendarTodayAnchor">
            <span>Bugün</span>
          </div>
        )}

        {!events.length && !loadingEvents && <div className="calendarEmpty">Bu aralıkta etkinlik yok.</div>}
      </div>
    );
  }

  useEffect(() => {
    if (!draft || !draftPosition || !eventEditorRef.current) return;
    const node=eventEditorRef.current;

    const clamp=()=>{
      const rect=node.getBoundingClientRect();
      let x=draftPosition.x;
      let y=draftPosition.y;
      if(rect.right>window.innerWidth-10) x=Math.max(10,window.innerWidth-rect.width-10);
      if(rect.bottom>window.innerHeight-10) y=Math.max(10,window.innerHeight-rect.height-10);
      if(rect.left<10) x=10;
      if(rect.top<10) y=10;
      if(x!==draftPosition.x || y!==draftPosition.y) {
        setDraftPosition({x,y});
      }
    };

    clamp();
    const observer=new ResizeObserver(clamp);
    observer.observe(node);
    window.addEventListener("resize",clamp);
    return ()=>{
      observer.disconnect();
      window.removeEventListener("resize",clamp);
    };
  },[draft?.id,draftPosition?.x,draftPosition?.y]);

  useEffect(() => {
    if (!eventHover || !eventPreviewRef.current) return;
    const node=eventPreviewRef.current;

    const clamp=()=>{
      const rect=node.getBoundingClientRect();
      let nextX=eventHover.x;
      let nextY=eventHover.y;
      if(rect.bottom>window.innerHeight-10) nextY=Math.max(10,window.innerHeight-rect.height-10);
      if(rect.right>window.innerWidth-10) nextX=Math.max(10,window.innerWidth-rect.width-10);
      if(rect.left<10) nextX=10;
      if(rect.top<10) nextY=10;
      if(nextX!==eventHover.x || nextY!==eventHover.y) {
        setEventHover(current=>current ? {...current,x:nextX,y:nextY} : current);
      }
    };

    clamp();
    const observer=new ResizeObserver(clamp);
    observer.observe(node);
    window.addEventListener("resize",clamp);
    return ()=>{
      observer.disconnect();
      window.removeEventListener("resize",clamp);
    };
  },[eventHover?.event.id,eventHover?.x,eventHover?.y]);

  useEffect(() => {
    return () => {
      cancelHoverOpen();
      cancelHoverClose();
    };
  }, []);

  useEffect(() => {
    if (!autoScrollNow) return;
    if (view !== "day" && view !== "week" && view !== "3day") return;
    if (!timeScrollRef.current) return;

    const now = new Date();
    if (now.getHours() < dayStartHour || now.getHours() >= dayEndHour) return;
    const top = ((now.getHours() - dayStartHour) + now.getMinutes()/60) * hourDensity;
    const target = Math.max(0, top - timeScrollRef.current.clientHeight * 0.35);
    timeScrollRef.current.scrollTo({ top: target, behavior: "auto" });
  }, [view, anchor, dayStartHour, dayEndHour, hourDensity, autoScrollNow, events.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape" && eventHover) {
        setEventHover(null);
        event.preventDefault();
        return;
      }
      if (draft) return;

      const key = event.key.toLowerCase();
      if (key === "t") goToday();
      else if (key === "m") setViewAndSave("month");
      else if (key === "w") setViewAndSave("week");
      else if (key === "d") setViewAndSave("day");
      else if (key === "l") setViewAndSave("list");
      else if (event.key === "ArrowLeft") move(-1);
      else if (event.key === "ArrowRight") move(1);
      else return;

      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft, view, anchor, hiddenKeys, listRange]);

  return (
    <div
      className={"calendarPage " + (externalSources ? "externalSources " : "") + (sourcePanelOpen ? "sourcesOpen " : "sourcesClosed ") + (sourcePanelResizing ? "sourcesResizing" : "")}
      style={{ ["--calendar-sources-width" as string]: `${sourcePanelWidth}px` }}
    >
      {!externalSources && <aside className={"calendarSources " + (sourcePanelOpen ? "open" : "")}>
        <div
          className="calendarSourcesResizeHandle"
          onPointerDown={beginSourcesResize}
          title="Panel genişliğini ayarla"
          aria-hidden="true"
        />
        <button
          className="calendarSourcesEdgeToggle"
          onClick={toggleSourcesPanel}
          title={sourcePanelOpen ? "Takvim panelini gizle" : "Takvim panelini aç"}
          aria-label={sourcePanelOpen ? "Takvim panelini gizle" : "Takvim panelini aç"}
        >
          {sourcePanelOpen ? "›" : "‹"}
        </button>
        <div className="calendarSourcesHead">
          <strong>Takvimler</strong>
        </div>
        <button className="calendarAddAccount" onClick={connectGoogle} disabled={googleConnecting}>
          {googleConnecting ? "Google açılıyor…" : "+ Google hesabı ekle"}
        </button>
        {loadingAccounts && <p className="muted">Hesaplar yükleniyor…</p>}
        {accounts.map(account => (
          <div className="calendarAccount" key={account.id}>
            <div className="calendarAccountHead">
              <span><strong>{account.displayName || account.email}</strong><small>{account.email}</small></span>
              <button title="Hesabı kaldır" onClick={() => void disconnectAccount(account.id)}>⋯</button>
            </div>
            {account.error && <p className="calendarAccountError">{account.error}</p>}
            <div className="calendarSourceList">
              {account.calendars.map(calendar => {
                const key = keyFor(account.id,calendar.id);
                return (
                  <div className="calendarSourceItem" key={key}>
                    <label>
                      <input type="checkbox" checked={!hiddenKeys.has(key)} onChange={() => toggleCalendar(key)} />
                      <span className="calendarColorDot" style={calendar.backgroundColor?{backgroundColor:calendar.backgroundColor}:undefined}/>
                      <span>{calendar.summary}</span>
                    </label>
                    <button
                      className={"calendarTodoSourceToggle " + (isTodoCalendarEnabled({...calendar,key}) ? "active" : "")}
                      onClick={() => toggleTodoCalendar(key)}
                      title="Bu takvimin etkinliklerini Günlük Todo'da göster/gizle"
                    >
                      TODO
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!loadingAccounts && !accounts.length && <p className="muted">Henüz Google Takvim hesabı bağlı değil.</p>}
      </aside>}

      {!externalSources && !sourcePanelOpen && (
        <button
          className="calendarSourcesCollapsedHandle"
          onClick={toggleSourcesPanel}
          title="Takvim panelini aç"
          aria-label="Takvim panelini aç"
        >
          ‹
        </button>
      )}

      <main className="calendarMain">
        <div className="calendarToolbar">
          <div className="calendarToolbarLeft">
            {!externalSources && <button className="calendarSourcesToggle" onClick={toggleSourcesPanel} title="Takvimleri göster/gizle">☷ <span>Takvimler</span></button>}
            <button className="calendarToday" onClick={goToday}>Bugün</button>
            <button onClick={() => move(-1)}>‹</button>
            <button onClick={() => move(1)}>›</button>
            <h1>{title}</h1>
          </div>
          <div className="calendarToolbarRight">
            <button className="calendarPrefsButton" onClick={() => setCalendarPrefsOpen(open => !open)} title="Takvim görünüm ayarları">⚙</button>
            <button className="calendarCreate" onClick={event => {
              const rect=event.currentTarget.getBoundingClientRect();
              openNewEvent(anchor,{x:rect.left,y:rect.bottom+6});
            }}>+ Etkinlik</button>
            <div className="calendarViewSwitch">
              {(["year","month","week","3day","day","list"] as ViewMode[]).map(mode => (
                <button key={mode} className={view===mode?"active":""} onClick={()=>setViewAndSave(mode)}>
                  {{year:"Yıl",month:"Ay",week:"Hafta","3day":"3 Gün",day:"1 Gün",list:"Liste"}[mode]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {view === "list" && (
          <div className="calendarListControls">
            <div>
              {(["day","week","month","year","remainingYear","custom"] as ListRange[]).map(mode => (
                <button key={mode} className={listRange===mode?"active":""} onClick={()=>setListRangeAndScroll(mode)}>
                  {{day:"Günlük",week:"Haftalık",month:"Aylık",year:"Tüm yıl",remainingYear:"Bugünden yıl sonuna",custom:"Tarih aralığı"}[mode]}
                </button>
              ))}
            </div>
            {listRange==="custom" && (
              <div className="calendarCustomDates">
                <input type="date" value={customStart} onChange={e=>{ setCustomStart(e.target.value); void saveViewPrefs({ calendarCustomStart:e.target.value }); }} />
                <span>–</span>
                <input type="date" value={customEnd} onChange={e=>{ setCustomEnd(e.target.value); void saveViewPrefs({ calendarCustomEnd:e.target.value }); }} />
              </div>
            )}
          </div>
        )}

        {calendarPrefsOpen && (
          <div className="calendarViewPrefs">
            <div className="calendarViewPrefsHead">
              <strong>Görünüm ayarları</strong>
              <button onClick={() => setCalendarPrefsOpen(false)}>×</button>
            </div>
            <label>
              <span>Hafta</span>
              <select value={weekDaysMode} onChange={e => {
                const value = Number(e.target.value) as 5 | 7;
                setWeekDaysMode(value);
                void saveViewPrefs({ calendarWeekDaysMode:value });
              }}>
                <option value={7}>7 gün</option>
                <option value={5}>5 iş günü</option>
              </select>
            </label>
            <label className="calendarPrefCheck">
              <input type="checkbox" checked={showWeekends} onChange={e => {
                setShowWeekends(e.target.checked);
                void saveViewPrefs({ calendarShowWeekends:e.target.checked });
              }}/>
              <span>Hafta sonlarını göster</span>
            </label>
            <label>
              <span>Gün başlangıcı</span>
              <select value={dayStartHour} onChange={e => {
                const value = Number(e.target.value);
                setDayStartHour(value);
                void saveViewPrefs({ calendarDayStartHour:value });
              }}>
                {Array.from({length:13},(_,i)=><option key={i} value={i}>{String(i).padStart(2,"0")}:00</option>)}
              </select>
            </label>
            <label>
              <span>Gün bitişi</span>
              <select value={dayEndHour} onChange={e => {
                const value = Number(e.target.value);
                setDayEndHour(value);
                void saveViewPrefs({ calendarDayEndHour:value });
              }}>
                {Array.from({length:13},(_,i)=>i+12).map(i=><option key={i} value={i}>{String(i).padStart(2,"0")}:00</option>)}
              </select>
            </label>
            <label>
              <span>Saat yoğunluğu</span>
              <select value={hourDensity} onChange={e => {
                const value = Number(e.target.value) as 36|48|64;
                setHourDensity(value);
                void saveViewPrefs({ calendarHourDensity:value });
              }}>
                <option value={36}>Kompakt</option>
                <option value={48}>Normal</option>
                <option value={64}>Geniş</option>
              </select>
            </label>
            <label className="calendarPrefCheck">
              <input type="checkbox" checked={autoScrollNow} onChange={e => {
                setAutoScrollNow(e.target.checked);
                void saveViewPrefs({ calendarAutoScrollNow:e.target.checked });
              }}/>
              <span>Gün/hafta görünümünü otomatik olarak şu ana getir</span>
            </label>
          </div>
        )}

        {message && <div className="calendarMessage">{message}</div>}
        {loadingEvents && <div className="calendarLoading">Etkinlikler yükleniyor…</div>}

        <div className="calendarBody">
          {view==="year" && renderYear()}
          {view==="month" && renderMonth()}
          {view==="week" && renderTimeView(7)}
          {view==="3day" && renderTimeView(3)}
          {view==="day" && renderTimeView(1)}
          {view==="list" && renderList()}
        </div>
      </main>

      {eventHover && hoverDraft && (() => {
        const event = eventHover.event;
        const meta = calendarMeta(event);

        return (
          <div
            ref={eventPreviewRef}
            className="calendarEventPreview calendarEventQuickEditor"
            style={{ left:eventHover.x, top:eventHover.y, ["--preview-color" as string]:meta?.backgroundColor || "var(--accent)" }}
            onMouseEnter={keepHoverOpen}
            onMouseLeave={scheduleHoverClose}
            role="dialog"
            aria-label={event.summary + " etkinlik ayrıntıları"}
          >
            <div className="calendarEventPreviewAccent" />

            <input
              className="calendarQuickTitle"
              value={hoverDraft.title}
              onChange={e=>setHoverDraft({...hoverDraft,title:e.target.value})}
              onFocus={keepHoverOpen}
              aria-label="Etkinlik başlığı"
            />

            <div className="calendarQuickDateRow">
              <input type="date" value={hoverDraft.date} onChange={e=>setHoverDraft({...hoverDraft,date:e.target.value})}/>
              <label className="calendarQuickAllDay">
                <input type="checkbox" checked={hoverDraft.allDay} onChange={e=>setHoverDraft({...hoverDraft,allDay:e.target.checked})}/>
                Tüm gün
              </label>
            </div>

            {!hoverDraft.allDay && (
              <div className="calendarQuickTimeRow">
                <input type="time" value={hoverDraft.startTime} onChange={e=>setHoverDraft({...hoverDraft,startTime:e.target.value})}/>
                <span>–</span>
                <input type="time" value={hoverDraft.endTime} onChange={e=>setHoverDraft({...hoverDraft,endTime:e.target.value})}/>
              </div>
            )}

            <select
              className="calendarQuickCalendar"
              value={keyFor(hoverDraft.accountId,hoverDraft.calendarId)}
              onChange={e=>{
                const split=e.target.value.indexOf("|");
                setHoverDraft({...hoverDraft,accountId:e.target.value.slice(0,split),calendarId:e.target.value.slice(split+1)});
              }}
            >
              {flatCalendars.filter(c=>c.accessRole==="owner"||c.accessRole==="writer").map(c=>
                <option key={c.key} value={c.key}>{c.accountEmail} · {c.summary}</option>
              )}
            </select>

            <input
              className="calendarQuickLocation"
              placeholder="Konum"
              value={hoverDraft.location}
              onChange={e=>setHoverDraft({...hoverDraft,location:e.target.value})}
            />

            <textarea
              className="calendarQuickDescription"
              placeholder="Açıklama"
              rows={3}
              value={hoverDraft.description}
              onChange={e=>setHoverDraft({...hoverDraft,description:e.target.value})}
            />

            <ReminderEditor draft={hoverDraft} setDraft={setHoverDraft} compact />
            <div className="calendarQuickTodoRow">
              <button
                className={isEventCompleted(event) ? "calendarTodoDone active" : "calendarTodoDone"}
                onClick={()=>void toggleEventCompleted(event)}
              >
                {isEventCompleted(event) ? "✓ Tamamlandı" : "○ Tamamlandı olarak işaretle"}
              </button>
              <span className="calendarAutoTodoHint">TODO'da otomatik görünür</span>
            </div>

            <div className="calendarQuickActions">
              <span className="calendarQuickSource">
                <i style={meta?.backgroundColor?{backgroundColor:meta.backgroundColor}:undefined}/>
                {meta?.summary || "Takvim"}
              </span>
              <button className="secondary" onClick={()=>{setEventHover(null);setHoverDraft(null);}}>Kapat</button>
              <button className="primary" disabled={hoverSaving || !hoverDraft.title.trim()} onClick={()=>void saveHoverEvent()}>
                {hoverSaving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        );
      })()}

      {draft && draftPosition && (
        <div
          ref={eventEditorRef}
          className="calendarFloatingEditor"
          style={{left:draftPosition.x,top:draftPosition.y}}
          onMouseDown={e=>e.stopPropagation()}
        >
          <div className="calendarEventPreviewAccent" />
          <div className="calendarEditorHead">
            <strong>{draft.id ? "Etkinliği düzenle" : "Yeni etkinlik"}</strong>
            <button onClick={()=>{setDraft(null);setDraftPosition(null);}}>×</button>
          </div>
          <input className="calendarTitleInput" placeholder="Başlık" value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} autoFocus />
          <div className="calendarQuickDateRow">
            <input type="date" value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/>
            <label className="calendarQuickAllDay">
              <input type="checkbox" checked={draft.allDay} onChange={e=>setDraft({...draft,allDay:e.target.checked})}/>
              Tüm gün
            </label>
          </div>
          {!draft.allDay && (
            <div className="calendarQuickTimeRow">
              <input type="time" value={draft.startTime} onChange={e=>setDraft({...draft,startTime:e.target.value})}/>
              <span>–</span>
              <input type="time" value={draft.endTime} onChange={e=>setDraft({...draft,endTime:e.target.value})}/>
            </div>
          )}
          <select className="calendarQuickCalendar" value={keyFor(draft.accountId,draft.calendarId)} onChange={e=>{
            const split=e.target.value.indexOf("|");
            setDraft({...draft,accountId:e.target.value.slice(0,split),calendarId:e.target.value.slice(split+1)});
          }}>
            {flatCalendars.filter(c=>c.accessRole==="owner"||c.accessRole==="writer").map(c=><option key={c.key} value={c.key}>{c.accountEmail} · {c.summary}</option>)}
          </select>
          <input className="calendarQuickLocation" placeholder="Konum" value={draft.location} onChange={e=>setDraft({...draft,location:e.target.value})}/>
          <textarea className="calendarQuickDescription" placeholder="Açıklama" rows={3} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/>
          <ReminderEditor draft={draft} setDraft={setDraft} />
          <div className="calendarAutoTodoNotice">▣ Bu etkinlik Günlük Todo'da otomatik görünür.</div>
          <div className="calendarQuickActions">
            {draft.id && <button className="danger" onClick={()=>void deleteEvent()}>Sil</button>}
            <span className="calendarQuickSource"/>
            <button className="secondary" onClick={()=>{setDraft(null);setDraftPosition(null);}}>İptal</button>
            <button className="primary" disabled={!draft.title.trim()} onClick={()=>void saveEvent()}>Kaydet</button>
          </div>
        </div>
      )}

    </div>
  );
}
