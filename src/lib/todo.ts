import { pageStartLabel } from "./quranPages";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { kazaToday } from "./kaza";
import { loadTP, type TaskPrefs } from "./taskPrefs";
import { bookPagesCached } from "./bookPages";

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
  /** Zorunlu görev: süresi geçen dönem tamamlanana kadar "Tamamlanmamış"ta kalır. false: takip görevi */
  strict?: boolean | null;
  /** görevin kendi yeri (kütüphane ayracı değil): okundu dedikçe ilerler */
  place?: TaskPlace | null;
  /** tamamlanan turlar */
  laps?: Lap[] | null;
  bookmark?: BookmarkLite | null;
  created_at: string;
  completed_at: string | null;
};
export type TaskPlace = { doc_id: string; node_id: string | null; page?: number | null; label?: string; /** düğümdeki kelime sırası (burada kaldım) */ word?: number };
export type Lap = { n: number; a: string; b: string };
/** Görevin kitaptaki yeri: "yer" = kaldığım yer, "konu" = bir cümle/sayfa hakkında görev (araştır, sor…). */
export type ReadingRef = { kind: "yer" | "konu"; doc_id: string; node_id: string | null; book_id: string | null; scope: string; label: string; quote: string; book_title?: string };
/** Sıklık. days: 0=Pazar … 6=Cumartesi */
export type Recurrence = { type: "once" | "daily" | "weekdays" | "weekend" | "days" | "weekly" | "monthly" | "every"; days?: number[]; n?: number };
/** Okuma hedefi: n sayfa, gün/hafta/ay ya da başlangıç–bitiş aralığında. book_id: kitap klasörü (Kur'an için null). */
export type PageGoal = { n: number; per: "day" | "week" | "month" | "range" | "pages"; book_id: string | null; scope: string; from?: number; to?: number; doc_key?: string; unit?: string; /** aralık hedefinin dönemi */ every?: "day" | "week" | "month" | "range"; /** tek tek seçilen sayfalar (yoksa from–to) */ pages?: number[];
  /** görev türü: "seq" sırayla oku (kitap gibi), "pay" belli sayfalar belli sürede. Yoksa: per==="pages" → pay */
  mode?: "seq" | "pay";
  /** sırayla oku: kapsam bitince başa dön (tur) */
  loop?: boolean;
  /** pay: pay bitince hemen başa dön (sonraki dönemin payı önceden okunabilir) */
  early?: boolean };
/** sayfa hedefin içinde mi (seçili sayfalar ya da from–to aralığı) */
export const inGoal = (g: PageGoal, page: number) => (g.pages?.length ? g.pages.includes(page) : page >= (g.from ?? 0) && page <= (g.to ?? 1e9));
/** hedefte bu sayfadan sonraki sayfa (seçili sayfalarda bir sonraki seçili; aralıkta bir sonraki) */
export const nextGoalPage = (g: PageGoal, page: number): number | null => {
  if (g.pages?.length) return [...g.pages].sort((a, b) => a - b).find((p) => p > page) ?? null;
  return page + 1 <= (g.to ?? 1e9) ? page + 1 : null;
};
/** 3, 5, 9–12 gibi kısa yazım */
export function pagesText(ps: number[]): string {
  const s = [...new Set(ps)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]));
    i = j;
  }
  return out.join(", ");
}
export type ReadRow = { book_id: string | null; scope: string; doc_key: string; context_key: string; page: number; day: string };
/** Okunan sayfalar (son 120 gün); useTodos yükler, okuma hedefleri buradan sayılır. */
let READS: ReadRow[] = [];
/** numaralı kitapların sayfa/bab sayısı (0: bilinmiyor) */
const BOOK_SIZE: Record<string, number> = {};
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
/** Aralık hedefi (ör. 10–20) hangi günlerin okumasını sayar: günde / haftada / ayda / tarih aralığında.
 *  Eski kayıtlarda (every yok): tekrarlayan görevde bugün, değilse tüm zamanlar. */
export function rangeWindow(t: Pick<Todo, "page_goal" | "start_date" | "end_date"> & { recurrence?: Recurrence | null }, day = ymd()): [string, string] {
  const g = t.page_goal!;
  if (g.every) return goalPeriod({ ...t, page_goal: { ...g, per: g.every } }, day);
  return t.recurrence && t.recurrence.type !== "once" ? [day, day] : ["0000-01-01", "9999-12-31"];
}
const short = (s: string) => (s.length > 22 ? s.slice(0, 20).replace(/,\s*[^,]*$/, "") + "…" : s);
const EVERY_TXT: Record<string, string> = { day: "günde", week: "haftada", month: "ayda", range: "tarih aralığında" };
const sameBook = (g: PageGoal, r: ReadRow) => (g.book_id ? r.book_id === g.book_id : r.scope === g.scope);
/** Dönemde okunan sayfa sayısı. exceptDoc: o belgeyi sayma (okuyucu kendi canlı sayısını ekler). */
export function goalCount(t: Pick<Todo, "id" | "page_goal" | "start_date" | "end_date"> & { recurrence?: Recurrence | null }, rows: ReadRow[] = READS, exceptDoc?: string, contextKey = t.id ? `todo:${t.id}` : "global"): number {
  if (!t.page_goal) return 0;
  const g = t.page_goal;
  // sayfa aralığı (ör. Tevhidname 10–20): o aralıkta okunan farklı sayfalar, gün fark etmez
  // tekrarlayan görevde (ör. her gün Cevşen 20–30) yalnız bugün okunanlar sayılır
  if (g.per === "pages") { const [a, b] = rangeWindow(t); return new Set(rows.filter((r) => r.context_key === contextKey && r.doc_key === g.doc_key && r.doc_key !== exceptDoc && inGoal(g, r.page) && r.day >= a && r.day <= b).map((r) => r.page)).size; }
  const [a, b] = goalPeriod(t);
  return new Set(rows.filter((r) => r.context_key === contextKey && sameBook(t.page_goal!, r) && r.day >= a && r.day <= b && r.doc_key !== exceptDoc).map((r) => r.doc_key + ":" + r.page)).size;
}

/* ── Okuma görevleri ──
   İki tür: "Sırayla oku" (kitap gibi: kaldığı yerden ilerler; isteğe bağlı tur = bitince başa dön) ve
   "Pay" (belli sayfalar belli sürede; her dönemin payı ayrı). Görev kütüphane ayracı kullanmaz, kendi yerini tutar.
   Okundu işaretleri görevin bağlamına yazılır: tur için "todo:<id>#<tur>", pay için "todo:<id>@<dönem başı>".
   Böylece her tur/dönem ayrı sayılır, aynı gün iki tur da okunabilir; gün gün sayılar hep tutulur.
   Takip: hedef tutmazsa sadece geçmişe yazılır. Zorunlu: süresi geçen dönem "Tamamlanmamış"ta kalır. */
export type Period = { a: string; b: string; got: number; need: number; skipped: boolean;
  /** dönemde okunan (hedefle sınırlanmamış) */ raw?: number; /** bugünden önceki günlerin fazlasıyla kapanmayan eksik */ debt?: number; /** eksik sonradan kapandıysa: kapandığı dönemin başı */ madeUp?: string };
/** Eksik kalan dönemler sonraki dönemlerin fazlasıyla (hedefin üstünde okunanla) kapanır: en eski eksik önce. */
function settleDebts(ps: Period[], today: string) {
  const open: { p: Period; left: number }[] = [];
  for (const p of ps) {
    if (p.skipped || p.need <= 0) continue;
    const raw = p.raw ?? p.got;
    if (p.b < today) p.debt = 0;
    let surplus = Math.max(0, raw - p.need);
    while (surplus > 0 && open.length) {
      const d = open[0], use = Math.min(surplus, d.left);
      d.left -= use; surplus -= use;
      if (p.b < today) d.p.debt = d.left;
      if (!d.left) { d.p.madeUp = p.a; open.shift(); }
    }
    if (raw < p.need && p.b < today) { open.push({ p, left: p.need - raw }); p.debt = p.need - raw; }
  }
}
const addDays = (s: string, n: number) => ymd(new Date((dayNum(s) + n) * 86400000 + 12 * 3600000));
export const nextDay = (s: string) => addDays(s, 1);
export const goalMode = (g: PageGoal): "seq" | "pay" => g.mode ?? (g.per === "pages" ? "pay" : "seq");
/** kapsamdaki sayfa/bab sayısı (bilinmiyorsa 0) */
export const scopeSize = (g: PageGoal) => (g.pages?.length ? g.pages.length : g.from != null && g.to != null ? Math.abs(g.to - g.from) + 1 : g.book_id ? BOOK_SIZE[g.book_id] || bookPagesCached(g.book_id)?.total || 0 : 0);
/** kitabın tamamı okunan sırayla-oku görevi için toplam sayfa henüz bilinmiyor mu (bölümlü kitap) */
export const needsBookPages = (g: PageGoal | null | undefined): string | null => (g && goalMode(g) === "seq" && g.from == null && !g.pages?.length && g.book_id && !BOOK_SIZE[g.book_id] && !bookPagesCached(g.book_id) ? g.book_id : null);
export const inScope = (g: PageGoal, p: number) => (g.pages?.length ? g.pages.includes(p) : (g.from == null || p >= g.from) && (g.to == null || p <= g.to));
export const lapOf = (t: Pick<Todo, "laps">) => (t.laps?.length ?? 0) + 1;
export const seqCtx = (t: Pick<Todo, "id" | "laps">, lap = lapOf(t)) => `todo:${t.id}#${lap}`;
export const payCtx = (t: Pick<Todo, "id">, a: string) => `todo:${t.id}@${a}`;
const isTaskCtx = (id: string, k: string) => k === `todo:${id}` || k.startsWith(`todo:${id}#`) || k.startsWith(`todo:${id}@`);
export const taskRows = (t: Pick<Todo, "id">, rows: ReadRow[] = READS) => rows.filter((r) => isTaskCtx(t.id, r.context_key));
export function periodUnit(t: Pick<Todo, "page_goal" | "recurrence">): "day" | "week" | "month" | "range" {
  const g = t.page_goal;
  if (!g) return "day";
  if (goalMode(g) === "pay") return g.every ?? (t.recurrence && t.recurrence.type !== "once" ? "day" : "range");
  return g.per === "pages" ? "day" : g.per;
}
const HORIZON = 90; // en fazla 90 gün geriye bakılır
export function taskPeriods(t: Todo, today = ymd()): [string, string][] {
  const unit = periodUnit(t);
  const start = t.start_date ?? ymd(new Date(t.created_at));
  if (unit === "range") return [[start, t.end_date ?? "9999-12-31"]];
  const from = start > addDays(today, -HORIZON) ? start : addDays(today, -HORIZON);
  const out: [string, string][] = [];
  if (unit === "day") {
    const rec = isRecurring(t);
    for (let d = from; d <= today; d = addDays(d, 1)) {
      if (t.end_date && d > t.end_date) break;
      if (rec ? occursOn(t, d) : true) out.push([d, d]);
    }
    return out;
  }
  const dummy = { start_date: null, end_date: null, page_goal: { n: 1, per: unit, book_id: null, scope: "" } as PageGoal };
  let [a, b] = goalPeriod(dummy, from);
  while (a <= today && (!t.end_date || a <= t.end_date)) { out.push([a, b]); [a, b] = goalPeriod(dummy, addDays(b, 1)); }
  return out;
}
/** pay: bir dönemin bağlamında okunan (kapsamdaki) farklı sayfalar */
export const ctxPages = (g: PageGoal, ctx: string, rows: ReadRow[] = READS) => new Set(rows.filter((r) => r.context_key === ctx && (!g.doc_key || r.doc_key === g.doc_key) && inScope(g, r.page)).map((r) => r.page));
/** Görevin dönemleri ve her dönemde okunan/yapılan miktar. */
export function periodStats(t: Todo, rows: ReadRow[] = READS, today = ymd()): Period[] {
  const ps: Period[] = taskPeriods(t, today).map(([a, b]) => ({ a, b, got: 0, need: 1, skipped: !!t.progress?.["s:" + a] }));
  const g = t.page_goal;
  if (!g) { // kitapsız tekrarlı görev: gün gün işaret
    const need = Math.max(1, t.per_day);
    for (const p of ps) { p.need = need; p.raw = t.progress?.[p.a] ?? 0; p.got = Math.min(need, p.raw); }
    settleDebts(ps, today);
    return ps;
  }
  if (goalMode(g) === "pay") {
    const need = scopeSize(g) || g.n;
    for (const p of ps) { p.need = need; p.got = Math.min(need, ctxPages(g, payCtx(t, p.a), rows).size); }
    return ps;
  }
  // sırayla oku: dönemde okunan miktar (her tur ayrı sayılır)
  const need = g.n;
  const mine = taskRows(t, rows).sort((x, y) => (x.day < y.day ? -1 : 1));
  const sets = ps.map(() => new Set<string>());
  for (const r of mine) {
    const u = r.context_key + ":" + r.doc_key + ":" + r.page;
    if (t.strict && need > 0) {
      // zorunlu: okunan önce en eski eksik döneme sayılır
      const i = ps.findIndex((p, k) => !p.skipped && p.a <= r.day && sets[k].size < need && !sets[k].has(u));
      if (i >= 0) sets[i].add(u);
    } else {
      const i = ps.findIndex((p) => r.day >= p.a && r.day <= p.b);
      if (i >= 0) sets[i].add(u);
    }
  }
  ps.forEach((p, k) => { p.need = need; p.raw = sets[k].size; p.got = need > 0 ? Math.min(need, sets[k].size) : sets[k].size; });
  if (!t.strict && need > 0) settleDebts(ps, today);
  return ps;
}
export type TaskState = {
  mode: "seq" | "pay" | "none"; periods: Period[]; cur: Period | null; prev: Period | null; missed: Period[];
  catchUp: number; target: number; got: number; /** bugünkü hedefe eklenen telafi */ bonus: number;
  /** okundu işaretlerinin yazılacağı bağlam */ ctx: string; lap: number; /** turda / payda okunan */ lapRead: number; total: number;
  /** bugün okunan (bütün turlar) */ todayCount: number; /** pay: önceden okunan sonraki dönem */ ahead: { a: string; got: number } | null;
};
/** Bugünkü durum: tur/pay ilerlemesi, günlük sayı, telafi, zorunlu görevde kaçan dönemler. */
export function taskState(t: Todo, prefs: TaskPrefs = loadTP(), rows: ReadRow[] = READS, today = ymd()): TaskState {
  const g = t.page_goal;
  const periods = periodStats(t, rows, today);
  const cur = periods.find((p) => p.a <= today && today <= p.b) ?? null;
  const ci = cur ? periods.indexOf(cur) : periods.length;
  const prev = ci > 0 ? periods[ci - 1] : null;
  const missed = t.strict && !t.is_completed ? periods.filter((p) => p.b < today && !p.skipped && p.need > 0 && p.got < p.need) : [];
  const mine = g ? taskRows(t, rows) : [];
  const todayCount = new Set(mine.filter((r) => r.day === today).map((r) => r.context_key + ":" + r.doc_key + ":" + r.page)).size;
  const mode = g ? goalMode(g) : "none";
  let ctx = `todo:${t.id}`, lap = 1, lapRead = 0, total = 0, ahead: TaskState["ahead"] = null;
  if (g && mode === "seq") {
    lap = lapOf(t); ctx = seqCtx(t, lap); total = scopeSize(g);
    lapRead = new Set(mine.filter((r) => r.context_key === ctx && inScope(g, r.page)).map((r) => r.doc_key + ":" + r.page)).size;
  } else if (g && mode === "pay") {
    total = scopeSize(g) || g.n;
    ctx = payCtx(t, cur?.a ?? today);
    lapRead = cur?.got ?? 0;
    if (g.early && cur && cur.got >= cur.need && periodUnit(t) !== "range") {
      const na = addDays(cur.b, 1);
      ahead = { a: na, got: ctxPages(g, payCtx(t, na), rows).size };
      ctx = payCtx(t, na);
    }
  }
  const unitRange = periodUnit(t) === "range";
  const base = !g ? Math.max(1, t.per_day) : mode === "seq" ? g.n : cur?.need ?? total;
  const catchUp = mode === "seq" && base > 0 && !t.strict && prefs.catchUp && cur && prev && !prev.skipped && !unitRange ? Math.max(0, prev.debt ?? prev.need - prev.got) : 0;
  // telafi en fazla bir günlük hedef kadar; kapsamı belli kitapta (Cevşen) kapsamın tamamını geçemez
  const size = g ? scopeSize(g) : 0;
  const bonus = Math.max(0, Math.min(base, catchUp, size ? size - base : Infinity));
  return { mode, periods, cur, prev, missed, catchUp, target: base + bonus, got: cur ? Math.min(cur.raw ?? cur.got, Math.max(cur.need, base + bonus)) : 0, bonus, ctx, lap, lapRead, total, todayCount, ahead };
}
/** Zorunlu görevin kaçan dönemini atla (geçmişte "atlandı" diye kalır). */
export async function skipPeriod(t: Todo, a: string) {
  const progress = { ...(t.progress ?? {}), ["s:" + a]: 1 };
  await supabase.from("todos").update({ progress, updated_at: new Date().toISOString() }).eq("id", t.id);
}
/** Kitapsız zorunlu görevde geçmiş bir günü işaretle. */
export async function bumpDay(t: Todo, day: string, delta: number) {
  const progress = { ...(t.progress ?? {}), [day]: Math.max(0, (t.progress?.[day] ?? 0) + delta) };
  await supabase.from("todos").update({ progress, updated_at: new Date().toISOString() }).eq("id", t.id);
}
const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const GUN = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
/** "Perşembe 19 Kas" ya da "17–23 Kas" */
export function periodText(p: Pick<Period, "a" | "b">): string {
  const d = (s: string) => `${Number(s.slice(8, 10))} ${AY[Number(s.slice(5, 7)) - 1]}`;
  if (p.a === p.b) return `${GUN[new Date(p.a + "T12:00:00").getDay()]} ${d(p.a)}`;
  if (p.b >= "9999") return `${d(p.a)}'den beri`;
  return `${d(p.a)} – ${d(p.b)}`;
}
export const goalLabel = (g: PageGoal) => {
  if (goalMode(g) === "pay") return `${(g.unit ?? "sayfa").replace(/^./, (c) => c.toLocaleUpperCase("tr"))} ${g.pages?.length ? short(pagesText(g.pages)) : `${g.from}–${g.to}`}${g.every ? " · " + EVERY_TXT[g.every] : ""}`;
  return !g.n || g.per === "day" ? "Bugün" : g.per === "week" ? "Bu hafta" : g.per === "month" ? "Bu ay" : "Toplam";
};
/** Görevde bugüne kadar okunan toplam (bütün turlar/dönemler). */
export function goalProgress(t: Pick<Todo, "id" | "page_goal">): number {
  return new Set(taskRows(t).map((r) => r.context_key + ":" + r.doc_key + ":" + r.page)).size;
}


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
  if (t.page_goal) {
    const s = taskState(t);
    if (s.mode === "seq" && !t.page_goal.n) return s.todayCount > 0; // hedefsiz: bugün okunduysa
    return !!s.cur && s.got >= s.target;
  }
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
  const r0 = t.reading_ref;
  if (t.place) return { section: r0 ? SECTION_LABEL[r0.scope] : undefined, book: r0?.book_title, label: t.place.label ?? r0?.label, quote: undefined, docId: t.place.doc_id, nodeId: t.place.node_id, live: true };
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

const TODO_TABLES = ["todos", "todo_lists", "todo_groups", "page_reads", "reader_bookmarks"];
let TCACHE: { at: number; todos: Todo[]; lists: TList[]; groups: TGroup[] } | null = null;
let TDIRTY = false;
if (typeof window !== "undefined") window.addEventListener("lumen-write", (e) => { if (TODO_TABLES.includes((e as CustomEvent<string>).detail)) TDIRTY = true; });
export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [lists, setLists] = useState<TList[]>([]);
  const [groups, setGroups] = useState<TGroup[]>([]);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async (force = false) => {
    // aynı veri her ekranda yeniden çekilmesin (veri kotası): yazma olmadıysa 10 dk içindeki son liste kullanılır
    if (!force && TCACHE && !TDIRTY && Date.now() - TCACHE.at < 10 * 60 * 1000) {
      setTodos(TCACHE.todos); setLists(TCACHE.lists); setGroups(TCACHE.groups); setLoaded(true); return;
    }
    TDIRTY = false;
    const since = ymd(new Date(Date.now() - 120 * 86400000));
    const [t, l, g, r] = await Promise.all([
      supabase.from("todos").select("id,title,notes,is_completed,due_at,list_id,kind,plan,parent_todo_id,related_library_item_id,reading_ref,recurrence,per_day,start_date,end_date,bookmark_id,progress,page_goal,strict,place,laps,bookmark:reader_bookmarks(id,title,document_id,node_id,quote,label,book_title,section,scope),created_at,completed_at").order("sort_order").order("created_at", { ascending: true }).limit(1000),
      supabase.from("todo_lists").select("id,title,group_id,sort_order").order("sort_order").order("created_at"),
      supabase.from("todo_groups").select("id,title,sort_order").order("sort_order").order("created_at"),
      supabase.from("page_reads").select("book_id,scope,doc_key,context_key,page,day").gte("day", since).limit(10000),
    ]);
    if (!r.error) READS = mergeQueuedReads((r.data ?? []) as ReadRow[]);
    // numaralı kitapların (Cevşen 100 bab, Tevhidname…) boyu: günlük hedef + telafi kitabın kendisinden büyük olamaz
    const books = [...new Set(((t.data ?? []) as unknown as Todo[]).map((x) => x.page_goal?.per !== "pages" ? x.page_goal?.book_id : null).filter((x): x is string => !!x && !(x in BOOK_SIZE)))];
    if (books.length) {
      const { data: kids } = await supabase.from("library_items").select("parent_id").in("parent_id", books).not("metadata->>page", "is", null).limit(5000);
      for (const b of books) BOOK_SIZE[b] = ((kids ?? []) as { parent_id: string }[]).filter((k) => k.parent_id === b).length || 0;
    }
    if (t.error) setErr(t.error.message); else setTodos((t.data ?? []) as unknown as Todo[]);
    if (!l.error) setLists((l.data ?? []) as TList[]);
    if (!g.error) setGroups((g.data ?? []) as TGroup[]);
    if (!t.error && !l.error && !g.error && !r.error) TCACHE = { at: Date.now(), todos: (t.data ?? []) as unknown as Todo[], lists: (l.data ?? []) as TList[], groups: (g.data ?? []) as TGroup[] };
    setLoaded(true);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // başka ekranda yazma olursa (görev güncellendi, sayfa okundu) bu ekran da tazelenir
  useEffect(() => {
    const on = (e: Event) => { if (TODO_TABLES.includes((e as CustomEvent<string>).detail)) { TDIRTY = true; } };
    window.addEventListener("lumen-write", on);
    return () => window.removeEventListener("lumen-write", on);
  }, []);
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
  let q: { op: "add" | "del"; doc_key: string; context_key: string; page: number; scope: string; book_id: string | null; day: string }[] = [];
  try { q = JSON.parse(localStorage.getItem("lumen.reads.queue.v1") ?? "[]"); } catch { /* yok */ }
  const out = [...rows];
  for (const o of q) {
    const i = out.findIndex((x) => x.doc_key === o.doc_key && x.context_key === o.context_key && x.page === o.page && x.day === o.day);
    if (o.op === "add" && i < 0) out.push({ book_id: o.book_id, scope: o.scope, doc_key: o.doc_key, context_key: o.context_key, page: o.page, day: o.day });
    if (o.op === "del" && i >= 0) out.splice(i, 1);
  }
  return out;
}

/* ── Görev kartının ikinci satırı (standart) ──
   [① tek seferlik | ↻ tekrar] · bugün okunan / dönem ilerlemesi · tur · kaldığın yer (aralık) · ne zamana kadar
   Toplam ilerleme yeşil düğmede; burada tekrar yazılmaz. */
export type LinePart = { t: string; warn?: boolean; ok?: boolean; /** atlanan sayfa: basınca oraya gidilir */ skip?: number; /** o sayfanın okunacağı bağlam (önceki tur) */ skipCtx?: string };
const WD_TO = ["Pazar'a", "Pazartesi'ye", "Salı'ya", "Çarşamba'ya", "Perşembe'ye", "Cuma'ya", "Cumartesi'ye"];
const MON_TO = ["Ocak'a", "Şubat'a", "Mart'a", "Nisan'a", "Mayıs'a", "Haziran'a", "Temmuz'a", "Ağustos'a", "Eylül'e", "Ekim'e", "Kasım'a", "Aralık'a"];
/** "25 Kas'a kadar" · haftalıkta "Paz'a kadar" · "yarın son" · "bugün son" · "2 gün geçti" */
export function untilText(end: string, week = false, today = ymd()): LinePart {
  const d = Math.round((dayNum(end) - dayNum(today)));
  if (d < 0) return { t: `${-d} gün geçti`, warn: true };
  if (d === 0) return { t: "bugün son" };
  if (d === 1) return { t: "yarın son" };
  const dt = new Date(end + "T12:00:00");
  if (week && d < 7) return { t: `${WD_TO[dt.getDay()]} kadar` };
  return { t: `${dt.getDate()} ${MON_TO[dt.getMonth()]} kadar` };
}
/** ① ya da ↻ (+ tekrar türü) */
export function repeatMark(t: Pick<Todo, "recurrence" | "start_date" | "created_at" | "page_goal">): string {
  const r = t.recurrence;
  if (!r || r.type === "once") return "①";
  const g = t.page_goal;
  const gp = g ? (goalMode(g) === "pay" ? g.every : g.n ? g.per : undefined) : undefined;
  if (gp === "week") return "↻ haftalık";
  if (gp === "month") return "↻ aylık";
  const start = t.start_date ?? ymd(new Date(t.created_at));
  switch (r.type) {
    case "daily": return "↻";
    case "weekdays": return "↻ Pzt–Cum";
    case "weekend": return "↻ Cmt–Paz";
    case "days": return "↻ " + [...(r.days ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD[d]).join("·");
    case "weekly": return "↻ " + WD[new Date(start + "T12:00:00").getDay()];
    case "monthly": return "↻ aylık";
    case "every": return `↻ ${r.n ?? 1} günde bir`;
    default: return "↻";
  }
}
/** Kaldığın yerin kısa hâli: "Nahl 55, s. 272" · "Birinci Söz, s. 4" · "Giriş" */
export function shortPlace(label: string | undefined, drop: (string | undefined)[], page?: number | null, unit?: string): string {
  const parts = (label ?? "").split(" · ").map((x) => x.trim()).filter(Boolean)
    .filter((x) => !/^[“"«]/.test(x))
    .filter((x) => !drop.some((d) => d && (x === d || d.includes(x))))
    .map((x) => x.replace(/^Sayfa\s+(\d+)$/, "s. $1").replace(/^(.*?)\s+(\d+)\.\s*âyet$/, "$1 $2"));
  if (parts.length) return parts.join(", ");
  if (page != null) return unit === "bab" ? `${page}. Bab` : `s. ${page}`;
  return "";
}
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const dayMonth = (d: string) => { const x = new Date(d + "T12:00:00"); return `${x.getDate()} ${MONTHS[x.getMonth()]}`; };
/** Bu bağlamda en son okunan gün (görevin tamamlandığı gün yerine) */
function lastReadDay(g: PageGoal, ctx: string): string | null {
  let m: string | null = null;
  for (const r of READS) if (r.context_key === ctx && (!g.doc_key || r.doc_key === g.doc_key) && inScope(g, r.page) && (!m || r.day > m)) m = r.day;
  return m;
}
/** Görevin kapsamındaki sayfalar (sıralı) */
export function goalPages(g: PageGoal): number[] | null {
  const all = g.pages?.length ? [...g.pages].sort((a, b) => a - b)
    : g.from != null && g.to != null ? Array.from({ length: Math.abs(g.to - g.from) + 1 }, (_, i) => Math.min(g.from!, g.to!) + i) : null;
  return all && all.length <= 5000 ? all : null;
}
/** Atlanan sayfalar: okunan en ileri sayfadan geride kalıp işaretlenmemiş olanlar */
export function skippedPages(g: PageGoal, read: Set<number>): number[] {
  const all = goalPages(g);
  if (!all || !read.size) return [];
  const last = Math.max(...all.filter((x) => read.has(x)));
  return all.filter((x) => x < last && !read.has(x));
}
export const skippedOf = (g: PageGoal, ctx: string) => skippedPages(g, ctxPages(g, ctx));
/** Biten turların eksikleri (tur görevinde): her tur için okunmamış sayfalar.
 *  Okumaları telefonda olmayan (çok eski) turlar sayılmaz. */
export function lapGaps(t: Pick<Todo, "id" | "laps" | "page_goal">): { n: number; ctx: string; read: number; missing: number[] }[] {
  const g = t.page_goal;
  const all = g ? goalPages(g) : null;
  if (!g?.loop || !all || !t.laps?.length) return [];
  return t.laps.map((l) => {
    const ctx = seqCtx(t, l.n);
    const read = ctxPages(g, ctx);
    return { n: l.n, ctx, read: all.filter((x) => read.has(x)).length, missing: read.size ? all.filter((x) => !read.has(x)) : [] };
  });
}
/** "12. Bab", "Nahl 55, s. 272", "s. 40" */
export function pageName(g: PageGoal, p: number): string {
  if (g.unit === "bab") return `${p}. Bab`;
  if (g.scope === "kuran" || g.doc_key === "kuran") { const sa = pageStartLabel(p); return sa ? `${sa}, s. ${p}` : `s. ${p}`; }
  return `s. ${p}`;
}
/** Görevin şu anki yeri (okunan sayfalardan): son okunandan sonraki ilk okunmamış; hepsi okunduysa "done". */
export function livePlace(g: PageGoal, ctx: string): number | "done" | null {
  const all = g.pages?.length ? [...g.pages].sort((a, b) => a - b)
    : g.from != null && g.to != null ? Array.from({ length: Math.abs(g.to - g.from) + 1 }, (_, i) => Math.min(g.from!, g.to!) + i) : null;
  if (!all || all.length > 5000) return null;
  const read = ctxPages(g, ctx);
  if (!read.size) return null; // henüz okuma yok: kayıtlı yer gösterilir
  if (all.every((x) => read.has(x))) return "done";
  const last = Math.max(...all.filter((x) => read.has(x)));
  return all.find((x) => x > last && !read.has(x)) ?? all.find((x) => !read.has(x)) ?? null;
}
export function taskLine(t: Todo, s: TaskState | undefined, pl: ReturnType<typeof placeOf>, extra?: string): LinePart[] {
  const out: LinePart[] = [{ t: repeatMark(t) }];
  const g = t.page_goal;
  const rec = isRecurring(t);
  let end: LinePart | null = null;
  if (g && s) {
    const mode = goalMode(g);
    const pu = periodUnit(t);
    const today = s.todayCount;
    if (mode === "seq" && g.n && pu === "day") {
      const got = Math.max(s.got, today);
      out.push({ t: `${got}/${s.target}${got >= s.target ? " ✓" : ""}` });
    } else if (mode === "seq" && g.n && (pu === "week" || pu === "month")) {
      out.push({ t: `${s.got}/${s.target}${s.got >= s.target ? " ✓" : ""}${today ? ` (+${today})` : ""}` });
    } else {
      out.push({ t: `+${today}${mode === "pay" && s.ahead ? " ✓" : ""}` });
    }
    if (!t.strict && s.bonus > 0) out.push({ t: `telafi +${s.bonus}` });
    if (g.loop) out.push({ t: `${s.lap}. tur` });
    const showRange = mode === "pay" || !!g.pages?.length || (g.from != null && g.from > 1);
    const rng = g.pages?.length ? pagesText(g.pages) : g.from != null && g.to != null ? `${Math.min(g.from, g.to)}–${Math.max(g.from, g.to)}` : "";
    // kaldığın yer okumalardan hesaplanır: en son okunan sayfadan sonraki ilk okunmamış sayfa
    const cur = livePlace(g, s.ctx);
    const isKuran = g.scope === "kuran" || g.doc_key === "kuran";
    let place = cur === "done" ? "✓"
      : cur == null || t.place?.page === cur ? shortPlace(pl?.label, [t.title, pl?.book, pl?.section], t.place?.page, g.unit)
      : g.unit === "bab" ? `${cur}. Bab` : `s. ${cur}`;
    // Kur'an: sayfa tek başına yazılmışsa başına o sayfanın sûre ve âyeti eklenir ("Kehf 98, s. 303")
    const m = isKuran ? /^s\. (\d+)$/.exec(place) : null;
    if (m) { const sa = pageStartLabel(Number(m[1])); if (sa) place = `${sa}, ${place}`; }
    const pr = [place, showRange && rng ? `(${rng})` : ""].filter(Boolean).join(" ");
    if (cur === "done") out.push({ t: "✓", ok: true }); // hepsi okundu: sadece yeşil tik
    else if (pr) out.push({ t: pr });
    if (cur !== "done") { const sk = skippedOf(g, s.ctx); if (sk.length) out.push({ t: `⚠ ${sk.length} atlandı`, warn: true, skip: sk[0] }); }
    if (g.loop) {
      const gaps = lapGaps(t).filter((x) => x.missing.length);
      const n = gaps.reduce((a, x) => a + x.missing.length, 0);
      if (n) out.push({ t: `⚠ önceki turlarda ${n} eksik`, warn: true, skip: gaps[0].missing[0], skipCtx: gaps[0].ctx });
    }
    if (pu === "week" || pu === "month") { if (s.cur) end = untilText(s.cur.b, pu === "week"); }
    else if (!rec && t.end_date) end = untilText(t.end_date);
    else if (pu === "range" && t.end_date) end = untilText(t.end_date);
  } else {
    if (rec && Math.max(1, t.per_day) > 1) {
      const total = doneOn(t), per = t.per_day;
      out.push({ t: `${Math.min(total, per)}/${per}${total >= per ? " ✓" : ""}` });
      // zikir görevi: bugün kaçıncı turda (tur = günlük sayı kadar çekim)
      if (t.reading_ref?.doc_id && total > 0) out.push({ t: `${Math.floor(total / per) + 1}. tur` });
    }
    const place = pl ? shortPlace(pl.label, [t.title, pl.book]) : "";
    if (place) out.push({ t: place });
    if (!rec && t.end_date) end = untilText(t.end_date);
    else if (!rec && t.due_at) end = untilText(ymd(new Date(t.due_at)));
  }
  // tamamlanan görevde geri sayım yok; "tamamlandı 20 Kasım"
  const finished = t.is_completed || (!rec && !!g && !g.loop && !!s && livePlace(g, s.ctx) === "done");
  if (finished) {
    const day = t.completed_at ? ymd(new Date(t.completed_at)) : g && s ? lastReadDay(g, s.ctx) : null;
    end = { t: day ? `tamamlandı ${dayMonth(day)}` : "tamamlandı", ok: true };
  }
  if (end) out.push(end);
  if (t.strict) out.push({ t: "Zorunlu" });
  if (extra) out.push({ t: extra });
  return out;
}
