# Phase 7c — Workload / Capacity — Design

- **Date:** 2026-06-22
- **Status:** Approved (brainstorming, user-as-absent) — pending implementation plan
- **Author:** danijel + Claude (scoping agent)
- **Phase:** Phase 7 (Asana polish), slice **7c** — third and final of three independent slices
  (7a Portfolios · 7b Goals/OKRs · **7c Workload/capacity**). 7a + 7b shipped + promoted.
- **Runs parallel to:** nothing currently in flight; disjoint surface — all-new table/route/components.
  The only shared file is the sidebar **Workload** nav item (a brand-new entry, not a stub flip).

## 1. Summary

**Workload** is the Asana "Workload" view: a grid of **one row per org member** showing the work
assigned to them **bucketed over time** (a horizontal timeline of weeks), with each member's total
**effort per bucket** compared to their **capacity** so over-/under-allocation is visible at a glance.

The crucial architectural observation: **the assignments already exist.** Monolith boards already carry
the three primitives this view needs, on every board:

- **Who** — the **People column** kind (`cell_values.value = { userIds: string[] }`).
- **When** — the **Date column** kind (`cell_values.value = { date, end? }`, ISO dates).
- **How much** — **effort**, from either the **time-tracking estimate** (`cell_values.value =
{ estimateSeconds }` on a `time_tracking` column) or, as a fallback, a flat per-item default.

So Workload is overwhelmingly a **read-and-aggregate** surface, not a new entity. It scatter-reads
assigned/dated/estimated items across the boards the caller can read, scopes to the org, buckets each
assignee's effort into time windows, and renders person rows × week columns.

The **only** thing Workload needs to _persist_ that has no existing home is each member's **capacity**
(hours per working day, and which weekdays are working days). That is one small new table
(`member_capacity`) plus an org-level default. Everything else — bucketing, per-person/per-bucket
summation, splitting a multi-day item's effort across the days it spans, and over/under coloring — is
**pure, unit-testable TypeScript**, mirroring 7a's `rollup.ts` and 7b's `progress.ts`.

This follows the exact 7a/7b template: org-scoped table with `is_org_member` RLS, one **bounded**
`SECURITY DEFINER` rollup RPC returning **raw** rows, derivation in TS, in-page interactions as
**client state + History API (0 server round-trips)**, mutations as **Server Actions** with Zod at
the boundary, RLS as the security boundary, and `can_read_board` gating so unreadable boards leak
nothing.

## 2. Goals / Non-goals

**Goals**

- A `/workload` section: **one row per active org member**, a horizontal **timeline of week buckets**
  (default: the 6 weeks around "today"), each cell showing that member's **total assigned effort**
  in that week and an **over/under-capacity** indicator (color + "18h / 40h" readout). A **totals
  column** per member (sum across the visible window). A leading **"Unassigned" row** capturing
  dated/estimated items with no assignee, so work doesn't silently vanish.
- **Effort source, per item, resolved in this priority order:** (1) the item's time-tracking
  **estimate** (`estimateSeconds`); (2) else a configurable **org default per-item effort** (e.g.
  "4h per dated item with no estimate"); items with **no date** are excluded (nothing to bucket).
  Effort for a multi-day item (`date`→`end`) is **spread evenly across the working days** it spans,
  then re-bucketed into weeks — so a 2-week task doesn't dump 40h into one cell.
- **Effort split across multiple assignees:** an item assigned to N people contributes its effort to
  **each** assignee (Asana's model — each person "carries" the task). This is a deliberate choice,
  documented; a future toggle could divide instead.
- **Per-member capacity:** each member has `hours_per_day` and a working-day mask (which weekdays
  count). An **org default** seeds members who haven't customized. A member's bucket **capacity** =
  `hours_per_day × (working days in that bucket)`. Capacity is **editable** (member themselves, or an
  org owner/admin) via a small inline editor.
- **In-page controls = 0 server round-trips:** scroll/shift the visible week window, change bucket
  granularity is **out of scope for v1** (weeks only), sort members (by name / by total load),
  filter by workspace or board — all **client state + History API** over the already-loaded
  raw rows. Changing the **window** _may_ need more data (see §4 budget) — v1 loads a **bounded
  horizon** up front so windowing within it is also 0-refetch.
- A single **bounded** rollup RPC produces all raw (member, item, effort, date-range) rows the caller
  can see in one read; bucketing + summation + capacity comparison happen in pure TS.
- RLS-enforced, org-scoped; `can_read_board` gates contributing items (unreadable boards contribute
  nothing — no leak). Capacity edits gated: self **or** org owner/admin.
- Tests: bucketing/spreading/capacity math (unit), RPC + RLS + `can_read_board` + capacity-edit gate
  (live integration), one e2e.

**Non-goals (YAGNI — possible future slices)**

- **Actuals-based workload** (bucketing `time_entries` instead of estimates). v1 buckets _planned_
  effort (estimates / default). The `time_entries` table is the donor for a future "actual vs.
  planned" overlay, not v1.
- **Day or month granularity / a draggable Gantt-like reschedule** from the workload view. v1 is
  read-only week buckets; you reschedule on the board, not here.
- **Reassigning / changing effort from the workload grid.** v1 is a read-only roll-up except for the
  capacity editor. (Rescheduling/reassigning stays on the board surface.)
- **Cross-org or portfolio-scoped workload.** Org-wide only (like Portfolios/Goals).
- **Per-item effort weighting beyond estimate-or-default**, story points, or non-time effort units.
- **Time-off / holidays / PTO calendars** reducing capacity. v1 capacity is a flat weekday mask +
  hours/day. (PTO is the obvious next capacity slice.)
- **Realtime** live updates (read on navigation / revalidation, not a Realtime subscription).
- **Splitting one item's effort _across_ its assignees** (v1 gives each assignee the full effort —
  see Goals); a "divide among assignees" toggle is a future option.

## 3. Data model

One new small table plus an org-default column. Both follow repo conventions: denormalized `org_id`,
RLS via `is_org_member(org_id)`, `created_at` / `updated_at`.

### 3.1 `member_capacity`

Per-member working capacity. Sparse: a row exists only for members who have customized; everyone
else falls back to the org default (§3.2). One row per `(org_id, user_id)`.

| column          | type        | notes                                                                            |
| --------------- | ----------- | -------------------------------------------------------------------------------- |
| `id`            | uuid pk     |                                                                                  |
| `org_id`        | uuid        | FK `organizations`, denormalized; RLS key                                        |
| `user_id`       | uuid        | FK `auth.users`; the member this capacity applies to                             |
| `hours_per_day` | numeric     | working hours on a working day (CHECK `>= 0 and <= 24`)                          |
| `working_days`  | int2[]      | ISO weekday numbers that count as working (1=Mon … 7=Sun); default `{1,2,3,4,5}` |
| `created_by`    | uuid        | FK `auth.users`                                                                  |
| `created_at`    | timestamptz | default now()                                                                    |
| `updated_at`    | timestamptz | trigger-maintained (`set_updated_at`)                                            |

Unique `(org_id, user_id)`. Index on `(org_id)`. RLS: read if `is_org_member(org_id)`; write
(insert/update/delete) gated by **`can_edit_member_capacity(org_id, user_id)`** = `user_id =
auth.uid()` **OR** `has_org_role(org_id, {owner, admin})` (the 7a/7b gate shape).

### 3.2 Org default capacity

Workload needs a default for members with no `member_capacity` row. Rather than a second table, add
two nullable columns to `organizations` (org settings already live there), with app-layer fallback
constants if null:

| column                   | type    | notes                                                                     |
| ------------------------ | ------- | ------------------------------------------------------------------------- |
| `default_hours_per_day`  | numeric | nullable; app fallback `8` when null                                      |
| `default_per_item_hours` | numeric | nullable; app fallback `4` — effort for a dated item that has no estimate |

> **Open question Q1** (see §9): if amending `organizations` is undesirable (touches a core table),
> the fallback is a tiny `org_workload_settings(org_id pk, default_hours_per_day, default_per_item_hours,
default_working_days)` table instead. The plan defaults to the **separate `org_workload_settings`
> table** to keep the core `organizations` table untouched — confirm.

### 3.3 No new table for assignments

Assignments, dates, and estimates are **read** from existing `cell_values` (`people`, `date`,
`time_tracking` kinds) + `columns` + `items` + `boards`. Workload stores **nothing** about
individual assignments — it derives them every read from the boards the caller can see.

## 4. Rollup RPC + derivation (the heart of the slice)

### 4.1 `workload_rollup(p_from date, p_to date)` — bounded raw read

One `SECURITY DEFINER` RPC returns, for the caller's org, every **assigned, dated** item whose date
range overlaps `[p_from, p_to]`, on a board the caller **can read**, with its effort and assignees.
Returns **raw rows** — no bucketing, no per-person sums (those are TS):

```
returns table (
  item_id        uuid,
  board_id       uuid,
  item_name      text,
  user_id        uuid,        -- one row per assignee per item; NULL ⇒ unassigned
  start_date     date,        -- from the resolved date column's value.date
  end_date       date,        -- value.end ?? value.date
  estimate_secs  bigint       -- from the item's time_tracking estimate cell, or NULL
)
```

Shape and bounding:

- **Date column resolution:** per board, pick the board's date column (first `date` kind, mirroring
  `resolveDateColumn`). Items with no value in that column are **excluded** (nothing to bucket).
- **Effort:** `estimate_secs` from the item's `time_tracking` estimate cell (`value->>'estimateSeconds'`)
  if present, else `NULL` (TS applies the org `default_per_item_hours`).
- **Assignees:** unnest the people cell's `value->'userIds'`; **one output row per (item, assignee)**.
  An item with no assignee (or no people column) yields **one row with `user_id = NULL`** (the
  Unassigned bucket).
- **Security:** `where public.is_org_member(org_id) and public.can_read_board(board_id)` — unreadable
  boards contribute nothing. Excludes **subitems** (`items.parent_id is null`), matching the 7b
  rollup convention (avoids double-counting).
- **Bounded:** filtered to the `[p_from, p_to]` horizon (overlap test on date range) and to indexed
  columns (`items.board_id`, `cell_values(item_id, column_id)`). The horizon is a **fixed default
  span** (e.g. today − 2 weeks … today + 10 weeks ≈ 12 weeks) so the result set is bounded by
  "dated/assigned items in a 3-month window," not the whole org. A hard server-side row cap (e.g.
  `LIMIT 5000`) is the backstop; the UI shows a "showing first N" note if hit (Q2).

### 4.2 Pure TS derivation — `src/lib/workload/rollup.ts`

Raw rows → grid, all pure and unit-tested:

- **`spreadItemEffort(row, effortSecs, workingDays)` → `Map<isoDate, secs>`:** spread an item's
  effort evenly across the **working days** (per a weekday mask) in `[start_date, end_date]`. If the
  range has no working days (e.g. a weekend-only single day), fall back to the start day so effort is
  never dropped. A single-day item puts all effort on that day.
- **`bucketByWeek(perDay, weekStart)` → `Map<weekKey, secs>`:** roll per-day effort up into ISO week
  buckets aligned to a configurable week-start (Mon default). `weekKey` = the bucket's start ISO date.
- **`buildWorkloadGrid(rows, members, capacities, orgDefaults, window, today)` → `WorkloadGrid`:**
  the top-level assembler. For each raw row: resolve `effortSecs` (estimate or `default_per_item_hours`),
  `spreadItemEffort` using **that assignee's** working-day mask, bucket by week, and accumulate into
  `grid[userId][weekKey]`. Produces, per member: an ordered list of bucket cells `{ weekKey,
effortSecs, capacitySecs, ratio }` where `capacitySecs = hours_per_day × workingDaysInBucket`, plus
  a row total. A synthetic **`unassigned`** member row collects `user_id = NULL` rows (capacity = 0,
  ratio always "over"). Members with zero effort across the window still render (a row of empty
  cells) so the team roster is complete.
- **`capacityState(effortSecs, capacitySecs)` → `'under' | 'at' | 'over' | 'none'`:** the cell color
  bucket (`none` when capacity is 0/undefined, e.g. a non-working week or the unassigned row).
- **`buildWindow(today, weeksBack, weeksFwd, weekStartsOn)` → `WeekBucket[]`:** the ordered list of
  visible week buckets (key + label + working-day count), so columns and capacity share one source.

Unit tests cover: estimate-vs-default effort selection; even spread across working days (incl.
weekend exclusion and the no-working-day fallback); multi-week spanning into multiple buckets;
multi-assignee duplication; the unassigned bucket; capacity = hours×working-days; `capacityState`
thresholds; empty/zero rows; window construction around an arbitrary "today".

## 5. RPCs / RLS

Org-scoped, `is_org_member(org_id)`. Reads via the one bounded RPC; capacity writes via direct
`can_edit_member_capacity`-gated table writes (the 7a "direct gated update" pattern — no RPC needed
for a single-row upsert).

- **`workload_rollup(p_from date, p_to date)`** (read, SECURITY DEFINER) — §4.1. `grant execute … to
authenticated`. Internally `is_org_member` + `can_read_board` gated; not REST-exposed beyond the
  `authenticated` execute grant.
- **`can_edit_member_capacity(p_org_id uuid, p_user_id uuid)`** (SECURITY DEFINER, stable) —
  `p_user_id = auth.uid() OR has_org_role(p_org_id, {owner, admin})`.
- **`upsertMemberCapacity`** — _Server Action_, not an RPC: a direct `member_capacity`
  insert-on-conflict-update gated by RLS (the policy calls `can_edit_member_capacity`). Mirrors 7a's
  `updatePortfolioPlacement` direct-PATCH approach. (RLS is the real boundary; the action just
  validates + revalidates.)
- **Org defaults** read in the page query; written by a `setWorkloadDefaults` Server Action gated to
  org owners/admins (RLS on `org_workload_settings`).

RLS policies on `member_capacity`: SELECT if `is_org_member(org_id)`; INSERT/UPDATE/DELETE
`with check`/`using` `can_edit_member_capacity(org_id, user_id)`. On `org_workload_settings`: SELECT
if member; write if `has_org_role(org_id, {owner, admin})`. The rollup's contributing items inherit
existing `cell_values` / `items` / `boards` RLS **and** the explicit `can_read_board` gate in the RPC.

## 6. UI

- **`/workload`** (RSC) calls `workload_rollup(from, to)` for the default horizon, plus
  `listOrgMembers`, `member_capacity`, and org defaults — all in parallel — assembles the grid in TS
  via `buildWorkloadGrid`, and passes a serializable grid to the client.
- **`WorkloadGrid`** (client, `"use client"`): a sticky-left **member column** (avatar + name +
  row-total) and a horizontally scrollable band of **week columns**. Each cell shows the bucket
  readout (`18h / 40h`) and a capacity color (under = muted, at = accent, over = warning), following
  the **pulse-ui** monochrome + single-accent system. The leading **Unassigned** row is visually
  distinct. **Sort** (name / total load) and **filter** (workspace / board) are **client state +
  History API** (`window.history.pushState`, read via `useSearchParams`) — **0 refetch**, exactly the
  `PortfolioGrid` pattern. Window-shift (prev/next weeks) pans within the **already-loaded horizon**
  (0 refetch); only paging _beyond_ the horizon triggers a fresh RSC load (rare; see §4 budget).
- **`CapacityEditor`** (client popover, the `EditPlacementPopover` idiom): on a member row, edit
  `hours_per_day` + working-day mask; calls `upsertMemberCapacity`. Visible/enabled for self or org
  admins; read-only otherwise.
- **`WorkloadDefaultsDialog`** (client, org-admin only): set `default_hours_per_day` +
  `default_per_item_hours` (+ default working days); calls `setWorkloadDefaults`.
- **`CapacityCell` / `MemberRowHeader`** render bits, mirroring `ProgressBar` / `HealthPill`.
- **Sidebar:** add a **new** `Workload` nav item (`Gauge` or `Users` lucide icon, `href: "/workload"`)
  to `src/components/sidebar.tsx`, and extend the `app-shell.test.tsx` nav assertions to expect the
  live `/workload` link (this is a _new_ item, not the disabled-stub flip 7a/7b did).
- **`/workload/layout.tsx`** mirrors `src/app/portfolios/layout.tsx` — same `requireUser()` +
  `AppShell` shell.

UI work loads the **`pulse-ui`** project skill and the generic **`frontend-design`** skill at build
time (per AGENTS.md #3) — colors, tokens, app primitives, and the capacity color semantics.

## 7. Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** one RSC pass = `workload_rollup(from, to)` over the **bounded default horizon**
  (≈12 weeks) + `listOrgMembers` + `member_capacity` SELECT + org defaults, in parallel. Grid
  assembly (spread + bucket + capacity) is **pure TS**, no extra round-trips.
- **Each interaction:**
  - Sort members, filter by workspace/board, shift the visible week window **within the loaded
    horizon**, open/close the capacity editor → **client state + History API, 0 new server
    round-trips** (read from the already-loaded grid; AGENTS.md gotcha-09).
  - Paging the window **beyond** the loaded horizon → a fresh RSC load with a new `?from/&to` (rare;
    explicitly an RSC navigation because it genuinely needs more server data). v1's 12-week default
    makes this uncommon.
  - **Changes server data:** edit a member's capacity (`upsertMemberCapacity`) or org defaults
    (`setWorkloadDefaults`) → **Server Action + `revalidatePath("/workload")`** (targeted).
- **Bounded over indexed columns:** the rollup is filtered to the horizon and to indexed columns
  (`cell_values(item_id, column_id)` exists; `items(board_id)` exists), excludes subitems, gated by
  `can_read_board`, with a server-side `LIMIT` backstop. No unbounded `select *` over a growing
  table on the hot path. `member_capacity` is org-bounded (one row per member at most).

## 8. Build sequencing (for the plan)

Maximally parallel after a migration root, the 7a/7b shape:

1. **Migration root** — `member_capacity` table + `org_workload_settings` (or org columns),
   `set_updated_at` trigger, RLS, `can_edit_member_capacity`, the `workload_rollup` RPC, grants;
   regenerate types. (Timestamp after the latest existing migration.)
2. **Wave (parallel):** `rollup.ts` (pure, TDD) ‖ Zod validations ‖ queries (RSC) ‖ Server actions
   (`upsertMemberCapacity` / `setWorkloadDefaults`) ‖ live RLS integration test.
3. **Wave:** `WorkloadGrid` + `CapacityEditor` + `WorkloadDefaultsDialog` + render bits.
4. **Wire-up:** `/workload` route + new sidebar link (+ `app-shell.test.tsx`); e2e; full gate
   (typecheck · lint · unit · live integration · build · e2e). Build-in-main for a clean compile
   graph per the worktree-gates note; merge via `finish-task.sh`.

## 9. Open questions

These are the decisions made under user-as-absent; flag for confirmation before/at build:

- **Q1 — Org defaults home.** Default to a **separate `org_workload_settings` table** (keeps the core
  `organizations` table untouched) vs. two nullable columns on `organizations`. Plan assumes the
  separate table. _Confirm._
- **Q2 — Horizon + cap.** Default visible window = **6 weeks** (today − 1 … today + 4); loaded
  horizon = **12 weeks** (today − 2 … today + 10) so windowing is 0-refetch; server `LIMIT 5000`
  backstop. _Confirm the spans._
- **Q3 — Effort fallback.** For a **dated item with no estimate**, use `default_per_item_hours`
  (fallback 4h). Alternative: exclude no-estimate items entirely (cleaner, but hides real work).
  Plan assumes **include with default**. _Confirm._
- **Q4 — Multi-assignee.** Each assignee carries the **full** item effort (Asana model) vs. dividing
  effort among assignees. Plan assumes **full to each**. _Confirm._
- **Q5 — Effort = estimate (planned), not `time_entries` (actuals).** v1 buckets _planned_ effort;
  actuals overlay is a future slice. _Confirm v1 is planned-only._
- **Q6 — Date column choice per board.** Use the board's **first `date` column** (the
  `resolveDateColumn` convention). Boards with multiple date columns can't yet choose which drives
  workload. _Confirm first-date-column is acceptable for v1._

None of these block writing the implementation plan; each has a stated default the plan builds to.
