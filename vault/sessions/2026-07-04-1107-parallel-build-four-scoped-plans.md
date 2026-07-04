---
type: session
date: 2026-07-04-1107
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-03-1918-whats-next-triage-scope-four-plans]]"
---

# Parallel build: four scoped plans greenlit → merged to develop

## What changed

- Ran `/whats-next` from the main checkout. Distinctive shape: the four candidates were **already
  scoped to reviewed plans** (pushed on `task/*` branches from the prior session), so this run
  greenlit **builds**, not re-scoping. Based each worktree on its **existing `origin/task/*`**
  branch so the plan travelled into the build.
- Dispatched **four parallel build sessions** (subagent-driven, TDD, each ran the four gates +
  `finish-task.sh`). All merged to `develop` in rebase order: `#1 rename-board-shared-tag` (`0839be1`),
  `#2 pwa-shell` (`4ca1ffd`), `#3 widget-preview-live` (`babf0c6`), `#4 perf-tier3` (`e2ffaa3`).
  `develop == origin/develop` at **`e2ffaa3`**; test count 2025 → 2039; all worktrees/branches cleaned.
- **#2 caught a latent bug beyond its plan:** the auth proxy (`src/proxy.ts`) was 307-redirecting
  `/manifest.webmanifest` → `/login` for anonymous visitors (would silently break the install
  prompt) — excluded it from the proxy matcher with a locking test.
- **#4 perf-tier3 shipped 5 of 6 tasks.** Landing WebGL deferral, avatars via `next/image` (kills
  CLS), `optimizePackageImports:["radix-ui"]` + analyzer, TimeCard optimistic totals, bounded
  `items`/`cell_values` reads. **Task A (`unstable_instant` on `(app)` segments) NOT delivered** —
  see ADR — but salvaged the useful part: added the missing `dashboards`/`portfolios` `loading.tsx`
  skeletons.
- Tidied the orphaned remote `task/rename-board-shared-tag` (finish-task deleted local only).

## Why

MVP-F is 9/9 in prod and Phase 7 is done, so "what's next" was carryover cleanup, not a big feature.
The prior `/whats-next` stopped at reviewed plans; this session executed them as a disjoint-footprint
parallel batch — the senior-lead "review specs, then greenlight" flow — landing four independent
improvements in one wave.

## How to test (for the user)

Pull `develop`, `pnpm install` (new devDep), run the app.

1. **`/time`** — type into a day cell → row Total, Daily total, Week total update the same frame;
   clear the cell → all three drop to zero immediately.
2. **Dashboard config sheet** — Add/edit a widget, pick a source board → live preview shows **real
   data** (was "Failed to load"); changing config refetches once after ~400 ms.
3. **Shared board rename** — as owner A rename a board shared with B → B sees the new name in
   `/boards` immediately (no stale cache wait).
4. **`/dashboards` & `/portfolios`** — instant skeleton on nav (previously blank).
5. **PWA** — `/manifest.webmanifest` returns valid JSON even logged-out; desktop "Install app" works;
   iPad Add-to-Home-Screen shows "Monolith" + slab icon, launches full-screen.

## Open threads

- **`unstable_instant` (perf Task A)** — needs the shell moved off `useSearchParams()`; own spec.
  See [[2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams]].
- **Ops (unchanged, user-only):** re-apply import-wizard-v2 **dev** migration
  (`20260703110000_import_rows_into_board.sql` → DEV SQL editor); prod Batch B migrations + ledger
  repair on both projects.
- **Product call:** Phase 10 vs revive 6e Docs vs **declare v1 feature-complete** (my read: v1-complete).
- Stale orphan `origin/task/per-user-timezone` (now pruned/gone) — resolved.

## Next session entry point

Make the v1-feature-complete call (or define Phase 10), then either spec the
shell-off-`useSearchParams` refactor for instant-nav or work the two owed migrations.
