/* Lumen service worker: uygulama kabuğunu (sayfa, kod, simgeler) cihazda tutar; internetsiz açılır.
   Veriler (kitaplar vb.) sayfa içindeki offlineFetch ile ayrıca saklanır. */
const SHELL = "lumen-shell-v3";
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

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("lumen-shell-") && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

/* Sayfanın yeni hâlini al; kullandığı dosyaları da önceden indir, sonra kaydet
   (böylece bir sonraki açılış internetsiz olsa bile eksik dosya kalmaz). */
async function refreshShell(req) {
  const res = await fetch(req, { cache: "no-store" });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || res.redirected || !type.includes("text/html")) return res;
  const html = await res.clone().text();
  const c = await caches.open(SHELL);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const missing = [];
  for (const a of assets) if (!(await c.match(a))) missing.push(a);
  if (missing.length) await c.addAll(missing);
  await c.put("/index.html", new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname === "/version.json" || u.pathname === "/sw.js") return;

  // sayfa açılışı: önce cihazdaki sayfa (anında açılır, internet yok uyarısı çıkmaz);
  // yeni sürüm arka planda alınır ve bir sonraki açılışta gelir
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cached = (await caches.match("/index.html")) || (await caches.match("/"));
      // internet yokken ağa hiç gidilmez (iPhone her denemede uyarı gösteriyor)
      const update = self.navigator.onLine === false && cached ? Promise.resolve(null) : refreshShell(req);
      if (cached) { e.waitUntil(update.catch(() => {})); return cached; }
      return (await update.catch(() => null)) || Response.error();
    })());
    return;
  }
  // derlenmiş dosyalar ve simgeler: önce cihaz
  if (u.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest|woff2?|ttf)$/.test(u.pathname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (self.navigator.onLine === false) return Response.error();
      const res = await fetch(req);
      if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
      return res;
    })());
  }
});
