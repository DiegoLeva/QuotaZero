const TILE_CACHE = "quotazero-tiles-v1";

const TILE_HOST_PATTERNS = [
  /\.google\.com$/,
  /\.tiles\.virtualearth\.net$/,
  /^wms\.pcn\.minambiente\.it$/,
  /^wms\.cartografia\.agenziaentrate\.gov\.it$/,
  /^geoportale\.regione\.lazio\.it$/
];

function isTileRequest(url) {
  return TILE_HOST_PATTERNS.some(rx => rx.test(url.hostname));
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  let url;
  try { url = new URL(event.request.url); } catch (e) { return; }
  if (!isTileRequest(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(TILE_CACHE);
    const cached = await cache.match(event.request, { ignoreVary: true });
    if (cached) return cached;
    try {
      return await fetch(event.request);
    } catch (e) {
      return new Response("", { status: 504, statusText: "Offline (tile non in cache)" });
    }
  })());
});
