---
type: session
date: 2026-06-21-2057
branch: develop
trigger: wrapup
status: complete
tags: [session, phase/6, relations, mirror]
related:
  - "[[2026-06-21-phase-6d2-mirror-columns-design]]"
  - "[[2026-06-21-1119-phase-6d1-relations]]"
  - "[[2026-06-19-gotcha-23-activity-trigger-blocks-cascade-delete]]"
---

# Phase 6d-2 Mirror columns + column-delete FK fix

## What changed

- **Phase 6d-2 — Mirror columns shipped** (`task/mirror-columns-6d2` → merged `a55e642`, 9 commits): read-only `mirror` column kind (Monday "Mirror" / ClickUp "Rollup"). Pure derivation off 6d-1's `relation_links` + the target board's `cell_values` — **no new table/RPC**, only a `mirror` enum value + `{ source_relation_column_id, target_column_id }` settings. `mirror.ts` (`mirrorValuesForCell`/`mirrorTargetColumnFor`), payload hydration (2 bounded RLS-scoped queries, 0 extra first-paint round-trips), `MirrorCell` (delegates to the target kind's `CellRenderer`, multi-link "+N more"), `MirrorColumnConfig` (dual-select), BoardTable wiring. Built subagent-driven (T1→T2→{T3‖T4‖T6}→T5→T7).
- **Cross-board RLS proven** (live DB): a viewer of board A who is not a member of board B gets zero rows for the target cell → mirror renders empty (the core leak test passed first try).
- **Column-delete FK 23503 bug fixed** (`task/deletecolumn-activity-fix` → merged `5a72d06`, migration `20260621150000`): surfaced by 6d-2's RLS suite — deleting any column that had logged cell activity aborted. `tg_log_cell_activity`'s DELETE branch now guards on the **column** still existing (analogue of the existing item guard), skipping the log during a column-delete cascade. Regression test + flipped the 6d-2 `it.fails` → real `it`.
- **Build-in-main caught a real server/client boundary bug** the worktree build can't surface: `listMirrorableColumns` was placed in the `server-only` `queries.ts` but imported by the client `BoardTable` → moved to the `"use server"` `relation-candidates.ts` (`c0dc451`).
- **Triage drift corrected** (`/whats-next`): the "shared boards on `/`" gap was already fixed (`f8e693f`, non-bug — worktree torn down); changelog Tasks 6–7 already landed. Mirror design Q1–Q5 locked Monday-faithful (values-first, all `cell_values` kinds incl. status/people/date, multi-link capped, refresh-on-load, `FoldHorizontal`); aggregation deferred to **6d-3**.

## Why

6d-2 was the standing roadmap "Next" — it completes Phase 6d (relations) by adding the mirror half the `relation_links` table was shaped for. The column-delete bug was a real production defect (deleting any value-bearing column failed) caught only because the mirror RLS proof exercised the column-delete path; it is the same class as [[2026-06-19-gotcha-23-activity-trigger-blocks-cascade-delete]] (activity trigger aborting a cascade), now extended to the column cascade.

## How to test (for the user)

Pull `develop` first, then `pnpm dev`, sign in.

1. Open board A and a second board B. On B, add a Status/Text column and set a value on an item.
2. On A, **+ Add column → Relation** → target B; link B's item into a cell.
3. On A, **+ Add column → Mirror** → pick the relation as _Source relation_ + B's column as _Column to mirror_ → Add. **Reload A** → the mirror cell shows B's value, read-only (clicking opens no editor).
4. Edit the source value on B, reload A → the mirror reflects it (refresh-on-load, by design).
5. Column-delete fix: add a column, edit a few of its cells, then delete the column → it now removes cleanly (previously failed with an FK error).

## Open threads

- **6d-3 — mirror aggregation** (the committed fast-follow): sum/avg/min/max/count in the column summary footer (Monday/ClickUp rollup calc).
- Mirror **cross-board freshness** is refresh-on-load (no live cross-board push) — documented v1 limitation.
- A parallel session landed **frozen Name column** on `develop` (`04c235e`) — its own work; it should wrap up separately.

## Next session entry point

`develop == origin/develop` at `04c235e`, all green. Pick **6d-3 mirror aggregation**, or a fresh slice (**6e Docs / 7b Goals / 7c Workload**) — each needs its own brainstorm→spec→plan.
