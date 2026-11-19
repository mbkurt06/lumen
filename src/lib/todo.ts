import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { kazaToday } from "./kaza";

export type Plan = { daily: number; days: number; start: string; done: Record<string, number> };
export type Todo = {
  id: string;
  title: string;
  notes: string | null;
  is_completed: boolean;
  due_at: string | null;
  list_id: string | null;
  kind: string;
  plan: Plan | null;
  parent_todo_id: string | null;
  related_library_item_id: string | null;
  reading_ref: ReadingRef | null;
  recurrence: Recurrence | null;
  per_day: number;
  start_date: string | null;
  end_date: string | null;
  bookmark_id: string | null;
  progress: Record<string, number> | null;
  page_goal: PageGoal | null;
  bookmark?: BookmarkLite | null;
  created_at: string;
  completed_at: string | null;
};
/** Görevin kitaptaki yeri: "yer" = kaldığım yer, "konu" = bir cümle/sayfa hakkında görev (araştır, sor…). */
export type ReadingRef = { kind: "yer" | "konu"; doc_id: string; node_id: string | null; book_id: string | null; scope: string; label: string; quote: string; book_title?: string };
/** Sıklık. days: 0=Pazar … 6=Cumartesi */
export type Recurrence = { type: "once" | "daily" | "weekdays" | "weekend" | "days" | "weekly" | "monthly" | "every"; days?: number[]; n?: number };
/** Okuma hedefi: n sayfa, gün/hafta/ay ya da başlangıç–bitiş aralığında. book_id: kitap klasörü (Kur'an için null). */
export type PageGoal = { n: number; per: "day" | "week" | "month" | "range" | "pages"; book_id: string | null; scope: string; from?: number; to?: number; doc_key?: string; unit?: string };
export type ReadRow = { book_id: string | null; scope: string; doc_key: string; page: number; day: string };
/** Okunan sayfalar (son 120 gün); useTodos yükler, okuma hedefleri buradan sayılır. */
let READS: ReadRow[] = [];
export const readsCache = () => READS;
/** Hedefin şu anki dönemi [başlangıç, bitiş] */
export function goalPeriod(t: Pick<Todo, "page_goal" | "start_date" | "end_date">, day = ymd()): [string, string] {
  const g = t.page_goal!;
  const d = new Date(day + "T12:00:00");
  if (g.per === "week") { const w = (d.getDay() + 6) % 7; const a = new Date(d.getTime() - w * 86400000); return [ymd(a), ymd(new Date(a.getTime() + 6 * 86400000))]; }
  if (g.per === "month") return [day.slice(0, 8) + "01", ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12))];
  if (g.per === "range") return [t.start_date ?? day, t.end_date ?? "9999-12-31"];
  return [day, day];
}
const sameBook = (g: PageGoal, r: ReadRow) => (g.book_id ? r.book_id === g.book_id : r.scope === g.scope);
/** Dönemde okunan sayfa sayısı. exceptDoc: o belgeyi sayma (okuyucu kendi canlı sayısını ekler). */
export function goalCount(t: Pick<Todo, "page_goal" | "start_date" | "end_date"> & { recurrence?: Recurrence | null }, rows: ReadRow[] = READS, exceptDoc?: string): number {
  if (!t.page_goal) return 0;
  const g = t.page_goal;
  // sayfa aralığı (ör. Tevhidname 10–20): o aralıkta okunan farklı sayfalar, gün fark etmez
  // tekrarlayan görevde (ör. her gün Cevşen 20–30) yalnız bugün okunanlar sayılır
  if (g.per === "pages") { const today = ymd(); const rec = !!t.recurrence && t.recurrence.type !== "once"; return new Set(rows.filter((r) => r.doc_key === g.doc_key && r.doc_key !== exceptDoc && r.page >= (g.from ?? 0) && r.page <= (g.to ?? 1e9) && (!rec || r.day === today)).map((r) => r.page)).size; }
  const [a, b] = goalPeriod(t);
  return rows.filter((r) => sameBook(t.page_goal!, r) && r.day >= a && r.day <= b && r.doc_key !== exceptDoc).length;
}
export const goalLabel = (g: PageGoal) => (g.per === "pages" ? `${(g.unit ?? "sayfa").replace(/^./, (c) => c.toLocaleUpperCase("tr"))} ${g.from}–${g.to}` : g.per === "day" ? "Bugün" : g.per === "week" ? "Bu hafta" : g.per === "month" ? "Bu ay" : "Toplam");

/** Göreve bağlı ayraç (kaldığın yer). */
export type BookmarkLite = { id: string; title: string; document_id: string; node_id: string | null; quote: string | null; label: string | null; book_title: string | null; section: string | null; scope: string };
export const SECTION_LABEL: Record<string, string> = { kuran: "Kur'an-ı Kerim", risale: "Risale-i Nur", he: "HE Eserleri", diger: "Diğer kitaplar", ibadet: "İbadet" };
export type TList = { id: string; title: string; group_id: string | null; sort_order: number };
export type TGroup = { id: string; title: string; sort_order: number };

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayNum = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
export const endOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); };
export const startOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

export function planDayIndex(p: Plan, today = ymd()) { return dayNum(today) - dayNum(p.start) + 1; }
export function todayCount(t: Todo, today = ymd()) { return t.plan?.done?.[today] ?? 0; }
export function planStats(p: Plan, today = ymd()) {
  const idx = planDayIndex(p, today);
  const dayOf = (i: number) => ymd(new Date((dayNum(p.start) + i - 1) * 86400000 + 12 * 3600000));
  const full = (i: number) => (p.done?.[dayOf(i)] ?? 0) >= p.daily;
  const last = Math.min(idx, p.days);
  let missed = 0;
  for (let i = 1; i < last + (idx > p.days ? 1 : 0); i++) if (!full(i)) missed++;
  let streak = 0;
  for (let i = last; i >= 1; i--) {
    if (full(i)) streak++;
    else if (i !== idx) break;
  }
  return { idx, streak, missed, left: Math.max(0, p.days - idx) };
}

const dnum = (s: string) => dayNum(s);
export const isRecurring = (t: Todo) => !!t.recurrence && t.recurrence.type !== "once";
/** Tekrarlayan görev bu gün yapılacak mı? */
export function occursOn(t: Todo, day: string): boolean {
  const r = t.recurrence;
  if (!r || r.type === "once") return false;
  const start = t.start_date ?? ymd(new Date(t.created_at));
  if (day < start) return false;
  if (t.end_date && day > t.end_date) return false;
  const wd = new Date(day + "T12:00:00").getDay();
  switch (r.type) {
    case "daily": return true;
    case "weekdays": return wd >= 1 && wd <= 5;
    case "weekend": return wd === 0 || wd === 6;
    case "days": return (r.days ?? []).includes(wd);
    case "weekly": return wd === new Date(start + "T12:00:00").getDay();
    case "monthly": return Number(day.slice(8, 10)) === Number(start.slice(8, 10));
    case "every": return (dnum(day) - dnum(start)) % Math.max(1, r.n ?? 1) === 0;
  }
  return false;
}
export const doneOn = (t: Todo, day = ymd()) => t.progress?.[day] ?? 0;

/** Bugün (Günüm) ekranında görünmeli mi? */
export function inToday(t: Todo): boolean {
  if (t.parent_todo_id) return false;
  if (t.kind === "kaza" || t.kind === "kaza_oruc") return !t.is_completed;
  if (isRecurring(t)) return !t.is_completed && occursOn(t, ymd());
  if (t.page_goal) { const d = ymd(); return !t.is_completed && (t.page_goal.per !== "range" || ((!t.start_date || d >= t.start_date) && (!t.end_date || d <= t.end_date))); }
  if (t.is_completed) return !!t.completed_at && ymd(new Date(t.completed_at)) === ymd();
  if (!t.due_at) return !!(t.bookmark_id || t.reading_ref); // kitaba bağlı tek seferlik görev, tarihi yoksa da görünür
  return new Date(t.due_at) < endOfToday();
}
export function isOverdue(t: Todo): boolean {
  return !isRecurring(t) && t.kind !== "kaza" && t.kind !== "kaza_oruc" && !t.is_completed && !!t.due_at && new Date(t.due_at) < startOfToday();
}
export function isDoneToday(t: Todo): boolean {
  if ((t.kind === "kaza" || t.kind === "kaza_oruc") && t.plan) return kazaToday(t.kind === "kaza" ? "namaz" : "oruc") >= t.plan.daily;
  if (t.page_goal) return goalCount(t) >= t.page_goal.n;
  if (isRecurring(t)) return doneOn(t) >= Math.max(1, t.per_day);
  return t.is_completed;
}
const WD = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
/** "Her gün · günde 3 kez · 30 Kas'a kadar" */
export function recurrenceText(t: Pick<Todo, "recurrence" | "per_day" | "end_date">): string {
  const r = t.recurrence;
  if (!r || r.type === "once") return "";
  const base = r.type === "daily" ? "Her gün" : r.type === "weekdays" ? "Hafta içi" : r.type === "weekend" ? "Hafta sonu"
    : r.type === "days" ? (r.days ?? []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD[d]).join(", ")
    : r.type === "weekly" ? "Haftada bir" : r.type === "monthly" ? "Ayda bir" : `${r.n ?? 1} günde bir`;
  const per = t.per_day > 1 ? ` · günde ${t.per_day} kez` : "";
  const end = t.end_date ? ` · ${new Date(t.end_date + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}'e kadar` : "";
  return base + per + end;
}
/** Görevin kütüphane yeri: bölüm · kitap · yer */
export function placeOf(t: Todo): { section?: string; book?: string; label?: string; quote?: string; docId?: string; nodeId?: string | null; live: boolean } | null {
  const b = t.bookmark;
  if (b) return { section: SECTION_LABEL[b.section ?? b.scope] ?? undefined, book: b.book_title ?? undefined, label: b.label ?? b.title, quote: b.quote ?? undefined, docId: b.document_id, nodeId: b.node_id, live: true };
  const r = t.reading_ref;
  if (r) return { section: SECTION_LABEL[r.scope], book: r.book_title, label: r.label, quote: r.quote, docId: r.doc_id, nodeId: r.node_id, live: false };
  return null;
}
/** Bugünkü sayıyı değiştir (tekrarlayan görev). */
export async function bumpProgress(t: Todo, delta: number): Promise<Record<string, number>> {
  const d = ymd();
  const progress = { ...(t.progress ?? {}), [d]: Math.max(0, (t.progress?.[d] ?? 0) + delta) };
  await supabase.from("todos").update({ progress, updated_at: new Date().toISOString() }).eq("id", t.id);
  return progress;
}

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [lists, setLists] = useState<TList[]>([]);
  const [groups, setGroups] = useState<TGroup[]>([]);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const since = ymd(new Date(Date.now() - 120 * 86400000));
    const [t, l, g, r] = await Promise.all([
      supabase.from("todos").select("id,title,notes,is_completed,due_at,list_id,kind,plan,parent_todo_id,related_library_item_id,reading_ref,recurrence,per_day,start_date,end_date,bookmark_id,progress,page_goal,bookmark:reader_bookmarks(id,title,document_id,node_id,quote,label,book_title,section,scope),created_at,completed_at").order("sort_order").order("created_at", { ascending: true }).limit(1000),
      supabase.from("todo_lists").select("id,title,group_id,sort_order").order("sort_order").order("created_at"),
      supabase.from("todo_groups").select("id,title,sort_order").order("sort_order").order("created_at"),
      supabase.from("page_reads").select("book_id,scope,doc_key,page,day").gte("day", since).limit(10000),
    ]);
    if (!r.error) READS = mergeQueuedReads((r.data ?? []) as ReadRow[]);
    if (t.error) setErr(t.error.message); else setTodos((t.data ?? []) as unknown as Todo[]);
    if (!l.error) setLists((l.data ?? []) as TList[]);
    if (!g.error) setGroups((g.data ?? []) as TGroup[]);
    setLoaded(true);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { todos, lists, groups, err, loaded, reload, setTodos };
}

/** Kitaptaki yere git (kaldığım yer / görevin bağlı olduğu cümle). */
export const refPath = (r: ReadingRef) => `/kutuphane/${r.doc_id}`;

/** Ad ile liste bul, yoksa (grubuyla birlikte) oluştur. */
export async function ensureList(lists: TList[], groups: TGroup[], name: string, groupName: string): Promise<string | null> {
  const found = lists.find((l) => l.title === name);
  if (found) return found.id;
  let gid = groups.find((g) => g.title === groupName)?.id ?? null;
  if (!gid) {
    const { data } = await supabase.from("todo_groups").insert({ title: groupName }).select("id").single();
    gid = (data as { id: string } | null)?.id ?? null;
  }
  const { data } = await supabase.from("todo_lists").insert({ title: name, group_id: gid }).select("id").single();
  return (data as { id: string } | null)?.id ?? null;
}

/** Görevi silmeden önce sor: alt görevleri ve bağlı ayracı söyle. Onaylanırsa true. */
export function confirmDeleteTodo(t: Todo, subCount: number): boolean {
  const parts: string[] = [];
  if (subCount) parts.push(`• ${subCount} alt görevi de silinecek.`);
  if (t.bookmark) parts.push(`• “${t.bookmark.title}” ayracına bağlı. Ayraç silinmez, Kaldığın yerler'de kalır.`);
  else if (t.reading_ref) parts.push(`• Kitaptaki yer bağlantısı (${t.reading_ref.label}) da gider.`);
  if (isRecurring(t) && Object.keys(t.progress ?? {}).length) parts.push(`• ${Object.keys(t.progress ?? {}).length} günlük ilerleme kaydı silinecek.`);
  const msg = parts.length ? `⚠️ “${t.title}” silinsin mi?\n\n${parts.join("\n")}` : `“${t.title}” silinsin mi?`;
  return window.confirm(msg);
}

/** Telefonda bekleyen (henüz gönderilmemiş) okundu işaretlerini de say. */
function mergeQueuedReads(rows: ReadRow[]): ReadRow[] {
  let q: { op: "add" | "del"; doc_key: string; page: number; scope: string; book_id: string | null; day: string }[] = [];
  try { q = JSON.parse(localStorage.getItem("lumen.reads.queue.v1") ?? "[]"); } catch { /* yok */ }
  const out = [...rows];
  for (const o of q) {
    const i = out.findIndex((x) => x.doc_key === o.doc_key && x.page === o.page);
    if (o.op === "add" && i < 0) out.push({ book_id: o.book_id, scope: o.scope, doc_key: o.doc_key, page: o.page, day: o.day });
    if (o.op === "del" && i >= 0) out.splice(i, 1);
  }
  return out;
}
