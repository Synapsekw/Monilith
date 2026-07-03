# PWA Installable Shell — Design Spec

**Date:** 2026-07-03
**Status:** Approved (brainstorming) — ready for implementation plan
**Scope owner:** Danijel Jovanovic
**Parent program:** iPad Touch Optimization (`docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md`), which deferred "PWA / installable / offline" and scoped any future PWA work to a **pure responsive web / minimal installable shell — NOT offline data sync**.

## Goal

Make Monolith **installable** — add-to-home-screen on iPad/iOS and "Install app" on
Chromium (Chrome/Edge) — so it opens in a standalone, chrome-less window with a proper
name, icon, splash, and theme color. This is the **installable-shell** slice only.

## Non-goals (explicitly out of scope)

- **Offline / data sync / caching.** No runtime caching of pages or API responses, no
  background sync, no "works on a plane." This is the line the parent spec drew.
- **A service worker for offline.** See "Key decision: no service worker" below — a SW is
  not required for a minimal installable shell on current browsers and its only value here
  would be offline, which is out of scope.
- **Push notifications / periodic sync / share target / shortcuts.** YAGNI for the shell.
- **New icon art / a design pass on the mark.** The existing cleaved-slab mark
  (`app/icon.svg`, `app/apple-icon.tsx`) is the source of truth; we only need it emitted in
  the raster sizes a web-app-manifest requires. Producing those raster files is a
  **build-time asset task**, flagged but not designed here.
- **`metadataBase` / OG-image / social-card work.** Unrelated to installability.

## Current state (audit summary)

Fully greenfield for PWA, but the icon story is **already half-solved** by existing
Next.js file-convention assets:

- **Icons that already exist and are auto-injected into `<head>`:**
  - `src/app/favicon.ico` — classic favicon.
  - `src/app/icon.svg` — 32×32 SVG favicon: near-black `#0D0D0F` rounded tile + off-white
    (`#F5F5F6`) slab mark.
  - `src/app/apple-icon.tsx` — dynamic **180×180 PNG** via `next/og` `ImageResponse`
    (off-white slab on `#0D0D0F`). Serves `apple-touch-icon` for iOS home-screen. Proves
    the repo already renders manifest-grade PNGs at build time via `next/og`.
- **Root metadata gap** (`src/app/layout.tsx`): only `title` + `description`. **No**
  `viewport` export, **no** `appleWebApp`, **no** `manifest` link.
- **No manifest** anywhere (no `app/manifest.*`, no `public/manifest.webmanifest`).
- **No PWA tooling**: no `next-pwa` / `serwist` / `workbox` in `package.json`; single
  `next.config.ts` (Cache Components / PPR enabled).
- **Brand/theme tokens** (`src/app/globals.css`): dark base `#0D0D0F`, light base
  `~#fafafa` (`oklch(0.985 0 0)`), indigo accent `#6366f1` (`--brand`). App is dark-first.
- **Boot-time env guard** (`src/instrumentation.ts`): `register()` eagerly validates
  server env and **throws to fail boot** on missing keys. Known CI gotcha: this 500s
  `next start`/Lighthouse jobs that lack `SUPABASE_SERVICE_ROLE_KEY`. **Any new file must
  not add a boot-time or request-time env dependency.**
- **Test precedents:** `src/app/streaming-shell-config.test.ts` imports config and asserts
  shape; `src/app/app-shell-structure.test.ts` reads source files and asserts structure.

## Key decisions

### 1. Manifest via `app/manifest.ts` (typed route), not a static `.webmanifest`

Use **`src/app/manifest.ts`** returning `MetadataRoute.Manifest` (Next 16 file
convention; served at `/manifest.webmanifest`).

- **Why over `public/manifest.webmanifest`:** type-safety (`MetadataRoute.Manifest`
  catches field/enum typos at `tsc` time), **unit-testability** (a Vitest test imports the
  default export and asserts the installability contract — impossible to do cleanly with a
  static JSON blob), colocation with the other `app/` metadata conventions, and it is the
  idiomatic Next 16 shape the AGENTS.md "read the docs, this isn't the Next.js you know"
  rule points at.
- **Hard constraint:** `manifest.ts` MUST be a **pure, synchronous function** with **no
  imports of `@/lib/env.*`, Supabase clients, `cookies()`/`headers()`, or any request-time
  API.** That keeps it statically prerendered (cached by default) and adds **zero** new
  boot-time/CI env requirements — it cannot regress the `instrumentation.ts` boot guard.

### 2. No service worker

A minimal installable shell does **not** need a service worker on current browsers:

- **iOS/iPadOS (Safari):** add-to-home-screen has never required a SW — it keys off
  `apple-mobile-web-app-capable` + `apple-touch-icon`, both of which we supply.
- **Chromium (Chrome/Edge):** the install path here is a manifest with the required fields
  - icons over HTTPS. The old "SW with a `fetch` handler" gate was relaxed years ago; a SW
    is only needed to claim **offline** capability — explicitly out of scope. Users get the
    in-menu "Install app" entry from the manifest alone.
- **Cost/risk of adding one anyway:** `serwist`/`next-pwa` pulls a build-time plugin into
  `next.config.ts`, ships a `sw.js`, and adds a caching layer + new CI surface — all for an
  offline feature we are deliberately not building. Excluding it keeps the change purely
  additive metadata with no new dependency, no `next.config` change, and no CI/boot risk.

**Decision: ship no service worker.** If offline is ever wanted, it is a separate spec
that would add `serwist` (preferred over the less-maintained `next-pwa`) — noted for the
future, not built now.

### 3. Icons: reuse the existing mark; add the raster sizes a manifest requires

The web-app-manifest installability contract wants raster PNGs Chromium can use for the
launcher/splash. Existing assets cover favicon + iOS; the **gap is Android/Chrome**:

| Asset                   | Size       | Purpose                                 | Status                                                |
| ----------------------- | ---------- | --------------------------------------- | ----------------------------------------------------- |
| `icon.svg`              | 32 (`any`) | favicon / scalable                      | **exists** — reference in manifest with `sizes:"any"` |
| `favicon.ico`           | 16–48      | legacy favicon                          | **exists**                                            |
| `apple-icon.tsx`        | 180×180    | iOS `apple-touch-icon`                  | **exists** (auto-injected)                            |
| `icon-192.png`          | 192×192    | Android launcher (`purpose:"any"`)      | **to add**                                            |
| `icon-512.png`          | 512×512    | splash / hi-dpi (`purpose:"any"`)       | **to add**                                            |
| `icon-maskable-512.png` | 512×512    | Android **maskable** (safe-zone padded) | **to add**                                            |

Two viable ways to produce the three new PNGs — the plan picks one:

- **(Recommended) Static PNGs in `public/`**, generated **once as a build-time asset task**
  from the existing slab mark, committed as binaries. Zero runtime render cost, dead-simple
  manifest references (`/icon-192.png`, …), standard and robust for installability. The
  asset-generation step itself is flagged as out-of-plan-scope (needs a rasterizer/design
  export); the plan lists exact sizes + the `#0D0D0F` background + maskable safe-zone.
- **(Alternative) Dynamic `next/og` routes** mirroring `apple-icon.tsx` exactly (one route
  per size), so there are no committed binaries and the mark stays single-sourced. Trades a
  cached render for zero binary assets. Kept as a documented fallback if binary generation
  is undesirable.

Either way the manifest `icons` array lists 192 (`any`), 512 (`any`), 512 (`maskable`),
plus the SVG (`any`).

### 4. Root metadata additions in `layout.tsx`

`layout.tsx` is already a Server Component (no `"use client"`), so the `viewport` export is
legal. Add three things:

- **`export const viewport: Viewport`** (Next 16 requires theme color in the _viewport_
  export, not `metadata` — `metadata.themeColor` is deprecated):
  - `themeColor` media-split: `{ media: '(prefers-color-scheme: light)', color: '#fafafa' }`
    and `{ media: '(prefers-color-scheme: dark)', color: '#0d0d0f' }`.
  - `colorScheme: 'light dark'`.
  - **Do NOT set `maximumScale: 1` / `userScalable: false`.** Locking zoom is an a11y
    anti-pattern **and** would fight the parent iPad-touch program (pinch-zoom on
    Gantt/Table). Leave the Next default viewport untouched except theme/color-scheme.
- **`metadata.appleWebApp`**: `{ capable: true, title: "Monolith", statusBarStyle:
"black-translucent" }` (dark-first status bar). Emits `mobile-web-app-capable`,
  `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`.
- **`metadata.manifest`**: **verify** whether Next 16 auto-injects
  `<link rel="manifest" href="/manifest.webmanifest">` when `app/manifest.ts` exists. If it
  does **not**, set `manifest: "/manifest.webmanifest"` in `metadata`. (Build-time
  verification step in the plan — do not assume.)

### Manifest field contract (the installability minimum)

```
name:              "Monolith — Work OS"
short_name:        "Monolith"
description:       (reuse the existing metadata.description)
id:                "/"
start_url:         "/"
scope:             "/"
display:           "standalone"
background_color:  "#0d0d0f"   (splash background = dark base)
theme_color:       "#0d0d0f"   (single value; matches dark chrome)
orientation:       (omit — let the OS decide; iPad uses both)
icons:             [ svg(any), 192(any), 512(any), 512(maskable) ]
```

## Data-fetching & performance budget (working-agreement #5)

**No server data, no views/tabs/filters/sorts** — this feature has no interactive data
surface, so #5's round-trip rules are trivially satisfied. `manifest.ts` is a **static,
cached** route (no request-time API) → prerendered once, served from cache, **0 per-request
server work**. Metadata/viewport additions are static `<head>` tags with no runtime cost.
Icon assets (static PNGs, or cached `next/og` routes) are edge/CDN-cacheable. **First-paint
and per-interaction server cost is unchanged from today.**

## Testing (working-agreement #4 — mandatory, written & executed)

- **`src/app/manifest.test.ts` (Vitest)** — import the default export from
  `app/manifest.ts`, call it, assert the installability contract: `name`, `short_name`,
  non-empty `start_url`, `display === "standalone"`, `background_color`/`theme_color`
  present, and `icons` includes at least a 192 and a 512 entry plus one
  `purpose: "maskable"`. Models `streaming-shell-config.test.ts`.
- **`layout` metadata assertion (Vitest)** — assert the root `layout.tsx` exports the
  expected shape: a `viewport` with `themeColor`, and `metadata.appleWebApp.capable ===
true`. Prefer importing the `viewport`/`metadata` exports over source-string matching
  where the module imports cleanly under jsdom; fall back to the source-read style of
  `app-shell-structure.test.ts` if importing `layout.tsx` drags in client-only deps.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- **Manual acceptance (post-merge "How to test"):** on an iPad, Safari → Share → Add to
  Home Screen shows "Monolith" + the slab icon and launches chrome-less; in desktop
  Chrome, the install icon appears in the address bar and installs a standalone window with
  the dark theme color. (Chromium install criteria are also machine-checkable via Lighthouse
  PWA/installability audit — but that is not a CI gate here.)

## Independent units (for the plan's Execution DAG — working-agreement #6)

This is a small, mostly-additive change with **one internal ordering constraint**:

1. **Icon raster assets** (192 / 512 / maskable-512) — produced by the flagged build-time
   asset task. **Produces:** the three PNG paths (or `next/og` routes) the manifest cites.
2. **`app/manifest.ts` + its test** — **Consumes:** the icon paths from (1). References them
   in the `icons` array.
3. **`layout.tsx` metadata/viewport + its test** — independent of (1); depends on (2) only
   for the manifest-link path/verification, which is a fixed constant (`/manifest.webmanifest`).

So the only real edge is **icons → manifest** (the manifest must not cite files that don't
exist, or the installability/Lighthouse check fails). Layout metadata can proceed in
parallel. The plan states this DAG explicitly even though the wall-clock floor is short.
