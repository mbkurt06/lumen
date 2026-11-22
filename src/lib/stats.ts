import { supabase } from "./supabase";
import { ymd } from "./todo";
import { ensureBookPages } from "./bookPages";
import { SURE_ADLARI, pageStart } from "./quranPages";

/* Okuma istatistikleri: okundu işaretlenen her sayfa (page_reads) hangi gün, hangi okuyuşta (görev turu,
   pay dönemi, ayraç ya da görevsiz) okunduğuyla kayıtlı. Bir sayfanın okunma sayısı = kaç ayrı okuyuşta
   işaretlendiği. Bir bölüm, bütün sayfaları en az N kez okunduysa N kez okunmuş sayılır. */
export type SRow = { day: string; page: number; doc_key: string; book_id: string | null; scope: string; context_key: string };

let CACHE: { at: number; rows: SRow[] } | null = null;
export async function loadStatRows(force = false): Promise<SRow[]> {
  if (!force && CACHE && Date.now() - CACHE.at < 60_000) return CACHE.rows;
  const out: SRow[] = [];
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await supabase.from("page_reads").select("day,page,doc_key,book_id,scope,context_key").order("day").range(from, from + 999);
    if (error) { if (CACHE) return CACHE.rows; throw error; }
    out.push(...((data ?? []) as SRow[]));
    if (!data || data.length < 1000) break;
  }
  CACHE = { at: Date.now(), rows: out };
  return out;
}

/* ── dönem seçimi ── */
export type Span = "all" | "year" | "month" | "week";
export const SPAN_LABEL: Record<Span, string> = { all: "Tümü", year: "Bu yıl", month: "Bu ay", week: "Bu hafta" };
let SPAN: Span = "all";
export const getSpan = () => SPAN;
export const setSpan = (s: Span) => { SPAN = s; };
export function spanStart(s: Span, today = new Date()): string {
  if (s === "year") return `${today.getFullYear()}-01-01`;
  if (s === "month") return ymd(new Date(today.getFullYear(), today.getMonth(), 1));
  if (s === "week") { const w = (today.getDay() + 6) % 7; return ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - w)); }
  return "0000";
}
export const inSpan = (rows: SRow[], s: Span) => { const a = spanStart(s); return s === "all" ? rows : rows.filter((r) => r.day >= a); };

/** Kitap anahtarı: Kur'an "kuran", diğerleri kitabın kök kaydı */
export const bookKey = (r: SRow) => (r.doc_key === "kuran" ? "kuran" : r.book_id ?? r.doc_key);

/** sayfa → kaç ayrı okuyuşta okundu, son okunduğu gün */
export type PageCount = Map<number, { n: number; last: string }>;
export function pageCounts(rows: SRow[]): PageCount {
  const seen = new Set<string>();
  const m: PageCount = new Map();
  for (const r of rows) {
    const k = r.context_key + "|" + r.page;
    if (seen.has(k)) continue;
    seen.add(k);
    const c = m.get(r.page);
    if (c) { c.n++; if (r.day > c.last) c.last = r.day; } else m.set(r.page, { n: 1, last: r.day });
  }
  return m;
}
/** Bölümün durumu: kaç kez tam okundu, sonraki okuyuşta kaç sayfa okundu, son gün */
export type UnitStat = { times: number; extra: number; size: number; read: number; last: string | null };
export function unitStat(pages: number[], cnt: PageCount): UnitStat {
  if (!pages.length) return { times: 0, extra: 0, size: 0, read: 0, last: null };
  let times = Infinity, last: string | null = null, read = 0;
  for (const p of pages) {
    const c = cnt.get(p);
    times = Math.min(times, c?.n ?? 0);
    if (c) { read++; if (!last || c.last > last) last = c.last; }
  }
  const extra = pages.filter((p) => (cnt.get(p)?.n ?? 0) > times).length;
  return { times, extra, size: pages.length, read, last };
}
const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const dayShort = (d: string) => `${Number(d.slice(8, 10))} ${AY[Number(d.slice(5, 7)) - 1]}`;
/** "2 kez + 12/20", "hiç okunmadı", "12/20" */
export function statText(s: UnitStat, unit = "sayfa"): string {
  if (!s.size) return "";
  if (!s.times && !s.extra) return "hiç okunmadı";
  const parts = [s.times ? `${s.times} kez` : "", s.extra ? `${s.extra}/${s.size}${s.times ? "" : " " + unit}` : ""].filter(Boolean);
  return parts.join(" + ");
}

/** Okunan günler: sayı, en uzun seri */
export function dayStats(rows: SRow[]) {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  let best = 0, run = 0, prev = "";
  for (const d of days) {
    const next = prev ? ymd(new Date(new Date(prev + "T12:00:00").getTime() + 86400000)) : "";
    run = prev && d === next ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { days: days.length, best };
}

/* ── Kur'an: cüzler (kütüphaneden) ve sûreler (sayfa tablosundan) ── */
export type Juz = { id: string; no: number; title: string; pages: number[] };
let JUZ: Juz[] | null = null;
export async function loadJuz(): Promise<Juz[]> {
  if (JUZ) return JUZ;
  const { data: root } = await supabase.from("library_items").select("id").eq("title", "Kur’an-ı Kerim").limit(1).maybeSingle();
  const rid = (root as { id: string } | null)?.id;
  if (!rid) return [];
  const { data } = await supabase.from("library_items").select("id,title,sort_order,metadata").eq("parent_id", rid).gte("sort_order", 1000).order("sort_order");
  JUZ = ((data ?? []) as { id: string; title: string; sort_order: number; metadata: Record<string, unknown> | null }[])
    .filter((c) => c.metadata?.start_page != null)
    .map((c) => {
      const a = Number(c.metadata!.start_page) - 1, b = Number(c.metadata!.end_page) - 1;
      return { id: c.id, no: c.sort_order - 1000, title: c.title, pages: Array.from({ length: b - a + 1 }, (_, i) => a + i) };
    });
  return JUZ;
}
/** sûre → içinde geçtiği sayfalar */
let SURE_PAGES: number[][] | null = null;
export function surePages(): number[][] {
  if (SURE_PAGES) return SURE_PAGES;
  const out: number[][] = Array.from({ length: 114 }, () => []);
  for (let p = 0; pageStart(p); p++) {
    const s = pageStart(p)!, n = pageStart(p + 1);
    const last = n ? (n[1] === 1 ? n[0] - 1 : n[0]) : 114;
    for (let k = s[0]; k <= Math.max(s[0], last); k++) out[k - 1].push(p);
  }
  SURE_PAGES = out;
  return out;
}
export const sureName = (no: number) => SURE_ADLARI[no - 1] ?? `${no}. sûre`;

/* ── Kitaplar ── */
export type BookInfo = {
  key: string; title: string; kind: "kuran" | "numbered" | "sections";
  /** numaralı kitap (Cevşen, Tevhidname): sayfa/bab → belge */
  units?: { page: number; id: string }[];
  /** bölümlü kitap (Sözler…): bölümler sırayla */
  sections?: { id: string; title: string; size: number }[];
  unit: string; size: number;
};
const BOOKS = new Map<string, BookInfo>();
export async function loadBook(key: string, rows: SRow[]): Promise<BookInfo | null> {
  const c = BOOKS.get(key);
  if (c) return c;
  let info: BookInfo | null = null;
  if (key === "kuran") {
    const j = await loadJuz();
    const size = j.length ? Math.max(...j.flatMap((x) => x.pages)) + 1 : 604;
    info = { key, title: "Kur'an-ı Kerim", kind: "kuran", unit: "sayfa", size };
  } else {
    const { data: me } = await supabase.from("library_items").select("id,title").eq("id", key).maybeSingle();
    const title = (me as { title: string } | null)?.title ?? "Kitap";
    const mine = rows.filter((r) => bookKey(r) === key);
    const numbered = mine.length > 0 && mine.every((r) => r.doc_key === key);
    if (numbered) {
      const { data } = await supabase.from("library_items").select("id,metadata").eq("parent_id", key).limit(1000);
      const units = ((data ?? []) as { id: string; metadata: Record<string, unknown> | null }[])
        .filter((x) => x.metadata?.page != null)
        .map((x) => ({ page: Number(x.metadata!.page), id: x.id }))
        .filter((x) => Number.isFinite(x.page))
        .sort((a, b) => a.page - b.page);
      const uniq = units.filter((x, i) => i === 0 || x.page !== units[i - 1].page);
      info = { key, title, kind: "numbered", units: uniq, unit: /cevşen/i.test(title) ? "bab" : "sayfa", size: uniq.length };
    } else {
      const bp = await ensureBookPages(key);
      const order = bp?.order ?? [...new Set(mine.map((r) => r.doc_key))];
      const { data } = order.length ? await supabase.from("library_items").select("id,title").in("id", order) : { data: [] };
      const tt = new Map(((data ?? []) as { id: string; title: string }[]).map((x) => [x.id, x.title]));
      const sections = order.map((id) => ({ id, title: tt.get(id) ?? "Bölüm", size: bp?.docs[id] ?? Math.max(1, ...mine.filter((r) => r.doc_key === id).map((r) => r.page)) }));
      info = { key, title, kind: "sections", sections, unit: "sayfa", size: sections.reduce((a, s) => a + s.size, 0) };
    }
  }
  if (info) BOOKS.set(key, info);
  return info;
}
export const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
/** Kitabın genel durumu (bölümlü kitapta en az okunan bölüme göre) */
export function bookStat(b: BookInfo, rows: SRow[]): UnitStat {
  const mine = rows.filter((r) => bookKey(r) === b.key);
  if (b.kind === "kuran") return unitStat(range(0, b.size - 1), pageCounts(mine));
  if (b.kind === "numbered") return unitStat((b.units ?? []).map((u) => u.page), pageCounts(mine));
  // bölümlü: her bölümün sayfaları ayrı numaralı; kitabın tamamı = bütün bölümlerin sayfaları
  let times = Infinity, extra = 0, read = 0, last: string | null = null;
  const per = (b.sections ?? []).map((s) => unitStat(range(1, s.size), pageCounts(mine.filter((r) => r.doc_key === s.id))));
  for (const s of per) { times = Math.min(times, s.times); read += s.read; if (s.last && (!last || s.last > last)) last = s.last; }
  if (!per.length) times = 0;
  (b.sections ?? []).forEach((s, i) => { const c = pageCounts(mine.filter((r) => r.doc_key === s.id)); extra += range(1, s.size).filter((p) => (c.get(p)?.n ?? 0) > times).length; void per[i]; });
  return { times, extra, size: b.size, read, last };
}
