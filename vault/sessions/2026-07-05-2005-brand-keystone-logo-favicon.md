---
type: session
date: 2026-07-05-2005
branch: develop
trigger: wrapup
status: complete
tags: [session, brand]
related: []
---

# Brand refresh — Keystone logo + cleaved-monolith favicon

## What changed

- **Shipped to develop** (commit `ed0228c`, merge `d73ab2d`) the finalized "Keystone" brand:
  `MonolithMark` -> cleaved monolith (sheared top slice + crack, currentColor); `Brand` -> the
  Nunito wordmark with the letter I recut as the monolith slab (`MONOL`slab`TH`) + an sr-only
  "MONOLITH" for the accessible name; `icon.svg` -> Cleave (bold 16px cut); `apple-icon` -> Cleave.
- Regenerated the four raster assets (`icon-192/512`, `icon-maskable-512`, `email/monolith-logo@2x`)
  from the new marks via a new `scripts/generate-app-icons.ts` (Playwright, not `sharp` — see notes).
- Built `brand-lab/` (static exploration, served by `node brand-lab/serve.mjs` on :4321), committed
  for cross-machine portability: mark studies (6 concepts, **Cleave** chosen), slab-I cut variations
  (A/B/C/D, A kept), and **four full landing variations** (Statement/Product/Editorial/Kinetic) + hub.

## Why

The brand needed sharpening (the ask: an Anthropic-style all-caps wordmark + a clean favicon). We kept
the shipped Nunito face and made one move — the I becomes the monolith — so the logo ties to the app
instead of inventing a foreign identity. The standalone icon takes that same monolith and cleaves it.

## How to test (for the user)

1. Pull `develop`, `pnpm dev`, sign in.
2. Nav sidebar (expanded): the brand reads `MONOL`slab`TH` (the I is the monolith slab).
3. Collapse the rail: the brand becomes the standalone cleaved-monolith mark.
4. Browser tab: the favicon is the cleaved monolith on a near-black tile (crisp at small size).
5. Empty-boards state / install-to-home-screen: the mark/app icon is the cleaved monolith.

## Open threads

- **Decision pending: pick ONE landing variation** (Statement / Product / Editorial / Kinetic, or a
  hybrid) from the brand-lab hub, then productionize it into the `/landing` route as a separate task.
- Wordmark slab-I cut is still the default **A**; never formally locked among A/B/C/D.
- `brand-lab/` is throwaway exploration, committed only for portability — delete once a landing lands.
- Note: `sharp` is a transitive-only dep (not importable under pnpm) — regenerate icons with the
  Playwright scripts, not sharp. (Also captured in auto-memory `brand-keystone-and-icon-gen`.)

## Next session entry point

`node brand-lab/serve.mjs` -> open http://localhost:4321/keystone/landings.html, pick a landing
direction, then apply it to `src/app/landing` on a task branch.
