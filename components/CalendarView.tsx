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

export function CalendarView({ user }: { user: User }) {
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [listRange, setListRange] = useState<ListRange>("month");
  const [customStart, setCustomStart] = useState(() => localDateKey(startOfMonth(new Date())));
  const [customEnd, setCustomEnd] = useState(() => localDateKey(addDays(addMonths(startOfMonth(new Date()), 1), -1)));
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [message, setMessage] = useState("");
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
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
      setEvents(json.events || []);
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

  function openNewEvent(date = anchor) {
    const writable = visibleCalendars.find(calendar => calendar.accessRole === "owner" || calendar.accessRole === "writer");
    if (!writable) {
      setMessage("Etkinlik eklemek için yazma yetkili bir Google takvimi seçin.");
      return;
    }
    setDraft({
      accountId: writable.accountId,
      calendarId: writable.id,
      title: "",
      date: localDateKey(date),
      startTime: "09:00",
      endTime: "10:00",
      allDay: false,
      description: "",
      location: "",
    });
  }

  function openEditEvent(event: CalendarEvent) {
    const start = eventStart(event) || new Date();
    const end = eventEnd(event) || addDays(start, 0);
    setDraft({
      id: event.id,
      accountId: event.accountId,
      calendarId: event.calendarId,
      title: event.summary,
      date: localDateKey(start),
      startTime: event.allDay ? "09:00" : start.toTimeString().slice(0,5),
      endTime: event.allDay ? "10:00" : end.toTimeString().slice(0,5),
      allDay: event.allDay,
      description: event.description,
      location: event.location,
    });
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

  async function saveEvent() {
    if (!draft || !draft.title.trim()) return;
    try {
      const headers = await authHeaders();
      let eventPayload: any;
      if (draft.allDay) {
        const nextDay = addDays(new Date(draft.date + "T00:00:00"), 1);
        eventPayload = {
          summary: draft.title.trim(),
          description: draft.description,
          location: draft.location,
          start: { date: draft.date },
          end: { date: localDateKey(nextDay) },
        };
      } else {
        const start = new Date(`${draft.date}T${draft.startTime}:00`);
        const end = new Date(`${draft.date}T${draft.endTime}:00`);
        if (end <= start) end.setDate(end.getDate() + 1);
        eventPayload = {
          summary: draft.title.trim(),
          description: draft.description,
          location: draft.location,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
        };
      }

      const method = draft.id ? "PATCH" : "POST";
      const response = await fetch("/api/google-calendar/events", {
        method,
        headers,
        body: JSON.stringify({
          accountId: draft.accountId,
          calendarId: draft.calendarId,
          eventId: draft.id,
          event: eventPayload,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Etkinlik kaydedilemedi.");
      setDraft(null);
      await loadEvents();
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
      setDraft(null);
      await loadEvents();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Etkinlik silinemedi.");
    }
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
          (draggingEventKey === key ? "dragging" : "")
        }
        onClick={ev => { ev.stopPropagation(); openEditEvent(event); }}
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
        <span>{event.summary}</span>
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
                      onDoubleClick={() => openNewEvent(day)}
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
                            onClick={event => { event.stopPropagation(); openNewEvent(day); }}
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
                  const writable = visibleCalendars.find(c => c.accessRole === "owner" || c.accessRole === "writer");
                  if (!writable) return openNewEvent(day);
                  setDraft({
                    accountId:writable.accountId,calendarId:writable.id,title:"",
                    date:localDateKey(day),startTime:String(hour).padStart(2,"0")+":00",
                    endTime:String(Math.min(23,hour+1)).padStart(2,"0")+":00",allDay:false,description:"",location:""
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
                      className="calendarTimedEvent"
                      style={{
                        top:(startMinutes/60)*hourHeight,
                        height:Math.max(24,(duration/60)*hourHeight),
                        borderLeftColor:meta?.backgroundColor || undefined,
                        ["--event-color" as string]: meta?.backgroundColor || "var(--accent)"
                      }}
                      onClick={() => openEditEvent(event)}
                    >
                      <strong>{event.summary}</strong>
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
                    <button className="agendaEvent" key={event.calendarKey+":"+event.id} onClick={()=>openEditEvent(event)}>
                      <span className="agendaTime">{timeLabel(event)}</span>
                      <span className="agendaDot" style={meta?.backgroundColor?{backgroundColor:meta.backgroundColor}:undefined}/>
                      <span className="agendaMain"><strong>{event.summary}</strong>{event.location&&<small>{event.location}</small>}</span>
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
    <div className={"calendarPage " + (sourcePanelOpen ? "sourcesOpen" : "sourcesClosed")}>
      <aside className={"calendarSources " + (sourcePanelOpen ? "open" : "")}>
        <div className="calendarSourcesHead">
          <strong>Takvimler</strong>
          <button onClick={() => { setSourcePanelOpen(false); void saveViewPrefs({ calendarSourcesOpen:false }); }}>×</button>
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
                  <label key={key}>
                    <input type="checkbox" checked={!hiddenKeys.has(key)} onChange={() => toggleCalendar(key)} />
                    <span className="calendarColorDot" style={calendar.backgroundColor?{backgroundColor:calendar.backgroundColor}:undefined}/>
                    <span>{calendar.summary}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        {!loadingAccounts && !accounts.length && <p className="muted">Henüz Google Takvim hesabı bağlı değil.</p>}
      </aside>

      <main className="calendarMain">
        <div className="calendarToolbar">
          <div className="calendarToolbarLeft">
            <button className="calendarSourcesToggle" onClick={toggleSourcesPanel} title="Takvimleri göster/gizle">☷ <span>Takvimler</span></button>
            <button className="calendarToday" onClick={goToday}>Bugün</button>
            <button onClick={() => move(-1)}>‹</button>
            <button onClick={() => move(1)}>›</button>
            <h1>{title}</h1>
          </div>
          <div className="calendarToolbarRight">
            <button className="calendarPrefsButton" onClick={() => setCalendarPrefsOpen(open => !open)} title="Takvim görünüm ayarları">⚙</button>
            <button className="calendarCreate" onClick={() => openNewEvent()}>+ Etkinlik</button>
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

      {draft && (
        <div className="calendarEditorBackdrop" onMouseDown={()=>setDraft(null)}>
          <div className="calendarEditor" onMouseDown={e=>e.stopPropagation()}>
            <div className="calendarEditorHead">
              <strong>{draft.id ? "Etkinliği düzenle" : "Yeni etkinlik"}</strong>
              <button onClick={()=>setDraft(null)}>×</button>
            </div>
            <input className="calendarTitleInput" placeholder="Başlık" value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} autoFocus />
            <label className="calendarField"><span>Takvim</span>
              <select value={keyFor(draft.accountId,draft.calendarId)} onChange={e=>{
                const split=e.target.value.indexOf("|");
                setDraft({...draft,accountId:e.target.value.slice(0,split),calendarId:e.target.value.slice(split+1)});
              }}>
                {flatCalendars.filter(c=>c.accessRole==="owner"||c.accessRole==="writer").map(c=><option key={c.key} value={c.key}>{c.accountEmail} · {c.summary}</option>)}
              </select>
            </label>
            <label className="calendarCheck"><input type="checkbox" checked={draft.allDay} onChange={e=>setDraft({...draft,allDay:e.target.checked})}/> Tüm gün</label>
            <div className="calendarEditorDateRow">
              <input type="date" value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/>
              {!draft.allDay && <>
                <input type="time" value={draft.startTime} onChange={e=>setDraft({...draft,startTime:e.target.value})}/>
                <span>–</span>
                <input type="time" value={draft.endTime} onChange={e=>setDraft({...draft,endTime:e.target.value})}/>
              </>}
            </div>
            <input placeholder="Konum" value={draft.location} onChange={e=>setDraft({...draft,location:e.target.value})}/>
            <textarea placeholder="Açıklama" rows={4} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/>
            <div className="calendarEditorActions">
              {draft.id && <button className="danger" onClick={()=>void deleteEvent()}>Sil</button>}
              <span/>
              <button onClick={()=>setDraft(null)}>İptal</button>
              <button className="primary" onClick={()=>void saveEvent()}>Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
