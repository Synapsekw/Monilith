# Phase 7c Workload v2 — Implementation Plan (TDD)

Status: **plan written, awaiting review**
Spec: `docs/superpowers/specs/2026-06-22-phase-7c-workload-v2-design.md`
Branch: `task/workload-v2-7c`

> TDD throughout (RED → GREEN → refactor). Gate before finish: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Tasks

### T1 — DB: actuals RPC + index migration _(Batch 1)_

- **Produces:** `supabase/migrations/20260622170000_workload_actuals.sql`:
  - `workload_actuals_rollup(p_from date, p_to date)` → `setof (user_id uuid, board_id uuid, day date, secs bigint)`; completed entries only (`ended_at IS NOT NULL`), `started_at::date` bucket; `is_org_member` + `can_read_board` gate; `LIMIT 5000`.
  - partial composite index `time_entries (org_id, started_at) WHERE ended_at IS NOT NULL`.
  - `GRANT EXECUTE` to `authenticated`.
- **Build-time (not in this task's code review):** `supabase db push --linked` → `pnpm db:types` → commit regenerated `src/types/database.types.ts`.
- **Tests:** live RLS integration in `workload.rls.integration.test.ts` — member sees own-org actuals; non-member of a board gets 0 rows for it; completed-only (running timer excluded); horizon bounds respected.
- **Consumes:** nothing.

### T2 — Pure rollup + types layer _(Batch 1, parallel with T1)_

- **Produces:**
  - `WorkloadActualRow` + `BucketCell.actualSecs` + metric-mode type in `src/lib/workload/types.ts`.
  - `foldActualRows(rows, horizon)` pure helper folding day-granular actual secs into the same weekly buckets as planned effort (`src/lib/workload/rollup.ts`).
  - Workspace→boards map shape for the page payload.
- **Tests:** `rollup.test.ts` — `foldActualRows` bucket boundaries (week start/end, day at boundary), empty input, multi-board fold, planned+actual coexistence in a `BucketCell`.
- **Consumes:** nothing (pure).

### T3 — Query-layer reshape _(Batch 2 — depends T1, T2)_

- **Produces:** `src/lib/workload/queries.ts` — ship **raw rows** (not pre-assembled cells): call `workload_rollup` + `workload_actuals_rollup`, return raw planned rows + actual rows + the board/workspace maps. `src/app/workload/page.tsx` accepts `?ws=`, `?board=`, `?metric=` from `searchParams` only for initial render; passes raw payload down.
- **Tests:** `queries` unit (mocked RPC) — both RPCs invoked with the right horizon; payload carries raw rows + maps.
- **Consumes:** T1 RPC, T2 types.

### T4 — Filter controls + metric toggle _(Batch 3 — depends T3)_

- **Produces:** Workspace + Board `Select`s and a planned/actual/both metric toggle in the workload header; client state via History API (`?ws=`/`?board=`/`?metric=`), 0 round-trips — mirror the existing Sort control. Validation schemas in `src/lib/validations/workload.ts`.
- **Tests:** component — selecting a workspace/board updates the URL via `history.pushState` (no navigation); metric toggle flips state.
- **Consumes:** T3 payload.

### T5 — Client grid assembly + CapacityCell metric render _(Batch 3, parallel with T4)_

- **Produces:** move `buildWorkloadGrid` to a client `useMemo` in `WorkloadGrid.tsx` over the raw rows, applying the active workspace/board filter + metric; `CapacityCell` renders planned bar / actual bar / dual-overlay per the metric mode.
- **Tests:** component — filter subsets rows with 0 refetch; metric=actual shows actual bar; metric=both overlays; capacity coloring intact.
- **Consumes:** T3 payload, T2 types.

## Execution DAG (AGENTS.md #6)

- **Edges:** T3 ← {T1, T2}; T4 ← T3; T5 ← T3.
- **Batch 1 (parallel):** T1 (migration), T2 (pure rollup/types).
- **Batch 2:** T3 (query-layer reshape).
- **Batch 3 (parallel):** T4 (filter/metric controls), T5 (client assembly + CapacityCell).
- **Critical path:** T1/T2 → T3 → T4/T5 (depth 3).

## Notes / risks

- **The architectural pivot** is T3+T5: grid assembly moves server→client so filtering is a recompute, not a refetch. Keep `buildWorkloadGrid` pure so it runs identically on both sides; T2's tests pin it.
- Single worktree, single session — Batches are concurrency _within_ the build, not parallel worktrees.
- Migration apply + types regen are build-time auth-gated steps; flag for the user at build kickoff.
