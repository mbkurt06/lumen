const CACHE_VERSION = "lumen-pwa-v2";
const SHELL_CACHE = CACHE_VERSION + "-shell";
const RUNTIME_CACHE = CACHE_VERSION + "-runtime";

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const response = await fetch("/", { cache: "reload" });
  if (!response.ok) return;

  await cache.put("/", response.clone());

  const html = await response.text();
  const paths = new Set(["/manifest.webmanifest", "/icon.svg"]);

  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (value.startsWith("/_next/static/") || value.startsWith("/_next/image")) {
      paths.add(value);
    }
  }

  await Promise.all(
    Array.from(paths).map(async path => {
      try {
        const asset = await fetch(path, { cache: "reload" });
        if (asset.ok) await cache.put(path, asset);
      } catch {}
    })
  );
}

self.addEventListener("install", event => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => !key.startsWith(CACHE_VERSION)).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put(request, response.clone());
          await cache.put("/", response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request))
          || (await caches.match("/"))
          || Response.error();
      }
    })());
    return;
  }

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/manifest.webmanifest";

  if (isStatic) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async response => {
      if (response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);

    return cached || await network || Response.error();
  })());
});
