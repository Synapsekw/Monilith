---
type: session
date: 2026-06-22-2157
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-22-1546-date-cell-safari-custom-calendar]]"
  - "[[2026-06-22-1602-whats-next-batch-7c-7b-6h]]"
---

# /whats-next Batch A — TimeTracking date calendar + Workload v2

## What changed

- **`/whats-next` triage** → 3 scope-to-plan agents (all hit the read-only subagent Edit/Write wall,
  so specs/plans were persisted orchestrator-inline). User approved all 3; built Batch A inline.
- **#3 TimeTrackingCell calendar swap** (`f151385`): replaced the two native `<input type=date>` with a
  click-to-open `Calendar` popover (`DatePickerButton`); extracted shared `isoToLocalDate`/`localDateToISO`
  → `src/lib/boards/iso-date.ts` (both the date cell editor + time-tracking import it). Fixes the Safari
  no-glyph problem. TDD: helper unit + 3 cell tests (correct local ISO, no off-by-one, no native input).
- **#2 Workload v2** (`62f9d26`): workspace/board filtering + planned/actual/both metric toggle on
  `/workload`. Grid assembly moved server→client (`buildWorkloadGrid` in a `useMemo` over raw rows) so
  filters are 0-refetch (History API `?ws=`/`?board=`/`?metric=`). New `filterByBoards` + `foldActualRows`;
  `cell.actualSecs`/`row.totalActualSecs`; metric-aware `CapacityCell`. New `workload_actuals_rollup` RPC +
  partial index (migration `20260622170000`), `is_org_member`+`can_read_board` gated, completed-only,
  LIMIT 5000. Tests: rollup unit, WorkloadGrid component, +3 live RLS integration (aggregation w/ running
  timer excluded, cross-org isolation, board gating). Types regenerated.
- **#5 Phase 9.2 streaming shell — NOT built.** Spec/plan written; left for a focused session.

## Why

`/whats-next` recommended Batch A (three disjoint footprints). The date-cell calendar was a deferred
follow-up from the Safari fix; Workload v2 was the deferred filtering/actuals half of 7c. Both close
real gaps; 9.2 is a large app-wide `cacheComponents` migration that warrants its own session.

## How to test (for the user)

Pull `develop`, run the app.

1. **Time-tracking date pickers** — open a board with a time-tracking column → click a time cell → in
   "+ Add time" click the date button (calendar icon) → pick a day, enter `1h`, **Add** → entry logs on
   that date. Edit an entry (pencil) → date is the same calendar button. No off-by-one; identical in Safari.
2. **Workload filters** — go to `/workload` → pick a **Workspace** then a **Board** from the dropdowns →
   grid recomputes instantly (URL gains `?ws=`/`?board=`, no reload); member totals drop to that board.
3. **Workload metric toggle** — switch **Planned / Actual / Both**. _Actual_ shows logged `time_entries`
   (needs completed entries on a board with dated, assigned items); _Both_ shows `act Xh` under planned.

## Open threads

- **Promotion pending** — full `develop` bundle (these two + earlier unpromoted work) not yet on `main`.
- **Migration-ledger reconciliation needed** — `20260622170000_workload_actuals` is live on cloud (applied
  via SQL editor, NOT in the ledger); the 2026-06-22 ledger holds 5 throwaway version strings. `supabase
db push` won't run clean until a `migration repair` (revert the 5 throwaways `20260622073853`/`083807`/
  `084607`/`104537`/`110257`, mark committed 06-22 ones applied). Agent can't run it (classifier-gated) → user-run.
- **#5 Phase 9.2** not built — worktree `streaming-shell-9-2` on stale base `5dfab99`; rebase before building.
- Workload v2 deferred: per-day actuals drill-down, running-timer seconds, variance analytics.

## Next session entry point

Build **Phase 9.2 streaming shell** from its written plan (rebase `streaming-shell-9-2` onto current
`develop` first). Separately, run the migration-ledger `repair` so `db push` works again.
