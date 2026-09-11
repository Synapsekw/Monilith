---
type: session
date: 2026-09-11-1157
branch: task/editorial-landing
trigger: wrapup
status: complete
tags: [session, landing, design]
related:
  - "[[2026-09-11-0707-promote-117-118-multi-assign]]"
---

# Editorial landing port (Version 3, Charcoal + Cobalt)

## What changed

- Replaced the public landing (`/` and `/landing`) with the approved standalone design artifact
  (`~/Documents/Monolith/artifacts/Monolith-Landing.html`, "Version 3 / Editorial"). One Server
  Component `EditorialLanding` in `src/components/landing/`, two client leaves (mobile nav toggle,
  Radix-Tabs product tour), FAQ on native `<details name>`. Commit `f1e12b24` on
  `task/editorial-landing` (rebased onto `develop` @ `efc42c0b`).
- The artifact's five stylesheets collapsed into one CSS module scoped under `.page`, palette as
  custom properties declared once; `landing-tokens.test.ts` now allows hex only in those
  declarations. Fonts reuse the app's next/font assets; the wordmark is the official Nunito 800 +
  slab-I geometry.
- Links wired to real routes (`/signup`, `/login`, `/pricing`, `/updates`); signed-in viewers get
  "Enter app" / "Open your workspace". Prices and credits read from `lib/billing/tiers`. Production
  metadata untouched (no `noindex`, no "standalone design concept" note, no capture annotations).
- Product captures re-shot from the REAL UI on a throwaway "Northwind Labs" org (user "Alex Morgan",
  board "Pipeline"), created through the app and deleted afterwards with verification — the
  prototype's private-workspace captures never enter the repo.
- Old landing (mocks, scene, light rays, reveal, view switcher, bands) deleted. Added
  `src/types/static-images.d.ts` so `pnpm typecheck` passes in a fresh worktree without
  `next-env.d.ts`.
- Gates green in the worktree: typecheck, lint (4 pre-existing warnings), test (782 files / 7291
  passing), build. Visual parity checked against the artifact with Playwright tile screenshots at
  1440 and 390 widths (no horizontal overflow).
- Owner approved the preview; merged into `develop` @ `ae5c0eee` via `finish-task.sh` (worktree
  removed, branch deleted). `/updates`: announced "A new landing page" (`d8436188`, regenerated in
  `dd0ea26f`); it publishes on the next promotion.

## Why

The owner approved a landing design developed outside the app (three variants; Version 3 chosen)
and the handoff authorised preparing the replacement but explicitly **not** merging or deploying
until the preview is reviewed. The port keeps the design's typography, composition, palette and
the central MCP message (external tools operate the platform through MCP with people's
capabilities, distinct from built-in scheduled board agents and their proposal review).

## How to test (for the user)

1. In the worktree `.claude/worktrees/editorial-landing`, run `pnpm dev -p 3001` and open
   http://localhost:3001/ (logged out) — the Editorial hero "Work, with everyone in it." with the
   real board capture beneath; compare with the artifact HTML side by side.
2. Click "Product", "For agents", "Why Monolith", "Pricing" in the header — the page scrolls
   in place, no reload.
3. In the product tour, click "Item details" and "Agent dock" — the capture and caption switch
   instantly; Tab into the selector and use the arrow keys.
4. Open a FAQ — one opens at a time, chevron rotates. Tab through the page — every control shows
   a highlight outline.
5. Narrow the window below 580px — the hamburger appears, opens the menu, and a link click
   closes it; no horizontal scrollbar at any width.
6. Sign in and open http://localhost:3001/landing — the header shows "Enter app" only, no
   "/signup" links anywhere; `/` itself redirects you into the app as before.
7. Check the captures show "Northwind Labs / Sales / Pipeline / Alex Morgan" — nothing from the
   real workspace.

## Open threads

- **Promoted 2026-09-11, PR #120** (11 commits, squash `1875cc34`, healed on `develop`). Verified
  live: main CI green (run 34597034366), Vercel `state=success`, `www.monolith.works/` serving the
  Editorial hero, `/updates` serving "A new landing page". `/sync-prod` declined by the owner.
- The Chrome extension was not connected this session; Playwright stood in
  ([[playwright-screenshots-from-worktree]] in auto-memory).
- The first neutral re-shoot came out in the Keystone default preset (periwinkle); the owner wanted
  the teal Ocean look of the originals, so all three captures were re-shot with
  `profiles.theme_preset = 'ocean'` on a fresh throwaway org (deleted afterwards) and merged as
  `20047380` (`task/landing-captures-ocean`).
- PR #119 (readable assignees) was promoted by another session with no session note yet; the
  north-star's Branch/In-flight bullets were updated from git, not from a live verification.

## Next session entry point

The landing is live. Next: the owed manual passes against production and E6 Stripe (owner-blocked); the other session's `task/board-intelligence-orient` worktree is in flight.
