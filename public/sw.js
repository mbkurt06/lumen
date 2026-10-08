const CACHE_VERSION = "lumen-pwa-v7";
const SHELL_CACHE = CACHE_VERSION + "-shell";
const RUNTIME_CACHE = CACHE_VERSION + "-runtime";

async function save(cache, request, response) {
  if (!response?.ok || response.type === "opaque") return;
  try { await cache.put(request, response.clone()); } catch (error) {
    console.warn("Offline cache write failed", error);
  }
}

async function warmShell() {
  const cache = await caches.open(SHELL_CACHE);
  const response = await fetch("/", { cache: "reload", credentials: "same-origin" });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    throw new Error("Unable to cache application shell");
  }
  await save(cache, "/", response);
  const html = await response.clone().text();
  const urls = new Set(["/manifest.webmanifest", "/icon.svg"]);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = match[1];
    if (url.startsWith("/_next/static/")) urls.add(url);
  }
  await Promise.all(Array.from(urls).map(async url => {
    try {
      const asset = await fetch(url, { cache:"reload",credentials:"same-origin" });
      await save(cache, url, asset);
    } catch (error) { console.warn("Offline asset warm failed",url,error); }
  }));
}

self.addEventListener("install", event => {
  event.waitUntil(warmShell().catch(error => console.warn("Offline precache unavailable", error))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("lumen-pwa-") &&
      key !== SHELL_CACHE && key !== RUNTIME_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "WARM_OFFLINE") {
    event.waitUntil(warmShell().catch(error => console.warn("Offline warm failed",error)));
  }
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept private APIs, OAuth, Next RSC/Flight responses or requests
  // with authorization headers: they must not be persisted in a public cache.
  if (url.pathname.startsWith("/api/") || url.searchParams.has("_rsc") ||
      request.headers.has("authorization") ||
      request.headers.get("rsc") === "1" ||
      request.headers.get("next-router-prefetch") === "1") return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const fallback = (await caches.match(request)) || (await caches.match("/"));
      // Prefer the cached shell for offline navigations instead of waiting for a
      // stalled network request (Safari can take a long time to fail).
      if (self.navigator.onLine === false && fallback) return fallback;
      try {
        const response = await Promise.race([
          fetch(request),
          new Promise((_, reject) => setTimeout(() => reject(new Error("navigation timeout")), 3000))
        ]);
        if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
          return response;
        }
        const cache = await caches.open(RUNTIME_CACHE);
        await save(cache, request, response);
        // Root page is the only safe source for our offline app shell.
        if(url.pathname === "/") await save(cache, "/", response);
        return response;
      } catch {
        return (await caches.match(request)) || fallback ||
          new Response("Offline içerik henüz indirilmedi.",{status:503,headers:{"content-type":"text/plain; charset=utf-8"}});
      }
    })());
    return;
  }

  const isStatic = url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.svg" || url.pathname === "/manifest.webmanifest";
  if (!isStatic) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      const cache = await caches.open(RUNTIME_CACHE);
      await save(cache, request, response);
      return response;
    } catch {
      return Response.error();
    }
  })());
});
