---
type: session
date: 2026-06-22-1205
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Favicon.ico raster fallback

## What changed

- Added `src/app/favicon.ico` (multi-resolution 16/32/48, 1754b) — committed `efb01e9`, pushed to `origin/develop`.
- Rasterized from the existing `src/app/icon.svg` mark via **headless Chromium (Playwright)** — the macOS `qlmanage` Quick Look path silently rendered the SVG's XML _as an error page_, so the first `.ico` was garbage; caught it on visual inspection and re-rendered through a real SVG engine.
- Packed the PNGs into a valid ICO container with a small Node script (ICO header + per-image dir entries + embedded PNG data).
- Trivial single-asset edit → committed straight on `develop` in the main checkout per the trivial-edit exemption (no worktree).

## Why

The favicon wasn't missing — `icon.svg` + `apple-icon.tsx` existed and Next emitted the link tags — but the default `favicon.ico` had been deleted in promote `#18`, so `/favicon.ico` 404'd with no raster fallback. Chromium renders the SVG fine (the user's blank tab is almost certainly favicon cache), but a raster `.ico` is the durable, universal fix: it covers the bare root request and any client that won't render an SVG favicon. Next now emits the `.ico` `rel=icon` first, then the SVG.

## How to test (for the user)

1. Pull `develop` (or use the already-running dev server) and open `http://localhost:3000/favicon.ico` directly — you should see the dark rounded tile with the off-white cleaved slab (not a 404).
2. Load `http://localhost:3000/` in a **fresh Incognito window** (clean cache) — the browser-tab icon should now show the mark. (A normal-window refresh may keep showing the old blank icon for a while because Chrome caches favicons aggressively; Incognito bypasses that.)
3. Confirmed on the dev server: `/favicon.ico` → `200 image/x-icon`, and `<head>` now lists `favicon.ico` (raster) + `icon.svg` (vector) + `apple-icon`.

## Open threads

- None. Pure asset addition; no logic touched, no follow-up.

## Next session entry point

Back to the product roadmap — **Phase 7c Workload/capacity** is the next unspec'd build (needs brainstorm → spec → plan).
