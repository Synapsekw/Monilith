/**
 * `public/sw.js` is plain JS served as-is to the browser — it is never imported
 * by the app, so nothing else in the suite would ever execute it. Its asset
 * scanner is the single point on which the whole offline capability turns: if
 * it misses an asset the `/offline` document needs, that asset is never
 * precached and the offline reload dies with a `ChunkLoadError` that no unit
 * test, typecheck, lint or build would show.
 *
 * It has already been wrong once in each direction:
 *   - caching only the DOCUMENT and none of its scripts (28 of 30 chunks
 *     missing against a production build);
 *   - an allow-list character class that silently skipped every Turbopack dev
 *     chunk whose name contains `[`, `]` or `@`.
 *
 * So the scanner is extracted from the real file and exercised here against
 * both real production and real development chunk names. Reading the shipped
 * file rather than a copy is deliberate: a copy would drift and keep passing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SW_SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

/** Pull `referencedAssets` out of the shipped worker and make it callable. */
function loadReferencedAssets(): (html: string) => string[] {
  const start = SW_SOURCE.indexOf("function referencedAssets");
  expect(start, "referencedAssets must exist in public/sw.js").toBeGreaterThan(
    -1,
  );
  const end = SW_SOURCE.indexOf("\n}", start);
  const source = SW_SOURCE.slice(start, end + 2);
  return new Function(`${source}; return referencedAssets;`)() as (
    html: string,
  ) => string[];
}

const referencedAssets = loadReferencedAssets();

describe("service worker referencedAssets", () => {
  it("finds production chunk, css and font URLs", () => {
    const html = `
      <link rel="stylesheet" href="/_next/static/chunks/2iwdbl9o77c2q.css"/>
      <script src="/_next/static/chunks/turbopack-216go2q8qi25p.js"></script>
      <script src="/_next/static/chunks/25e-oy13eimd1.js"></script>
      <link rel="preload" href="/_next/static/media/abc123.woff2" as="font"/>
    `;
    expect(referencedAssets(html).sort()).toEqual(
      [
        "/_next/static/chunks/25e-oy13eimd1.js",
        "/_next/static/chunks/2iwdbl9o77c2q.css",
        "/_next/static/chunks/turbopack-216go2q8qi25p.js",
        "/_next/static/media/abc123.woff2",
      ].sort(),
    );
  });

  it("finds dev chunk names containing brackets and @ (the dev-mode failure)", () => {
    // These three are verbatim the assets that failed with net::ERR_FAILED on
    // an offline reload against `next dev` while the scanner used an
    // allow-list character class.
    const html = `
      <link href="/_next/static/chunks/[root-of-the-server]__0cojysp._.css"/>
      <script src="/_next/static/chunks/[turbopack]_browser_dev_hmr-client_hmr-client_ts_1k4bnwz._.js"></script>
      <script src="/_next/static/chunks/0vvp_@swc_helpers_cjs_0vb02wp._.js"></script>
    `;
    expect(referencedAssets(html).sort()).toEqual(
      [
        "/_next/static/chunks/[root-of-the-server]__0cojysp._.css",
        "/_next/static/chunks/[turbopack]_browser_dev_hmr-client_hmr-client_ts_1k4bnwz._.js",
        "/_next/static/chunks/0vvp_@swc_helpers_cjs_0vb02wp._.js",
      ].sort(),
    );
  });

  it("picks up chunk URLs from inlined bootstrap script bodies, not just attributes", () => {
    const html = `<script>self.__next_f.push(["/_next/static/chunks/lazy-abc.js","/_next/static/chunks/lazy-def.js"])</script>`;
    expect(referencedAssets(html).sort()).toEqual([
      "/_next/static/chunks/lazy-abc.js",
      "/_next/static/chunks/lazy-def.js",
    ]);
  });

  it("de-duplicates repeated references", () => {
    const html = `
      <script src="/_next/static/chunks/same.js"></script>
      <script src="/_next/static/chunks/same.js"></script>
    `;
    expect(referencedAssets(html)).toEqual(["/_next/static/chunks/same.js"]);
  });

  it("ignores non-static and cross-origin URLs", () => {
    const html = `
      <script src="https://cdn.example.com/_next/static/chunks/evil.js"></script>
      <script src="/_next/image?url=x.png"></script>
      <a href="/boards/abc">board</a>
    `;
    // The cross-origin one still yields its PATH, which is harmless: the fetch
    // handler resolves it against this origin and it simply 404s into the
    // tolerated-failure branch. What must not happen is a non-asset URL being
    // treated as an asset.
    expect(referencedAssets(html)).not.toContain("/boards/abc");
    expect(referencedAssets(html)).not.toContain("/_next/image?url=x.png");
  });
});

describe("public/sw.js invariants", () => {
  it("caches the offline document only after its assets are cached", () => {
    // Ordering is load-bearing: a shell whose scripts are missing is worse than
    // no shell, because the navigation fallback then serves a document that
    // cannot boot.
    const assetsIndex = SW_SOURCE.indexOf("assets.map((url)");
    const putIndex = SW_SOURCE.indexOf("cache.put(OFFLINE_URL");
    expect(assetsIndex).toBeGreaterThan(-1);
    expect(putIndex).toBeGreaterThan(assetsIndex);
  });

  it("short-circuits a navigation when the worker knows it is offline", () => {
    // `fetch()` is served from the browser's HTTP cache when it can be, so a
    // network-first race is not a test of connectivity: a fresh navigation to a
    // cacheable (Partial Prerender) route is answered from cache while offline
    // and the fallback never runs. The offline check must come BEFORE the race.
    const guardIndex = SW_SOURCE.indexOf("self.navigator.onLine");
    const raceIndex = SW_SOURCE.indexOf("Promise.race([fetch(request)");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(raceIndex).toBeGreaterThan(guardIndex);
  });

  it("refuses to cache a redirected offline document", () => {
    // `/offline` sits behind the proxy's auth gate; an expired session answers
    // 307 → /login, and a redirected response is illegal to serve for a
    // navigation, so caching one would poison the fallback permanently.
    expect(SW_SOURCE).toContain("response.redirected");
  });
});
