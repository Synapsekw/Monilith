# Workload Analytics v3 — Design Spec

Status: **spec written, awaiting user review** (scope-to-plan run; not built)
Branch: `task/workload-v2-analytics`
Supersedes nothing; extends `2026-06-22-phase-7c-workload-v2-design.md`.

---

## 1. Context — where /workload is today

`/workload` is an org-wide member × week effort-vs-capacity grid (Phase 7c).

- **v1** (`d95678d`, migration `20260622160000_workload.sql`): `workload_rollup(p_from, p_to)`
  RPC returns RAW `(item, assignee, start_date, end_date, estimate_secs)` rows; pure TS in
  `src/lib/workload/rollup.ts` spreads each item's effort across working days into weekly buckets
  vs. per-member capacity. Sort-only, History-API driven (0 refetch).
- **v2** (`62f9d26`, migration `20260622170000_workload_actuals.sql`): grid assembly moved
  server→client (`buildWorkloadGrid` runs in a `useMemo` in `WorkloadGrid.tsx`), enabling
  **workspace/board filtering** as a pure client recompute, plus a **planned / actual / both**
  metric toggle backed by `workload_actuals_rollup(p_from, p_to)` → per-`(user, board, day)`
  **completed** logged seconds. Folded into the same weekly buckets via `foldActualRows`.

Key files (all cited, real):

- `src/app/workload/page.tsx` — RSC; fetches `getWorkloadPageData`, renders `<WorkloadGrid>`.
- `src/lib/workload/queries.ts` — `getWorkloadPageData()` ships RAW rows + actuals + board/workspace
  metadata + server clock (`today`, `weeksBack=1`, `weeksFwd=4`, `weekStartsOn=1`). Loaded horizon
  is `today−14d … today+70d` (≈12 weeks); a `?from/?to` override only fires when paging BEYOND it.
- `src/lib/workload/rollup.ts` — pure math: `spreadItemEffort`, `bucketByWeek`, `foldActualRows`,
  `buildWorkloadGrid`, `capacityState`, `filterByBoards`.
- `src/lib/workload/types.ts` — `WorkloadRawRow`, `WorkloadActualRow`, `BucketCell`
  (`effortSecs`/`capacitySecs`/`actualSecs`/`ratio`/`state`), `MemberRow`, `WorkloadMetric`.
- `src/components/workload/WorkloadGrid.tsx` — client grid; filters/sort/metric via History API
  (`setParam` → `window.history.pushState` → `useSearchParams`).
- `src/components/workload/CapacityCell.tsx` — one member×week cell; planned/actual/both render +
  capacity-state color (under/at/over/none, AA + colorblind-safe).
- `supabase/migrations/20260620000001_time_entries.sql` — `time_entries`: a **running timer is a row
  with `ended_at IS NULL` and `duration_secs IS NULL`** (CHECK enforces both-or-neither). One
  running timer per user (partial unique index). `started_at`/`ended_at` timestamptz.

## 2. The gap — three deferred follow-ups

From the 7c + v2 sessions, three analytics follow-ups were explicitly deferred:

- **(a) Per-day actuals drill-down** — expand a member/week to see the day-by-day actual
  `time_entries` behind a weekly actuals bucket.
- **(b) Running-timer seconds** — reflect an in-progress running timer in actuals (today
  `workload_actuals_rollup` is `ended_at IS NOT NULL`, i.e. completed-only).
- **(c) Variance analytics** — surface planned-vs-actual variance (over/under, % delta) as a
  derived view.

These are open-ended; this spec **scopes** them.

## 3. Scope decision (the important part)

**Recommended v3 slice: do (a) + (c); defer (b).** Rationale below; the decision is open for
review in §9.

### 3.1 DO — (c) Variance analytics [primary value, lowest cost]

Planned-vs-actual variance is **pure derived math over data already on the client** (`effortSecs` and
`actualSecs` already live in every `BucketCell` / `MemberRow` total). No new query, no migration, no
round-trip. It is the highest-signal, lowest-risk piece: it turns the existing "both" toggle from two
numbers the user must diff in their head into an explicit over/under delta.

Concretely:

- Add a **fourth metric** `"variance"` to the existing `planned | actual | both` toggle.
- Pure helpers in `rollup.ts`:
  - `varianceSecs(actualSecs, effortSecs) = actualSecs − effortSecs` (signed; + = over-plan).
  - `variancePct(actualSecs, effortSecs)`: `effortSecs > 0 ? (actualSecs − effortSecs) / effortSecs
: null` (null when no planned baseline — avoid divide-by-zero, render "—").
  - A `varianceState(actual, planned): "over" | "under" | "on" | "none"` for cell coloring
    (mirrors `capacityState`'s tri-color but planned-relative, with a small tolerance band so
    "roughly on plan" reads neutral — see §9 Q3 for the band default).
- `CapacityCell` `metric==="variance"` render: primary = signed delta (e.g. `+3h` / `−2h`), secondary
  = `variancePct` (e.g. `+38%` / `—`), colored by `varianceState`.
- `MemberRowHeader` already shows row totals; extend to show a row-level variance summary when the
  variance metric is active (reuse `totalEffortSecs`/`totalActualSecs`).

This is a **client-only** change: the metric toggle stays History-API + 0 refetch (AGENTS.md §5),
and all math is unit-testable pure functions (AGENTS.md §4).

### 3.2 DO — (a) Per-day actuals drill-down [the genuinely-asked-for feature]

Expand a member/week cell to reveal the day-by-day actuals behind the weekly bucket.

**Data source — reuse what's already loaded, do NOT add a query.** `getWorkloadPageData` already
ships `actuals: WorkloadActualRow[]` at **per-`(user, board, day)`** granularity for the whole
horizon. A weekly bucket for `(userId, weekKey)` is exactly the subset of those rows whose
`weekStartOf(day) === weekKey`. So the drill-down is a **pure client filter over already-loaded
rows** — 0 round-trips, satisfying the AGENTS.md §5 budget by construction.

- New pure helper `actualsForCell(actuals, userId, weekKey, weekStartsOn, boardIds): DayActual[]`
  in `rollup.ts` — returns the in-week day rows (optionally board-name-resolved), sorted by day,
  honoring the same board filter the grid uses.
- New presentational component `DayActualsPopover.tsx` (shadcn `Popover`, matching the existing
  `FilterSelect` popover idiom in `WorkloadGrid.tsx`) anchored to a clicked cell: lists each day in
  the week with its logged hours and (optionally) per-board breakdown; empty days shown muted.
- Trigger: clicking a cell with `actualSecs > 0` (in `actual`/`both`/`variance` metric) opens the
  popover. Keyboard-accessible (button trigger, focus-visible ring), AA contrast — `pulse-ui`.

**Granularity caveat (decision Q1):** because `actuals` is pre-aggregated **per day** (not per
entry), the drill-down shows **per-day totals**, not individual `time_entries` sessions. Going to
true per-entry/per-item granularity (start/end times, item names) WOULD need a new RPC. Recommended:
ship per-day now (0-migration, 0-refetch); defer per-entry. See §9 Q1.

### 3.3 DEFER — (b) Running-timer seconds [low value, real correctness traps]

Recommend **deferring (b)** to a later slice. Reasons:

- **Marginal analytical value.** The workload grid is a _planning/retro_ surface over a 12-week
  horizon; a single in-progress timer's partial seconds in the current week is noise at that
  altitude, and it's never reproducible (it changes every second).
- **Correctness traps.** Running-timer seconds are computed `now() − started_at`, so they are
  **clock-dependent and non-deterministic** — they break the project's core invariant that the
  server owns one `today`/clock and SSR/CSR agree (see the `types.ts` note and `serverToday`). The
  number would be stale the instant it paints and would differ between SSR and the client unless we
  add a live ticking client clock — scope creep for a retro grid.
- **It pollutes the actuals semantics.** `workload_actuals_rollup` and its partial index
  (`time_entries_org_started_completed_idx WHERE ended_at IS NOT NULL`) are deliberately
  completed-only; mixing in running rows means either a second query branch or dropping the partial
  index's selectivity.

If (b) is later wanted, the clean shape is a **separate, explicitly-live** signal (e.g. a small
"+ live: Nh running" annotation fed by a dedicated running-timer query on a client interval), NOT
folded into the historical bucket. Captured as a follow-up, not built here. See §9 Q2.

## 4. What ships (summary)

| Piece                          | Type             | New query/migration?         | Refetch? |
| ------------------------------ | ---------------- | ---------------------------- | -------- |
| (c) Variance metric + math     | client + pure TS | No                           | 0        |
| (a) Per-day drill-down popover | client + pure TS | No (reuses loaded `actuals`) | 0        |
| (b) Running timer              | **deferred**     | —                            | —        |

**No new migration, no new RPC, no type regen** under the recommended scope. This also sidesteps the
known **migration-ledger-drift trap** entirely (see §7).

## 5. Data-fetching & performance budget (AGENTS.md §5)

- **First paint:** unchanged. `getWorkloadPageData` already loads raw rows + per-day actuals +
  board/workspace metadata + server clock in one bounded `Promise.all`. v3 adds **zero** new
  server reads.
- **Each interaction:**
  - Variance toggle → client state via History API (`setParam({ metric: "variance" })`),
    `useSearchParams` re-render, **0 round-trips**. Identical pattern to the existing
    planned/actual/both toggle.
  - Drill-down popover open → pure `actualsForCell` filter over the in-memory `actuals` array,
    **0 round-trips**. Bounded by construction: a week is ≤7 day-rows per board, and `actuals`
    itself is already `LIMIT 5000` at the RPC.
- **Does any interaction change server data?** No. Both are read-only views over loaded data →
  client state + History API, never a Server Action / RSC nav (gotcha-09).
- **Bounded over indexed columns?** No new read path. The existing `actuals` read is already
  bounded (`LIMIT 5000`) over the partial index `time_entries (org_id, started_at) WHERE ended_at
IS NOT NULL`.

## 6. Tests (AGENTS.md §4 — mandatory, written + executed)

All new logic is **pure TS**, so coverage is unit-level (Vitest), no new RPC ⇒ **no new live RLS
integration test required** under the recommended scope.

- `src/lib/workload/rollup.test.ts` (extend):
  - `varianceSecs`: signed delta both directions; zero when equal.
  - `variancePct`: positive/negative; **null when `effortSecs === 0`** (no divide-by-zero).
  - `varianceState`: over / under / on (within tolerance band) / none (no planned & no actual).
  - `actualsForCell`: returns only the target week's days; respects `weekStartsOn` boundary
    (Sun↔Mon edge); respects the active `boardIds` filter; empty when no actuals; multi-board day
    aggregation.
- `src/components/workload/CapacityCell.test.tsx` (extend): `metric="variance"` renders signed
  delta + pct + correct `data-state`; `—` when pct null.
- New `src/components/workload/DayActualsPopover.test.tsx`: renders one row per in-week day with
  correct hours; muted empty days; closed by default; opens on trigger.

**Self-check before "done":** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green
(in-worktree — `start-task.sh` already ran `pnpm install`).

## 7. Migration / type-regen / ledger-drift note

**Recommended scope adds no migration**, so none of this applies — called out so the build agent
does NOT reach for the DB. **IF** review elects to also build (b) or per-entry drill-down (§9 Q1/Q2),
that requires a new RPC and therefore:

- a **versioned** file `supabase/migrations/<UTC-timestamp>_<name>.sql` (never dashboard
  click-ops), then `pnpm db:types`, committing `src/types/database.types.ts` in the **same** change;
- and it hits the **migration-ledger-drift trap**: cloud applies in this repo have historically gone
  in via the SQL editor / MCP under application-time timestamps, drifting
  `supabase_migrations.schema_migrations.version` away from the committed filename. Before any
  `db push`, gate with `supabase migration list --linked` and **relabel the orphan ledger row in
  place** rather than re-pushing — per `vault/decisions/2026-06-22-gotcha-34-migration-ledger-drift-recurs-on-throwaway-applies.md`
  and `…-gotcha-29-…`. This is exactly why the recommended slice avoids the DB.

## 8. Independent units (for the execution DAG)

- **U-math** — pure variance + `actualsForCell` helpers in `rollup.ts` + types. No UI dep.
- **U-cell** — `CapacityCell` variance render. Depends on U-math (types + `varianceState`).
- **U-popover** — `DayActualsPopover` component. Depends on U-math (`actualsForCell` + `DayActual`).
- **U-grid** — `WorkloadGrid` wiring: 4th metric button, cell click → popover, row-level variance in
  `MemberRowHeader`. Depends on U-cell + U-popover.

U-cell and U-popover are independent of each other (different files, both only consume U-math) → one
parallel batch. Full DAG in the plan.

## 9. Open questions / decisions for review ← **review these before building**

**Q1 — Drill-down granularity: per-day (recommended) vs per-entry.**
Recommended: per-day totals reusing the already-loaded `actuals` (0 migration, 0 refetch). The
alternative — listing individual `time_entries` sessions (start/end time, item name) per day — needs
a **new bounded RPC** (`workload_actuals_detail(user, board, from, to)`) + its live RLS test + the
ledger-drift dance. **Decision: ship per-day now, defer per-entry?** (My rec: yes.)

**Q2 — Running-timer (b): defer (recommended) vs include.**
Recommended: defer; if ever wanted, model it as a separate explicitly-"live" annotation, not folded
into the historical bucket (non-determinism / SSR-CSR clock invariant). **Decision: defer (b)?**
(My rec: yes.)

**Q3 — Variance "on-plan" tolerance band.**
For `varianceState`, within how many % of plan reads as neutral "on plan" vs over/under? Proposed
default **±10%** (i.e. `|actual − planned| / planned ≤ 0.10` ⇒ "on"). Adjustable; affects coloring
only, not the displayed numbers. **Decision: ±10% OK?**

**Q4 — Variance baseline when `planned === 0`.**
If a member logged actuals against a week with **no** planned effort, pct is undefined. Proposed:
show the signed secs delta (e.g. `+4h`) with pct rendered `—`, colored `over` (any unplanned actual
is "over zero plan"). **Decision: treat unplanned-actuals as `over` with `—` pct?** (My rec: yes.)

**Q5 — Does variance get its own column/summary, or only recolor cells?**
Recommended (YAGNI): variance is just a 4th **metric mode** that recolors/relabels the existing
cells + row header — no new columns, no new layout. A dedicated "variance report" view is out of
scope. **Decision: metric-mode only, no separate report view?** (My rec: yes.)

## 10. Estimated size

**Small.** ~4 focused tasks, all in `src/lib/workload/` + `src/components/workload/`, **no DB
work** under the recommended scope. Mostly pure functions + two presentational tweaks + one small
new popover component. Critical-path depth 3 (math → cell/popover → grid wiring).
