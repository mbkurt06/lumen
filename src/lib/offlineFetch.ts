/* Çevrimdışı okuma: Supabase'ten gelen okuma (GET) yanıtları cihazda saklanır.
   - Kitap içerikleri (library_items, content_nodes, quran_mushaf_pages): önce cihazdaki kayıt
     anında verilir, güncel hâli arka planda alınıp kayda yazılır (internet yokken bekleme olmaz).
   - Kişisel veriler (görevler, ayraçlar, sayaçlar…): önce ağ (kısa süre sınırıyla), olmazsa kayıt.
   - Ağa ulaşılamazsa bir süre "çevrimdışı" sayılır ve ağ hiç denenmez (uçak modunda bile
     telefon bazen "çevrimiçi" der; her istekte beklememek için).
   Yazma istekleri (kaydetme, silme) olduğu gibi ağa gider. */
const CACHE = "lumen-data-v1";
const CONTENT_TABLES = ["/rest/v1/library_items", "/rest/v1/content_nodes", "/rest/v1/quran_mushaf_pages"];
const NET_TIMEOUT_MS = 3500;
const AUTH_TIMEOUT_MS = 4000;
const DOWN_FOR_MS = 20000;

let downUntil = 0;
let forceNetwork = 0; // indirme sırasında içerikler de ağdan (güncel hâli) alınır
export function setForceNetwork(on: boolean) { forceNetwork += on ? 1 : -1; if (forceNetwork < 0) forceNetwork = 0; }
const markDown = () => { downUntil = Date.now() + DOWN_FOR_MS; };
const markUp = () => { downUntil = 0; };
if (typeof window !== "undefined") {
  window.addEventListener("online", markUp);
  window.addEventListener("offline", markDown);
}
export const looksOffline = () => (typeof navigator !== "undefined" && navigator.onLine === false) || Date.now() < downUntil;

const keyOf = (req: Request) => {
  const u = new URL(req.url);
  u.searchParams.set("__acc", req.headers.get("accept") ?? "");
  return u.toString();
};
const hasCaches = () => typeof caches !== "undefined";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

async function fromCache(key: string): Promise<Response | null> {
  try { return (await (await caches.open(CACHE)).match(key)) ?? null; } catch { return null; }
}
async function toCache(key: string, res: Response) {
  try { await (await caches.open(CACHE)).put(key, res); } catch { /* yer yoksa yok say */ }
}
async function network(req: Request, key: string, ms: number): Promise<Response> {
  const res = await withTimeout(fetch(req), ms);
  markUp();
  if (res.ok) await toCache(key, res.clone());
  return res;
}

export const offlineFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);

  // Oturum (auth) istekleri: internet yokken uzun beklemesin
  if (req.url.includes("/auth/v1/")) {
    if (looksOffline()) throw new TypeError("offline");
    try { const r = await withTimeout(fetch(req), AUTH_TIMEOUT_MS); markUp(); return r; }
    catch (e) { markDown(); throw e; }
  }

  const cacheable = req.method === "GET" && req.url.includes("/rest/v1/") && hasCaches();
  if (!cacheable) {
    if (looksOffline() && req.url.includes("/rest/v1/")) throw new TypeError("offline");
    return fetch(req);
  }
  const key = keyOf(req);
  const isContent = CONTENT_TABLES.some((t) => req.url.includes(t));

  if (isContent && !forceNetwork) {
    const hit = await fromCache(key);
    if (hit) {
      if (!looksOffline()) void network(req.clone(), key, 15000).catch(markDown); // arka planda tazele
      return hit;
    }
    if (looksOffline()) throw new TypeError("offline");
    try { return await network(req, key, 15000); } catch (e) { markDown(); throw e; }
  }

  // kişisel veriler (ve indirme sırasında içerik): önce ağ, olmazsa kayıt
  if (!looksOffline() || forceNetwork) {
    try { return await network(req, key, forceNetwork ? 20000 : NET_TIMEOUT_MS); }
    catch { markDown(); }
  }
  const hit = await fromCache(key);
  if (hit) return hit;
  throw new TypeError("offline");
};

/** Çevrimdışı verileri sil (ör. çıkış yaparken). */
export async function clearOfflineData() {
  try { await caches.delete(CACHE); } catch { /* yok say */ }
}

