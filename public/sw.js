// Monolith offline service worker.
//
// TWO rules, both load-bearing:
//   1. Only content-hashed assets are cache-first. `/_next/static/**` filenames
//      change whenever their contents change, so a stale entry is impossible.
//   2. NO real HTML document is ever cached. Caching a document cache-first is
//      how a service worker pins users to a dead build. The single exception is
//      `/offline`, which is a static client-only shell with no user data in it.
const CACHE = "monolith-offline-v1";
const OFFLINE_URL = "/offline";
const NAV_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Content-hashed build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((res) => {
          const copy = res.clone();
          // The browser can suspend this worker the instant respondWith's
          // promise settles, so the cache write must be handed to
          // waitUntil — otherwise a freshly fetched asset can be dropped
          // before it's ever cached, silently defeating cache-first.
          event.waitUntil(caches.open(CACHE).then((c) => c.put(request, copy)));
          return res;
        });
      }),
    );
    return;
  }

  // Navigations: network-first with a short timeout, falling back to the
  // offline shell. Never cache the real document.
  if (request.mode === "navigate") {
    event.respondWith(
      Promise.race([fetch(request), timeout(NAV_TIMEOUT_MS)]).catch(() =>
        caches.match(OFFLINE_URL).then((hit) => hit || Response.error()),
      ),
    );
  }
});
