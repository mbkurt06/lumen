import { supabase } from "./supabase";

/* Diyanet Kur'an-ı Kerim Word dosyasındaki yazı tipi (Shaikh Hamdullah Mushaf).
   Eski uygulama bu dosyayı Word'den çıkarıp Supabase'e (quran-assets) koymuştu.
   Bir kez indirilir, cihazda önbellekte tutulur, sonra çevrimdışı da çalışır. */
export const MUSHAF_FONT = "LumenExactMushaf";
const CACHE = "lumen-fonts-v1";
const CACHE_KEY = "/__lumen/mushaf-font.ttf";
let loading: Promise<boolean> | null = null;
let ready = false;

async function fromCache(): Promise<ArrayBuffer | null> {
  try {
    if (!("caches" in window)) return null;
    const c = await caches.open(CACHE);
    const r = await c.match(CACHE_KEY);
    return r ? await r.arrayBuffer() : null;
  } catch { return null; }
}
async function toCache(buf: ArrayBuffer) {
  try {
    if (!("caches" in window)) return;
    const c = await caches.open(CACHE);
    await c.put(CACHE_KEY, new Response(buf, { headers: { "content-type": "font/ttf" } }));
  } catch { /* yok say */ }
}

export function ensureMushafFont(): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    let buf = await fromCache();
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
    const face = new FontFace(MUSHAF_FONT, buf, { style: "normal", weight: "400", display: "block" });
    await face.load();
    document.fonts.add(face);
    ready = true;
    return true;
  })().catch(() => false).finally(() => { loading = null; });
  return loading;
}

export type MRun = { text: string; runStyle?: string; nodeId?: string; marker?: boolean; ayahNo?: number };
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
