# Phase 7c Workload v2 — Filtering + Actuals Overlay (Design)

Status: **spec written, awaiting review**
Date: 2026-06-22
Branch: `task/workload-v2-7c`

## Goal

Extend the v1 `/workload` member×week effort-vs-capacity grid (which shipped **sort-only**) with:

- **(a) Workspace / Board filtering** — narrow the grid to a chosen workspace and/or board.
- **(b) `time_entries` actuals overlay** — show logged actuals alongside planned effort, with a planned / actual / both metric toggle.

## Key findings (from reading the v1 implementation)

- **`workload_rollup` already returns `board_id` per row**, and the full 12-week horizon loads on first paint. So **board/workspace filtering of planned effort is a pure client recompute → 0 server round-trips** — _but only if grid assembly moves from server to client_. v1 calls `buildWorkloadGrid` **server-side** and ships finished cells; v2 must ship the **raw rows** + run the pure `buildWorkloadGrid` in a `useMemo` so a filter change is a client recompute, not a refetch. This is the one non-obvious architectural change (and the AGENTS.md #5 budget rule demands it: in-page filters over already-loaded data = client state + History API, never RSC nav).
- **`time_entries` exists** (`org_id`, `board_id`, `user_id`, `started_at`, `ended_at`, `duration_secs`; running timer = `ended_at IS NULL`). Indexed on `board_id` / `org_id` / `column_id` / `(item_id, column_id)` — **no index supports a horizon range scan**, so the actuals read needs a new partial composite index.

## Decisions (locked)

### (a) Filtering

- **Workspace + Board selects** in the grid header.
- Client state via **History API** (`?ws=`, `?board=`) — 0 round-trips, mirroring the existing Sort control pattern.
- Filter = subset the raw rows by `boardId` (and workspace → its boards) **before** the client-side `buildWorkloadGrid` assembly.
- Board options are derived from the already-loaded board set (RLS-scoped); workspace→boards mapping shipped in the page payload.

### (b) Actuals overlay

- New **bounded RPC** `workload_actuals_rollup(p_from date, p_to date)` returning pre-aggregated `(user_id, board_id, day, secs)`:
  - completed entries only (`ended_at IS NOT NULL`), bucketed by `started_at::date`,
  - gated by `is_org_member` + `can_read_board` (same security posture as `workload_rollup`),
  - `LIMIT 5000` (bounded; the horizon is fixed at 12 weeks).
- New **partial composite index**: `time_entries (org_id, started_at) WHERE ended_at IS NOT NULL` to support the horizon range scan.
- New `WorkloadActualRow` type + a pure `foldActualRows` helper that folds day-granular actual seconds into the same weekly buckets as planned effort.
- `BucketCell` gains `actualSecs`; a **`planned | actual | both` metric toggle** (client state, `?metric=`).
- `CapacityCell` renders the chosen metric (planned bar, actual bar, or dual/overlay).

### Migration — REQUIRED

- One file `supabase/migrations/20260622170000_workload_actuals.sql` (RPC + grant + partial index).
- **Build-time steps (NOT run during scoping):** apply via `supabase db push --linked` (per-session auth), `pnpm db:types`, commit regenerated `src/types/database.types.ts` in the same PR.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** one bounded `workload_rollup` read (unchanged) + one bounded `workload_actuals_rollup` read (new, ≤5000 rows over a fixed 12-week horizon, indexed). Page ships **raw rows** (not pre-assembled cells).
- **Each interaction** (workspace filter, board filter, metric toggle, sort): **0 new server round-trips** — client state + History API, recompute via `useMemo` over already-loaded rows.
- **Bounded + indexed:** actuals read is `LIMIT 5000` over the new `(org_id, started_at) WHERE ended_at IS NOT NULL` partial index; planned read is the existing bounded RPC.

## Scope boundaries

Confined to the workload subsystem: `src/app/workload/`, `src/components/workload/`, `src/lib/workload/`, `src/lib/validations/workload.ts`, one migration, types regen. **No app-shell or cross-cutting edits** — disjoint from Phase 9.2 / 9.5 and from boards/dashboards.

## Deferred (out of scope for v2)

- Per-day actuals drill-down / timesheet view.
- Running-timer (in-progress) seconds in the actuals overlay (completed entries only).
- Capacity-vs-actual variance analytics / alerts.
