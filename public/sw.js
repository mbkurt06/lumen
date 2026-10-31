/* Lumen service worker: uygulama kabuğunu (sayfa, kod, simgeler) cihazda tutar; internetsiz açılır.
   Veriler (kitaplar vb.) sayfa içindeki offlineFetch ile ayrıca saklanır. */
const SHELL = "lumen-shell-v1";
const CORE = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(CORE).catch(() => {});
    // index.html'in kullandığı derlenmiş dosyaları da al
    try {
      const html = await (await fetch("/index.html", { cache: "no-store" })).text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await c.addAll(assets);
    } catch { /* yok say */ }
  })());
});

self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname === "/version.json" || u.pathname === "/sw.js") return;

  // sayfa açılışı: önce ağ, olmazsa kayıtlı sayfa
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(SHELL);
        c.put("/index.html", res.clone());
        return res;
      } catch {
        return (await caches.match("/index.html")) || (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }
  // derlenmiş dosyalar ve simgeler: önce cihaz
  if (u.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest|woff2?|ttf)$/.test(u.pathname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
      return res;
    })());
  }
});
