# Phase 7b — Goals / OKRs — Design

- **Date:** 2026-06-21
- **Status:** Approved (brainstorming) — pending implementation plan
- **Author:** danijel + Claude
- **Phase:** Phase 7 (Asana polish), slice **7b** — second of three independent slices
  (7a Portfolios · **7b Goals/OKRs** · 7c Workload/capacity)
- **Runs parallel to:** 6d-3 (mirror aggregation). Disjoint surfaces — all-new tables/route/components;
  the only shared file is the sidebar **Goals** stub flip. Migration timestamp must post-date 6d-3's.

## 1. Summary

A **Goal** is a recursive, measurable objective. Each goal has a measurable progress reading and can
have **sub-goals** and **contributing boards**, so progress cascades **bottom-up** — the
company→team→individual roll-up the PRD calls for (§4.3 Asana polish; master spec §3 "Goals/OKRs
(company→team→individual) with contributing work auto-rolling up", schema hint `goals, goal_links`).

We model a **single recursive `goals` entity** (Asana-style), not a fixed Objective→Key-Results pair.
A goal measures progress one of **four ways** (`progress_mode`), picked per goal:

- `manual_number` — owner-set `current` against `target` from a `start` baseline, with a `unit`
  (e.g. 0→100 "signups"). The classic measurable KR.
- `manual_percent` — a single owner-set 0–100% (for fuzzy goals with no clean metric).
- `auto_subgoals` — progress = equal-weight average of this goal's children's computed progress.
- `auto_boards` — progress = share of "done" items across linked boards, using a per-board
  completion mapping (reuses 7a's mapping shape + the dashboard-aggregate spine).

Goals are **org-wide, cross-workspace** exec objects (like Portfolios), each **person-owned** with an
optional **workspace** association standing in for "team" (Monolith has no teams entity). Surfaced at
`/goals` (the sidebar already carries a disabled **Goals** stub awaiting this slice).

Status is **hybrid, Portfolio-style**: a manual `status` (On track / At risk / Off track / Done) that
the owner sets and that **wins for display**, plus an **auto-suggested health** computed from pace
(progress vs time elapsed) shown as a `·auto` hint.

## 2. Goals / Non-goals

**Goals**

- A `/goals` section: an expandable **tree** of goals (parents expand to sub-goals) with progress
  bar + status pill + owner per row; a `?goal=` **detail drawer** to edit a goal and manage its
  sub-goals and board links.
- Four `progress_mode` measurement methods (above), via a discriminated-union/switch pattern.
- Recursive **single-parent tree** (company→team→individual), cycle-guarded and depth-capped.
- Org-wide, cross-workspace; **person-owned**; optional workspace tag.
- Hybrid status: manual status wins; auto-health suggested from pace as a hint.
- A single **bounded** rollup RPC produces all rows + board aggregates in one read; tree assembly,
  progress, and bottom-up sub-goal roll-up happen in **pure, unit-testable TS**; in-page
  expand/sort/filter add **zero** server round-trips (client state + History API).
- RLS-enforced and org-scoped; `auto_boards` respects `can_read_board` (unreadable boards
  contribute nothing — no leak). `can_edit_goal` = creator **or** owner **or** org admin.
- Tests: progress math (unit), RPC + RLS + cycle guard (live integration), one e2e.

**Non-goals (YAGNI — possible future slices)**

- **Check-in / update history** (periodic status posts with a note). v1 edits the *current* progress
  in place; no time-series log.
- **Per-child weighting** for sub-goal roll-up (v1 is equal-weight average).
- **Structured cycles / time-periods entity** (e.g. a managed "Q3 2026" / "FY26"). v1 uses free-form
  `start_date` / `due_date` per goal.
- **Portfolios (or other goals across orgs) as contributors** — contributing work is sub-goals +
  boards only.
- **Multi-parent / DAG** goals (single parent only).
- **Realtime** live updates (read on navigation / revalidation, not a Realtime subscription).
- **Notifications** on goal status/owner change.
- Goal-level **sharing ACLs** beyond "org-visible / creator+owner+admin-edit".

## 3. Data model

Two new tables. Both follow repo conventions: denormalized `org_id` on every row, RLS via
`is_org_member(org_id)`, `position` float8 for sibling ordering (midpoint-reorder pattern),
`created_by`, `created_at` / `updated_at`.

### 3.1 `goals`

| column            | type        | notes                                                                                 |
| ----------------- | ----------- | ------------------------------------------------------------------------------------- |
| `id`              | uuid pk     |                                                                                       |
| `org_id`          | uuid        | FK `organizations`, denormalized; RLS key                                             |
| `name`            | text        | required, non-empty (CHECK)                                                            |
| `description`     | text        | nullable                                                                              |
| `owner_id`        | uuid        | FK `users` (the member who owns the goal); required                                   |
| `workspace_id`    | uuid        | FK `workspaces`, **nullable** — soft "team" tag; must be same org (guarded)           |
| `parent_goal_id`  | uuid        | FK `goals` self-ref, **nullable**; must be same org; cycle/depth guarded              |
| `progress_mode`   | enum        | `manual_number \| manual_percent \| auto_subgoals \| auto_boards`                      |
| `status`          | enum        | `on_track \| at_risk \| off_track \| done` (manual; default `on_track`)               |
| `start_value`     | float8      | `manual_number` baseline (default 0)                                                  |
| `current_value`   | float8      | `manual_number` current                                                               |
| `target_value`    | float8      | `manual_number` target                                                                |
| `unit`            | text        | `manual_number` unit label (nullable)                                                 |
| `percent`         | float8      | `manual_percent` 0–100 (nullable)                                                     |
| `start_date`      | date        | nullable                                                                              |
| `due_date`        | date        | nullable                                                                              |
| `position`        | float8      | order among siblings (same `parent_goal_id`)                                          |
| `created_by`      | uuid        | FK `users`                                                                            |
| `created_at`      | timestamptz | default now()                                                                         |
| `updated_at`      | timestamptz | trigger-maintained                                                                    |

Mode-specific columns are nullable and only meaningful for their mode; a CHECK or app-layer Zod
guard enforces the shape per `progress_mode` (e.g. `manual_number` requires `target_value`). Reads
ignore irrelevant columns (auto modes derive, never read these).

**Integrity triggers (BEFORE INSERT/UPDATE):**

- **Same-org parent / workspace**: `parent_goal_id` and `workspace_id`, when set, must reference rows
  in the same `org_id` (analogue of existing same-org guards).
- **Cycle + depth guard**: walk `parent_goal_id` ancestors; reject if `NEW.id` appears (a loop) or if
  depth exceeds a cap (e.g. 6 levels). Same spirit as the subitems single-level trigger and the
  `item_dependencies` cycle guard. A goal cannot be its own parent.

### 3.2 `goal_links`

Board contributions for `auto_boards`, reusing 7a's per-board completion-mapping shape.

| column             | type     | notes                                                        |
| ------------------ | -------- | ------------------------------------------------------------ |
| `id`               | uuid pk  |                                                              |
| `org_id`           | uuid     | denormalized; RLS key                                        |
| `goal_id`          | uuid     | FK `goals` on delete cascade                                 |
| `board_id`         | uuid     | FK `boards`                                                  |
| `status_column_id` | uuid     | which status column on that board marks completion           |
| `done_option_ids`  | uuid[]   | which option(s) of that column count as "done"               |

Unique `(goal_id, board_id)`. RLS: `is_org_member(org_id)`; the **read** of contributing aggregates is
additionally gated by `can_read_board` so a goal viewer who can't see a board gets no rows/credit from
it. Only meaningful when the owning goal's `progress_mode = auto_boards`.

## 4. Progress & health derivation (pure TS — `src/lib/goals/progress.ts`)

The bounded rollup RPC (§5) returns raw `goals` rows + per-linked-board aggregates. All derivation is
pure TS, mirroring 7a's `progressPct` / `computeAutoHealth` / `mergeRows`:

- **`goalProgress(goal, ctx)` → 0..1 | null:**
  - `manual_number`: `clamp01((current − start) / (target − start))`; `null` if `target === start`.
  - `manual_percent`: `clamp01(percent / 100)`.
  - `auto_boards`: `Σ done / Σ total` across the goal's readable linked-board aggregates;
    `null` if total is 0.
  - `auto_subgoals`: equal-weight average of children's `goalProgress`; children with `null`
    progress are excluded from the average; `null` if no child yields a number.
- **Tree assembly + bottom-up roll-up:** build the parent→children map once, then compute progress
  **post-order** so a parent's `auto_subgoals` sees already-computed children. Memoize per node; the
  cycle guard at write-time means the in-memory graph is a DAG-free tree, but the walker still guards
  against a malformed cycle defensively (visited-set).
- **`computeAutoHealth(progress, start_date, due_date)`** (reused from 7a): compares progress to time
  elapsed → suggested `on_track | at_risk | off_track`. Displayed as a `·auto` hint next to the
  manual `status`, which is authoritative.

Unit tests cover each mode, the post-order cascade (a 3-level tree with mixed modes), `null`
handling, and auto-health thresholds.

## 5. RPCs / RLS

Org-scoped, `is_org_member(org_id)`. Writes go through gated `SECURITY DEFINER` RPCs mirroring 7a;
reads via one bounded RPC. **`can_edit_goal(goal_id)`** = `created_by = auth.uid()` **OR**
`owner_id = auth.uid()` **OR** `is_org_admin(org_id)`.

- **`create_goal(...)`** — insert a goal (validates parent/workspace same-org via the triggers);
  returns the row. Caller must be an org member; sets `created_by = auth.uid()`.
- **`update_goal(goal_id, ...)`** — patch fields (name/desc/owner/workspace/dates/mode + mode
  fields/status/parent). Gated on `can_edit_goal`. Reparenting re-runs the cycle/depth guard.
- **`set_goal_links(goal_id, links[])`** — atomic replace of the goal's board links + mappings (the
  `set_relation_links` / portfolio add-board pattern). Gated on `can_edit_goal`; each `board_id`
  checked `can_read_board` for the caller.
- **`reorder_goal(goal_id, new_position)`** — midpoint reorder among siblings. Gated on
  `can_edit_goal`.
- **`goals_rollup()`** (read) — returns, in one bounded call: all org goals the caller can see, plus
  for every `auto_boards`-linked board the `{ goal_id, board_id, done, total }` aggregate **filtered
  to boards the caller can read** (`can_read_board`). Reuses the 7a `portfolio_rollup` /
  `dashboard_aggregate` aggregation spine. Tree assembly + progress happen client/server-side in TS,
  not in SQL.

RLS policies: `goals` and `goal_links` are SELECT-able by org members; writes only via the RPCs
above (table-level write policies restricted, definer functions own the mutation), consistent with the
post-advisor-cleanup posture (definer functions not REST-exposed to `anon`; `authenticated` execute
only on the public RPCs, not internal `_` helpers).

## 6. UI

- **`/goals`** (RSC) calls `goals_rollup`, assembles the tree + progress in TS, passes a serializable
  tree to the client.
- **`GoalTree`** (client): expandable rows — chevron + indent by depth, goal name, **progress bar**,
  **status pill** (manual status; `·auto` health hint), **owner** avatar, and the measurable readout
  (`42 / 100 signups`, `60%`, or rolled-up %). Expand/collapse, sort, and filter are **client state +
  History API** — zero refetch (the 7a `PortfolioGrid` pattern). "New goal" button.
- **`?goal=<id>` detail drawer** (the item-panel History-API drawer pattern, 0 RSC refetch): edit
  name / description / owner / workspace / dates / `status`; switch `progress_mode` and edit its
  fields; **add sub-goals** (creates a child under this goal); **manage board links** with the 7a
  completion-mapping picker (reused `AddBoardDialog` mapping UI); shows the auto-health hint and the
  rolled-up readout.
- **`NewGoalDialog`** — name, owner, optional parent goal, optional workspace, `progress_mode` +
  mode-specific fields, dates.
- Wire the existing **disabled Goals sidebar stub live** (`src/components/sidebar.tsx` — `Target`
  icon) and flip the assertion in `src/components/app-shell.test.tsx` (currently asserts Goals
  disabled), exactly as 7a did for Portfolios.

## 7. Testing

- **Unit (`progress.ts`):** each of the 4 modes; post-order cascade over a 3-level mixed-mode tree;
  `null`/empty handling; `computeAutoHealth` thresholds; `clamp01`.
- **Live integration (RLS):** `create_goal` / `update_goal` / `set_goal_links` happy paths; **cycle
  guard** rejects a reparent that loops; **depth cap** rejects; **cross-org isolation** (member of A
  can't read/edit B's goals); **`can_edit_goal`** gate (non-owner non-admin member denied);
  **`auto_boards` respects `can_read_board`** (a goal linking a board the viewer can't read yields no
  credit and no leaked rows).
- **e2e (1):** create a parent goal (`auto_subgoals`) + two children (one `manual_number`, one
  `auto_boards` linked to a board) → progress cascades into the parent; open the drawer, change
  `status`, see the pill update.

## 8. Build sequencing (for the plan)

Maximally parallel after a migration root, the 7a shape:

1. **Migration root** — `goals` + `goal_links` tables, enums, triggers (same-org, cycle/depth),
   RLS, the 5 RPCs; regenerate types. (Timestamp **after** 6d-3's.)
2. **Wave (parallel):** `progress.ts` (pure, TDD) ‖ server actions/queries (`create/update/
   set_goal_links/reorder/rollup`) ‖ `GoalTree` ‖ detail drawer ‖ `NewGoalDialog`.
3. **Wire-up:** `/goals` route + live sidebar link (flip `app-shell.test.tsx`); e2e; gate
   (typecheck · lint · unit · live integration · build · e2e). Build-in-main for a clean compile
   graph per the worktree-gates note; merge via `finish-task.sh`.

## 9. Open questions

None blocking. Confirmed in brainstorming: recursive single-entity model; all four progress modes;
org-wide person-owned + optional workspace; free-form dates (no cycles entity); manual status +
auto-health hint; tree list + detail drawer; equal-weight sub-goal averaging; roll-up assembled in TS
off a bounded RPC (Approach B).
