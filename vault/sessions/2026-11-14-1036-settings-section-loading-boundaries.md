---
type: session
date: 2026-11-14-1036
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-13-gotcha-110-a-parent-loading-tsx-does-not-cover-sibling-navigation]]"
  - "[[2026-11-13-1232-performance-audit-region-and-quick-wins]]"
---

# Settings section loading boundaries

## What changed

- The owner pasted a dev-overlay "Instant" warning on `/settings/profile` ("uncached data during a
  navigation", stack through `getClaims` and `AppLayout`). Reproduced on the running dev server:
  every `/settings/*` page carried it; `/my-work` and `/ask` were clean.
- Cause: `settings/loading.tsx` is keyed to the `settings` segment, so it never re-suspends when
  moving between two sections. Each section's `await requireUser()` blocked the switch. The stack
  showed `AppLayout` only because `getUser` is `cache()`'d and the shell starts that promise first.
  Confirmed with a live A/B (a temporary `profile/loading.tsx` cleared profile; security still warned).
- Fix, merged to `develop` as `819fe9e3` (task commit `d91d526f`): the skeleton moved to
  `src/components/settings/settings-section-skeleton.tsx`, each of the 11 sections got its own
  `loading.tsx`, and `settings/loading.tsx` was removed (it had also hidden the settings header and
  nav on the way in). `app-shell-structure.test.ts` now requires a sibling `loading.tsx` per page.
- ADR: [[2026-11-13-gotcha-110-a-parent-loading-tsx-does-not-cover-sibling-navigation]].
- `/updates`: announced as an "improved" entry dated 2026-11-13.

## Why

Switching settings sections waited on the server with no feedback. The warning is dev-only, so
`pnpm build` and CI never flagged it, and the structure test's "ancestor covers it" premise was wrong.

## How to test (for the user)

1. Pull `develop` in the main checkout and restart `pnpm dev`.
2. Open `http://localhost:3000/settings/profile`. The Next.js badge (bottom-left) should show no Insight.
3. Click Security, Members, then Preferences in the settings nav. Header and nav stay in place, only
   the content column briefly shows the skeleton, and no Instant insight appears.
4. From My Work, open Settings. Header and nav paint immediately; only the content column shows the skeleton.

## Open threads

- `/settings/preferences` logs a hydration-mismatch console error. Not investigated; possibly a
  browser extension.
- Untracked `_draft-*.md` stubs (2026-09-15 x2, 2026-11-13-2124, 2026-11-14-0314, -0608) left in
  place: they carry only git-stat stubs and could belong to parallel sessions.

## Next session entry point

Ships with the next promotion; nothing else owed for this fix beyond the walkthrough above.
