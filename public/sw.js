// Service worker : app utilisable hors connexion (collection + dernières données téléchargées).
const V = "pkcol-v3";
const IMG = "pkcol-img", LIB = "pkcol-lib";
const SHELL = ["./", "index.html", "style.css?v=3", "app.js?v=3", "manifest.webmanifest", "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![V, IMG, LIB].includes(k)).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Interface et données : réseau d'abord, en forçant la revalidation (GitHub Pages met en cache 10 min)
const networkFirst = async (req) => {
  const c = await caches.open(V);
  try { const r = await fetch(req.url, { cache: "no-cache", credentials: "same-origin" }); if (r.ok) c.put(req, r.clone()); return r; }
  catch { return (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await c.match("./") : null) || Response.error(); }
};
// Images, polices, OCR : cache d'abord
const cacheFirst = async (req, cache) => {
  const c = await caches.open(cache), hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req); if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r;
};

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.hostname === "assets.tcgdex.net") return e.respondWith(cacheFirst(e.request, IMG));
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") return e.respondWith(cacheFirst(e.request, V));
  if (u.hostname === "cdn.jsdelivr.net" || u.hostname === "tessdata.projectnaptha.com") return e.respondWith(cacheFirst(e.request, LIB));
  if (u.origin !== location.origin) return;
  if (u.pathname.includes("/data/history/") && !u.pathname.endsWith("index.json")) return e.respondWith(cacheFirst(e.request, V));
  return e.respondWith(networkFirst(e.request));
});
