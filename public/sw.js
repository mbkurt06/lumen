const CACHE_VERSION = "lumen-pwa-v4";
const SHELL_CACHE = CACHE_VERSION + "-shell";
const RUNTIME_CACHE = CACHE_VERSION + "-runtime";

async function cacheResponse(cache, request, response) {
  if (!response || !response.ok) return;
  try { await cache.put(request, response.clone()); } catch {}
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  let response;
  try {
    response = await fetch("/", { cache: "reload", credentials: "include" });
  } catch {
    return;
  }
  if (!response.ok) return;

  await cacheResponse(cache, "/", response);

  const html = await response.clone().text();
  const paths = new Set([
    "/",
    "/manifest.webmanifest",
    "/icon.svg",
  ]);

  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (
      value.startsWith("/_next/static/") ||
      value.startsWith("/_next/image") ||
      value === "/manifest.webmanifest" ||
      value === "/icon.svg"
    ) {
      paths.add(value);
    }
  }

  await Promise.all(
    Array.from(paths).map(async path => {
      try {
        const asset = await fetch(path, {
          cache: "reload",
          credentials: "include",
        });
        await cacheResponse(cache, path, asset);
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
        keys
          .filter(key => !key.startsWith(CACHE_VERSION))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "WARM_OFFLINE") {
    event.waitUntil(precacheShell());
  }
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const shell = await caches.match("/");
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cacheResponse(cache, request, response);
          await cacheResponse(cache, "/", response);
        }
        return response;
      } catch {
        return (await caches.match(request)) || shell || Response.error();
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

      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cacheResponse(cache, request, response);
        }
        return response;
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      // Refresh silently when online, but never block offline use.
      event.waitUntil(
        fetch(request)
          .then(async response => {
            if (response.ok) {
              const cache = await caches.open(RUNTIME_CACHE);
              await cacheResponse(cache, request, response);
            }
          })
          .catch(() => {})
      );
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cacheResponse(cache, request, response);
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});
