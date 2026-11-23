import { supabase } from "./supabase";

/* Diyanet Kur'an-ı Kerim Word dosyasındaki yazı tipi (Shaikh Hamdullah Mushaf).
   Eski uygulama bu dosyayı Word'den çıkarıp Supabase'e (quran-assets) koymuştu.
   Bir kez indirilir, cihazda önbellekte tutulur, sonra çevrimdışı da çalışır. */
export const MUSHAF_FONT = "LumenExactMushaf";
const CACHE = "lumen-fonts-v1";
const CACHE_KEY = "/__lumen/mushaf-font.ttf";
const CACHE_KEY_V3 = "/__lumen/mushaf-font-v3.ttf"; // yamalı (tenvin + tı durağı harekeye göre); v2 eski yama, artık kullanılmaz
let loading: Promise<boolean> | null = null;
let ready = false;

async function fromCache(key = CACHE_KEY): Promise<ArrayBuffer | null> {
  try {
    if (!("caches" in window)) return null;
    const c = await caches.open(CACHE);
    const r = await c.match(key);
    return r ? await r.arrayBuffer() : null;
  } catch { return null; }
}
async function toCache(buf: ArrayBuffer, key = CACHE_KEY) {
  try {
    if (!("caches" in window)) return;
    const c = await caches.open(CACHE);
    await c.put(key, new Response(buf, { headers: { "content-type": "font/ttf" } }));
  } catch { /* yok say */ }
}

const sha256 = async (b: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b))).map((x) => x.toString(16).padStart(2, "0")).join("");
/** Orijinal fonta Lumen yamasını uygular; orijinal beklenen dosya değilse olduğu gibi bırakır. */
async function patchFont(buf: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const { MUSHAF_FONT_PATCH: p } = await import("./mushafFontPatch");
    if ((await sha256(buf)) !== p.src) return null;
    const a = new Uint8Array(buf), out = new Uint8Array(p.len);
    let o = 0;
    for (const op of p.ops) {
      if (op[0] === "c") { out.set(a.subarray(op[1], op[1] + op[2]), o); o += op[2]; }
      else { const bin = atob(op[1]); for (let i = 0; i < bin.length; i++) out[o++] = bin.charCodeAt(i); }
    }
    return (await sha256(out.buffer)) === p.dst ? out.buffer : null;
  } catch { return null; }
}

export function ensureMushafFont(): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    let buf = await fromCache(CACHE_KEY_V3);
    if (!buf) buf = await fromCache(); // orijinal (yama buna uygulanır)
    if (!buf) {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase.storage.from("quran-assets").download(`${uid}/mushaf/shaikh-hamdullah-mushaf.ttf`);
      if (error || !data) return false;
      buf = await data.arrayBuffer();
      if (!buf.byteLength) return false;
      void toCache(buf.slice(0));
    }
    // yamalı sürüm yoksa orijinalden üret ve sakla
    if (!(await fromCache(CACHE_KEY_V3))) {
      const patched = await patchFont(buf);
      if (patched) { buf = patched; void toCache(patched.slice(0), CACHE_KEY_V3); }
    }
    const face = new FontFace(MUSHAF_FONT, buf, { style: "normal", weight: "400", display: "block" });
    await face.load();
    document.fonts.add(face);
    ready = true;
    return true;
  })().catch(() => false).finally(() => { loading = null; });
  return loading;
}

export type MRun = { text: string; runStyle?: string; nodeId?: string; marker?: boolean; ayahNo?: number; surahNo?: number };
export type MPage = { display_page: number; juz: number | null; surah_numbers: number[] | null; rich_content: { paragraphs: { style: string; runs: MRun[] }[] } };

/** Word sayfa aralığındaki mushaf sayfaları (Word sayfası = gösterilen sayfa + 1). */
export async function loadMushafPages(startWordPage: number, endWordPage: number): Promise<MPage[]> {
  const { data } = await supabase
    .from("quran_mushaf_pages")
    .select("display_page,juz,surah_numbers,rich_content")
    .gte("word_page", startWordPage)
    .lte("word_page", endWordPage)
    .order("word_page");
  return (data ?? []) as MPage[];
}
