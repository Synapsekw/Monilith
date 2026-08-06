// Monolith offline service worker.
//
// THREE rules, all load-bearing:
//   1. Only content-hashed assets are cache-first. `/_next/static/**` filenames
//      change whenever their contents change, so a stale entry is impossible.
//   2. NO real HTML document is ever cached. Caching a document cache-first is
//      how a service worker pins users to a dead build. The single exception is
//      `/offline`, which is a static client-only shell with no user data in it.
//   3. Caching the `/offline` DOCUMENT is not enough — its JavaScript must be
//      cached with it, atomically. See `syncOfflineShell` below; this was the
//      root cause of the feature not working at all.
const CACHE_PREFIX = "monolith-offline";
const CACHE = `${CACHE_PREFIX}-v2`;
const OFFLINE_URL = "/offline";
const NAV_TIMEOUT_MS = 3000;
const STATIC_PREFIX = "/_next/static/";

/**
 * Every same-origin build asset the offline document depends on.
 *
 * WHY THIS EXISTS. `cache.add('/offline')` stores one HTML document and
 * nothing else. The document's `<script>`s are separate requests, and the
 * cache-first rule below only ever populates `/_next/static/**` for assets
 * that were actually requested while online. `/offline` is never visited while
 * online — that is the whole point of it — so its chunks were never fetched,
 * never cached, and the offline reload could only work when Chrome's HTTP disk
 * cache happened to still hold them. Measured on a production build: 28 of the
 * document's 30 script chunks were absent from the cache, and a reload with a
 * cold HTTP cache died with
 * `ChunkLoadError: Failed to load chunk /_next/static/chunks/25e-oy13eimd1.js`.
 * That is the "sometimes it works, sometimes ChunkLoadError" report.
 *
 * Matches both the `src`/`href` attributes and the chunk lists Turbopack
 * inlines into its bootstrap script, so lazily-referenced chunks named in the
 * document are picked up too.
 *
 * The character class is a DENY list (anything that is not a URL delimiter)
 * rather than an allow list of `[A-Za-z0-9._-]`. Turbopack chunk filenames are
 * not limited to those characters: a dev build emits names like
 * `[root-of-the-server]__0cojysp._.css`,
 * `[turbopack]_browser_dev_hmr-client_hmr-client_ts_1k4bnwz._.js` and
 * `0vvp_@swc_helpers_cjs_0vb02wp._.js`. An allow-list class skips exactly those
 * — silently, since a regex that matches nothing looks identical to a document
 * that references nothing — and the offline reload then dies on the chunks that
 * were never precached. That was the whole of the dev-mode failure.
 */
function referencedAssets(html) {
  const found = new Set();
  const re = /\/_next\/static\/[^"'\s<>\\)(]+?\.(?:js|css|woff2|woff|ttf|otf)/g;
  for (const match of html.matchAll(re)) found.add(match[0]);
  return [...found];
}

/**
 * Fetch `/offline` and cache it TOGETHER with every asset it references.
 *
 * `force` is used at install (bypass the HTTP cache so a fresh deploy's shell
 * is captured); the periodic refresh omits it so the steady-state cost is one
 * conditional request that usually 304s and downloads nothing.
 *
 * A redirected response is refused rather than cached. `/offline` is behind the
 * proxy's auth gate, so an expired session answers 307 → /login; a redirected
 * response also cannot legally be served for a navigation request, so caching
 * one would poison the fallback permanently.
 */
async function syncOfflineShell({ force }) {
  const cache = await caches.open(CACHE);
  const response = await fetch(OFFLINE_URL, {
    credentials: "same-origin",
    ...(force ? { cache: "reload" } : {}),
  });

  if (!response.ok || response.redirected) {
    throw new Error(
      `offline shell unavailable (status ${response.status}, redirected ${response.redirected})`,
    );
  }

  const html = await response.clone().text();
  const assets = referencedAssets(html);

  // The document goes in only after its assets are in, so the cache never
  // holds a shell whose scripts are missing.
  await Promise.all(
    assets.map((url) =>
      cache
        .add(new Request(url, force ? { cache: "reload" } : undefined))
        .catch(() => {
          // One un-cacheable asset must not cost the whole offline capability;
          // the shell degrades rather than disappearing.
        }),
    ),
  );
  await cache.put(OFFLINE_URL, response);

  return assets;
}

/**
 * Drop `/_next/static/**` entries the current shell no longer references.
 *
 * Without this the cache grows without bound: `CACHE` is a fixed literal and
 * `activate` only prunes OTHER cache stores, so every deploy's chunks would
 * accumulate in the same store forever.
 */
async function pruneStaleAssets(keep) {
  const cache = await caches.open(CACHE);
  const keepSet = new Set(keep);
  const entries = await cache.keys();
  await Promise.all(
    entries.map((request) => {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith(STATIC_PREFIX) || keepSet.has(pathname)) return;
      return cache.delete(request);
    }),
  );
}

self.addEventListener("install", (event) => {
  // Install FAILS if the shell cannot be captured. Activating a worker whose
  // fallback document is missing would leave every failed navigation with a
  // browser error page and no way to notice; a failed install is retried on the
  // next page load instead.
  event.waitUntil(syncOfflineShell({ force: true }));
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

/**
 * Re-capture the shell once per worker lifetime, on a navigation we know
 * succeeded (i.e. we are online).
 *
 * A deploy changes every chunk hash, but `sw.js` itself is usually
 * byte-identical — and a byte-identical worker is never reinstalled. So an
 * install-time-only precache silently rots: the cached shell would keep naming
 * chunks that no longer exist on the server and were never cached. Refreshing
 * from a live navigation is what makes offline survive the next deploy.
 */
let refreshStarted = false;
function refreshShellOnce() {
  if (refreshStarted) return Promise.resolve();
  refreshStarted = true;
  return syncOfflineShell({ force: false })
    .then((assets) => pruneStaleAssets(assets))
    .catch(() => {
      // Offline capability degrades to the previously cached shell.
    });
}

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
  if (url.pathname.startsWith(STATIC_PREFIX)) {
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
      Promise.race([fetch(request), timeout(NAV_TIMEOUT_MS)])
        .then((res) => {
          // We reached the network, so this is the moment to make sure the
          // offline shell matches the build now being served.
          event.waitUntil(refreshShellOnce());
          return res;
        })
        .catch(() =>
          caches.match(OFFLINE_URL).then((hit) => hit || Response.error()),
        ),
    );
  }
});
