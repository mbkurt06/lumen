/* Çevrimdışı okuma: Supabase'ten gelen okuma (GET) yanıtları cihazda saklanır.
   - Kitap içerikleri (library_items, content_nodes, quran_mushaf_pages): önce cihazdaki kayıt
     anında verilir, güncel hâli arka planda alınıp kayda yazılır (internet yokken bekleme olmaz).
   - Kişisel veriler (görevler, ayraçlar, sayaçlar…): önce ağ (kısa süre sınırıyla), olmazsa kayıt.
   - Ağa ulaşılamazsa bir süre "çevrimdışı" sayılır ve ağ hiç denenmez (uçak modunda bile
     telefon bazen "çevrimiçi" der; her istekte beklememek için).
   Yazma istekleri (kaydetme, silme) olduğu gibi ağa gider. */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";
import { enqueue, fakeResponse, flushWrites, overlay, pendingWrites, prepare, tableOf } from "./writeQueue";
const CACHE = "lumen-data-v1";
const CONTENT_TABLES = ["/rest/v1/library_items", "/rest/v1/content_nodes", "/rest/v1/quran_mushaf_pages"];
const NET_TIMEOUT_MS = 3500;
const AUTH_TIMEOUT_MS = 4000;
const DOWN_FOR_MS = 20000;
const QUICK_MS = 1200; // kişisel veride ağ bu kadar gecikirse cihazdaki kayıt gösterilir

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

/* Tanılama: son isteklerin nereden geldiği ve süresi (Ayarlar › Çevrimdışı'da görünür) */
export type NetLog = { t: number; path: string; how: string; ms: number };
export const netLog: NetLog[] = [];
function log(url: string, how: string, start: number) {
  const u = new URL(url);
  netLog.unshift({ t: Date.now(), path: u.pathname.replace("/rest/v1/", "").replace("/auth/v1/", "auth/"), how, ms: Math.round(performance.now() - start) });
  if (netLog.length > 60) netLog.length = 60;
}
export async function cacheInfo() {
  if (!hasCaches()) return { caches: false, entries: 0 };
  try { const keys = await (await caches.open(CACHE)).keys(); return { caches: true, entries: keys.length }; } catch { return { caches: true, entries: -1 }; }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

async function fromCache(key: string): Promise<Response | null> {
  try { return (await (await caches.open(CACHE)).match(key)) ?? null; } catch { return null; }
}
async function toCache(key: string, res: Response) {
  try {
    // ne zaman alındığı işaretlenir: içerikler günde en fazla bir kez arka planda tazelenir (veri kotası)
    const h = new Headers(res.headers); h.set("x-lumen-at", String(Date.now()));
    await (await caches.open(CACHE)).put(key, new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: h }));
  } catch { /* yer yoksa yok say */ }
}
const REVALIDATE_MS = 24 * 3600 * 1000;
const isStale = (r: Response) => { const at = Number(r.headers.get("x-lumen-at") ?? 0); return !at || Date.now() - at > REVALIDATE_MS; };
/** Yazma oldu (görev, okuma…): o tablodan okuyan sayfalar listeyi yeniden çeksin */
function noteWrite(url: string) {
  const m = /\/rest\/v1\/([a-z_]+)/.exec(url);
  if (m && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lumen-write", { detail: m[1] }));
}
async function network(req: Request, key: string, ms: number): Promise<Response> {
  const res = await withTimeout(fetch(req), ms);
  markUp();
  if (res.ok) await toCache(key, res.clone());
  return res;
}

export const offlineFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  const t0 = performance.now();

  // Oturum (auth) istekleri: internet yokken uzun beklemesin
  if (req.url.includes("/auth/v1/")) {
    if (looksOffline()) { log(req.url, "auth-atla", t0); throw new TypeError("offline"); }
    try { const r = await withTimeout(fetch(req), AUTH_TIMEOUT_MS); markUp(); log(req.url, "auth-ağ", t0); return r; }
    catch (e) { markDown(); log(req.url, "auth-hata", t0); throw e; }
  }

  if (req.method !== "GET" && req.method !== "HEAD" && req.url.includes("/rest/v1/")) noteWrite(req.url);
  // yazma (görev, ayraç, not…): internet yoksa ya da ağ cevap vermezse sıraya alınır
  const wt = req.method !== "GET" && req.method !== "HEAD" ? tableOf(req.url) : null;
  if (wt) {
    const it = await prepare(req, wt);
    if (!looksOffline() && !pendingWrites()) {
      try {
        const r = await withTimeout(fetch(it.url, { method: it.method, headers: req.headers, body: it.body ?? undefined }), 8000);
        markUp(); log(req.url, "yaz-ağ", t0); return r;
      } catch { markDown(); }
    }
    enqueue(it);
    log(req.url, "yaz-sıra", t0);
    void syncWrites();
    return fakeResponse(it);
  }

  const cacheable = req.method === "GET" && req.url.includes("/rest/v1/") && hasCaches();
  if (!cacheable) {
    // internet yokken hiç denenmez (iPhone her denemede "Uçak Modu'nu kapatın" uyarısı çıkarıyor)
    if (looksOffline()) { log(req.url, "atla", t0); throw new TypeError("offline"); }
    return fetch(req);
  }
  const key = keyOf(req);
  const isContent = CONTENT_TABLES.some((t) => req.url.includes(t));
  if (isContent) rememberHeaders(req);

  if (isContent && !forceNetwork) {
    const hit = await fromCache(key);
    if (hit) {
      if (!looksOffline() && isStale(hit)) void network(req.clone(), key, 15000).catch(markDown); // günde en fazla bir kez arka planda tazele
      log(req.url, "cihaz", t0);
      return hit;
    }
    if (looksOffline()) { log(req.url, "cihazda-yok", t0); throw new TypeError("offline"); }
    try { const r = await network(req, key, 15000); log(req.url, "ağ", t0); return r; } catch (e) { markDown(); log(req.url, "ağ-hata", t0); throw e; }
  }

  // kişisel veriler (ve indirme sırasında içerik): önce ağ, olmazsa kayıt
  const rt = tableOf(req.url);
  const ov = (r: Response) => (rt ? overlay(req, r, rt) : r);
  if (!looksOffline() || forceNetwork) {
    const net = network(req, key, forceNetwork ? 20000 : NET_TIMEOUT_MS);
    // bağlantı yavaşsa/takılıysa bekletme: cihazdaki kayıt varsa kısa süre sonra onu göster, ağ arkada tamamlanır
    const cached = forceNetwork ? null : await fromCache(key);
    if (cached) {
      const quick = await Promise.race([net.then((r) => r, () => null), new Promise<null>((ok) => setTimeout(() => ok(null), QUICK_MS))]);
      if (quick) { log(req.url, "ağ", t0); return ov(quick); }
      void net.catch(markDown);
      log(req.url, "cihaz-hızlı", t0);
      return ov(cached);
    }
    try { const r = await net; log(req.url, "ağ", t0); return ov(r); }
    catch { markDown(); }
  }
  const hit = await fromCache(key);
  if (hit) { log(req.url, "cihaz", t0); return ov(hit); }
  log(req.url, "cihazda-yok", t0);
  throw new TypeError("offline");
};

/* ── Sırada bekleyen kayıtları gönder ── */
export async function syncWrites() {
  if (looksOffline() || !pendingWrites()) return;
  await flushWrites(async (url, init) => {
    try { const r = await withTimeout(fetch(url, init), 15000); markUp(); return r; } catch (e) { markDown(); throw e; }
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { setTimeout(() => void syncWrites(), 1500); });
  setTimeout(() => void syncWrites(), 4000);
  setInterval(() => void syncWrites(), 45000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncWrites(); });
}

/* ── Yenile: cihazdaki kitap içeriklerini veri tabanındaki güncel hâliyle değiştirir ── */
let lastHeaders: Record<string, string> | null = null;
function rememberHeaders(req: Request) {
  const h: Record<string, string> = {};
  for (const k of ["apikey", "authorization", "accept-profile", "x-client-info"]) { const v = req.headers.get(k); if (v) h[k] = v; }
  if (h.apikey) lastHeaders = h;
}
function fallbackHeaders(): Record<string, string> {
  let tok = SUPABASE_PUBLISHABLE_KEY;
  try {
    const raw = localStorage.getItem(`sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`);
    const t = raw ? (JSON.parse(raw) as { access_token?: string }).access_token : undefined;
    if (t) tok = t;
  } catch { /* yok */ }
  return { apikey: SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${tok}` };
}
export type RefreshProgress = { done: number; total: number; failed: number };
/** Cihazda kayıtlı içerik yanıtlarını ağdan yeniden alır. `match` verilirse yalnız adresinde
    bu kimliklerden biri geçenler (bir kitap) yenilenir; verilmezse bütün kütüphane. */
export async function refreshContent(match?: string[], onProgress?: (p: RefreshProgress) => void): Promise<RefreshProgress> {
  const p: RefreshProgress = { done: 0, total: 0, failed: 0 };
  if (!hasCaches()) return p;
  const headers = { ...(lastHeaders ?? fallbackHeaders()) };
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new TypeError("offline");
  markUp();
  const cache = await caches.open(CACHE);
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const ids = new Set((match ?? []).filter((m) => /^[0-9a-f-]{36}$/i.test(m)).map((m) => m.toLowerCase()));
  const subs = (match ?? []).filter((m) => !/^[0-9a-f-]{36}$/i.test(m));
  const hit = (u: string) => !match || subs.some((x) => u.includes(x)) || (decodeURIComponent(u).match(UUID) ?? []).some((x) => ids.has(x.toLowerCase()));
  const keys = (await cache.keys()).map((r) => r.url).filter((u) => CONTENT_TABLES.some((t) => u.includes(t)) && hit(u));
  p.total = keys.length; onProgress?.({ ...p });
  let i = 0;
  const run = async () => {
    while (i < keys.length) {
      const key = keys[i++];
      try {
        const u = new URL(key);
        const acc = u.searchParams.get("__acc") ?? "";
        u.searchParams.delete("__acc");
        const res = await withTimeout(fetch(u.toString(), { headers: { ...headers, ...(acc ? { accept: acc } : {}) }, cache: "no-store" }), 20000);
        if (res.ok) await cache.put(key, res); else p.failed++;
      } catch { p.failed++; }
      p.done++; onProgress?.({ ...p });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, keys.length) }, run));
  return p;
}

/** Çevrimdışı verileri sil (ör. çıkış yaparken). */
export async function clearOfflineData() {
  try { await caches.delete(CACHE); } catch { /* yok say */ }
}

