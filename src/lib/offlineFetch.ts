/* Çevrimdışı okuma: Supabase'ten gelen her okuma (GET) yanıtı cihazda saklanır.
   İnternet yoksa ya da yanıt gecikirse aynı isteğin kayıtlı yanıtı verilir.
   Yazma istekleri (kaydetme, silme) olduğu gibi ağa gider. */
const CACHE = "lumen-data-v1";
const TIMEOUT_MS = 10000;

const keyOf = (req: Request) => {
  const u = new URL(req.url);
  u.searchParams.set("__acc", req.headers.get("accept") ?? "");
  return u.toString();
};
const hasCaches = () => typeof caches !== "undefined";

export const offlineFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  const cacheable = req.method === "GET" && req.url.includes("/rest/v1/") && hasCaches();
  if (!cacheable) return fetch(req);
  const key = keyOf(req);
  const fromCache = async () => { try { return (await (await caches.open(CACHE)).match(key)) ?? null; } catch { return null; } };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const hit = await fromCache();
    if (hit) return hit;
  }
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
    ]);
    if (res.ok) { try { await (await caches.open(CACHE)).put(key, res.clone()); } catch { /* yer yoksa yok say */ } }
    return res;
  } catch (e) {
    const hit = await fromCache();
    if (hit) return hit;
    throw e;
  }
};

/** Çevrimdışı verileri sil (ör. çıkış yaparken). */
export async function clearOfflineData() {
  try { await caches.delete(CACHE); } catch { /* yok say */ }
}
