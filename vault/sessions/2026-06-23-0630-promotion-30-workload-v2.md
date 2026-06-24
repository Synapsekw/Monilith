---
type: session
date: 2026-06-23-0630
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-22-2157-whats-next-batch-a-builds]]"
---

# Promotion #30 — Workload v2 + Batch A bundle to production

## What changed

- **`/promote` run → PR #30 squash-merged `develop → main`** (`f10cd8c`), shipping the full bundle
  to Vercel production. develop CI (verify) green, PR checks green (Vercel preview passed,
  commitlint PR-job skipped by config), main CI (verify) green, **Vercel prod deploy = success**.
- **Squash-divergence heal applied** (gotcha-32): `git merge -s ours origin/main` into develop
  (`f22ac4d`, pushed); confirmed `main` is now an ancestor of `develop` so the next promotion
  PR stays mergeable.
- No source changes this session — promote operates on branches/PR only (plus the no-op heal commit).

## Why

The full `develop` bundle (this session's Workload v2 + TimeTrackingCell date Calendar, plus the
earlier unpromoted run: people-cell names, sidebar item menus, 6h item-panel presence, 9.1 auth
fast-path, date-cell Safari calendar, 7b done-mapping, `/boards` index fix) had accumulated on
`develop` since promotion #29. Promotion is all-or-nothing, so one PR shipped it all.

## How to test (for the user)

On production (www.monolith.works), logged in:

1. `/workload` → use the **Workspace** and **Board** dropdowns (grid recomputes, no reload) and the
   **Planned / Actual / Both** toggle (Actual needs completed time-tracking entries on dated,
   assigned items).
2. A board with a **time-tracking** column → time cell → "+ Add time" → the date field is now a
   calendar popover (works in Safari).
3. Spot-check the earlier bundle items already live: sidebar board/dashboard 3-dots menus,
   People/Owner column showing names, item-panel "also viewing" presence.

## Open threads

- **Migration-ledger reconciliation still owed** — `20260622170000_workload_actuals` is live in
  production but applied via the SQL editor, not the ledger; the 2026-06-22 ledger holds 5 throwaway
  version strings. `supabase db push` won't run clean until a user-run `migration repair` (revert
  `20260622073853`/`083807`/`084607`/`104537`/`110257`, mark committed 06-22 ones applied). Does not
  affect the running app. See [[migration-apply-blocked-by-classifier]], [[supabase-migration-ledger-drift]].
- **#5 Phase 9.2 streaming shell** not built — worktree `task/streaming-shell-9-2` on stale base
  `5dfab99`; rebase onto current `develop` before building.

## Next session entry point

Build **Phase 9.2 streaming shell** from its written plan (rebase the worktree first). Run the
migration-ledger `repair` when convenient so `db push` works again.
