# Time Allocation + Workload Polish — Design Spec

**Date:** 2026-06-23
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** Danijel Jovanovic (with Claude)

## Summary

Add a ServiceNow-style **weekly time card** ("My Time") where each person logs
decimal hours per task per day, saved as-you-go (no approval). Rows are board
**items** or free-text **categories**. Manual entries and the existing start/stop
timer both roll up into **one actuals ledger** that the Workload page reads. The
Workload page is reworked from a narrow scroll-table into a **full-canvas expanded
capacity grid**.

## Decisions (locked during brainstorming)

| Question              | Decision                                                                |
| --------------------- | ----------------------------------------------------------------------- |
| Primary entry surface | **Weekly time card** (dedicated page), not in-task quick-log            |
| Approval workflow     | **None** — save as you go (can add submit/approve later)                |
| Row types             | **Items + categories**; categories are **free text** (presets + custom) |
| Timer relationship    | **Both feed one ledger** — timer + manual summed everywhere             |
| Who can edit          | **Self only** (org members can read; only you write your own)           |
| Row population        | **Auto + add** — assigned/active items pre-load; "+ Add row" picker     |
| Input format          | **Decimal hours** (`2.5`)                                               |
| Workload bucket       | **Week buckets** (overview); the card is **daily**                      |
| Workload layout       | **Expanded capacity grid** (Option A), full-canvas                      |

## Non-goals (YAGNI)

- No submission/approval workflow (designed so it can be added later).
- No in-task quick-log surface beyond the existing timer (the card is the entry point).
- No manager/admin editing of others' time cards.
- No master/detail or heatmap Workload layout (Option A only).
- No category admin table/UI — categories are free text with suggestions.

## Data model

### New table `time_allocations` (manual entries only)

Timers stay in the existing `time_entries` table. This table holds **manual**
allocations only.

- `id uuid pk`
- `org_id uuid not null`
- `user_id uuid not null` — the person whose time this is (self-only writes ⇒ `= auth.uid()`)
- `work_date date not null`
- `item_id uuid null` (FK `items`) **or** `category text null` — **exactly one set** (CHECK)
- `board_id uuid null` — denormalized from the item for filtering/RLS; `null` for categories
- `duration_secs integer not null check (duration_secs > 0)`
- `note text null`
- `created_at, updated_at timestamptz`

**Constraints / indexes:**

- CHECK: `(item_id is not null) <> (category is not null)` — exactly one populated.
- Partial unique index `(user_id, work_date, item_id) where item_id is not null`.
- Partial unique index `(user_id, work_date, category) where category is not null`.
  → one row per task/category per day per user ⇒ editing a cell is an **upsert**.
- Index `(org_id, user_id, work_date)` (hot path: a person's week).
- Index `(item_id)` (item Time-tab reads).

**RLS:**

- `SELECT`: any member of `org_id` (so Workload + item Time tab can show everyone).
- `INSERT / UPDATE / DELETE`: only where `user_id = auth.uid()` **and** member of `org_id`.

### No double-counting

`time_allocations` = manual; `time_entries` = timer. They are distinct sources, so
summing both never double-counts. A card cell **displays** the sum of (manual +
timer) for that item/day, but **editing** the cell writes only the manual portion;
timer-tracked time is shown as a read-only sub-label (e.g. "incl. 1.5h tracked").

### Categories (free text)

`category` is free text. When adding a category row the user gets:

- **Preset suggestions:** `Meetings`, `Admin`, `Internal`, `Leave/PTO`, `Other`
  (constant in `src/lib/time/categories.ts`).
- **Their previously-used categories** (`distinct category` from the user's own
  allocations).
- The ability to **type a brand-new one**.

Custom categories are personal to the user. No separate table.

## Unified actuals rollup

Extend `workload_actuals_rollup(p_from date, p_to date)` to **UNION**:

1. Timer secs from `time_entries` (`ended_at is not null`), grouped by `(user_id, board_id, day)`.
2. Manual secs from `time_allocations`, grouped by `(user_id, board_id, day)`.

Summed per `(user_id, board_id, day)`. Category rows have `board_id = null` — they
still count toward a person's utilization total; under a specific board filter they
are attributed to an "Off-board" bucket. The existing Workload
planned/actual/both/variance overlay reflects the combined ledger automatically.

## "My Time" page (`/time`)

- New route under `AuthenticatedShell`, full-canvas.
- Week navigator (`‹ Week of Jun 22 ›`); columns Mon–Sun + per-row total + per-day
  totals + week total.
- **Row population (auto + add):** pre-loads (a) items where the user is in the
  people column on readable boards, (b) items the user has timer/manual time against
  this week; plus a "+ Add row" picker to search items across readable boards or add
  a category (with suggestions).
- **Cells:** decimal-hours input (`2.5`), validated `0 ≤ h ≤ 24`. Blur/Enter upserts
  via Server Action with optimistic update. Empty cell = no row written; clearing a
  cell deletes the row.
- **Week switching is client state + History API** (`?week=` via `pushState`) —
  **0 RSC refetch** within the loaded horizon; only crossing the horizon hits the
  server. (Per AGENTS.md §5 / gotcha-09.)

## Workload page redesign (Option A — full-canvas)

- Remove width/centering constraints; page container becomes `flex h-full` filling
  the canvas.
- **Member column:** avatar + name + **utilization %** over the window.
- **Week columns:** `flex-grow` to fill available width (min-width floor);
  horizontal scroll only when weeks overflow.
- **Cells:** hours + a thin **capacity bar** colored under/at/over (reuse
  `capacityState`). Keep the planned/actual/both/variance + sort toggles unchanged.

## Shared boards behaviour

- Allocation is **per-person**: two assignees on one shared task each get their own
  `(user_id, work_date, item_id)` row — no collisions.
- Self-only writes hold: org members can **read** a teammate's per-task time; only
  the owner can edit it.
- Workload aggregates per `(user, board, day)`, so a shared board's total is the sum
  of each person's distinct contribution; a task's total effort = sum across all
  assignees of (timer + manual).
- **Privacy note (accepted):** org-wide `SELECT` means anyone can see per-person time
  on shared boards — consistent with the existing actuals overlay. Tighten later if
  needed.

## Server actions & validation

- `src/lib/time/actions.ts`: `upsertTimeAllocation`, `deleteTimeAllocation`.
- `src/lib/validations/time.ts`: Zod schemas (decimal-hours → secs, date, exactly
  one of item/category, note length).
- Self-scoped; `revalidatePath('/time')` + `revalidatePath('/workload')`.
- Follows the existing `upsertMemberCapacity` pattern (`ActionResult<T>` =
  `{ ok: true; data } | { ok: false; error }`).

## Testing & performance budget

**Tests (Vitest):**

- Hours↔secs parsing/rounding (`2.5` → 9000s; reject `>24`, `<0`, non-numeric).
- Rollup union math: timer + manual summed, **no double count**, category →
  utilization total, board filter attribution.
- Grid assembly with mixed timer + manual sources.
- Zod edge cases: `0`, `24`, negative, both `item_id` and `category` set (reject),
  neither set (reject).
- Server action auth/self-scope (cannot write another user's row).

**Performance budget (per AGENTS.md §5):**

- First paint: card loads **one week**; Workload loads its window.
- In-page week navigation + filters/sorts = **0 server round-trips** (client state +
  History API over already-loaded data).
- Reads **bounded** by date window over **indexed** `(user_id, work_date)`; no
  unbounded `select *`.

**Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
Built in a `task/time-allocation` worktree, merged to `develop`.

## Execution DAG (parallelization plan)

```
Task 1 (foundation): migration `time_allocations` + unified `workload_actuals_rollup`
                     + regen DB types
          │
          ├──────────────┬───────────────────────────────
          ▼              ▼
Task 2a: time lib +   Task 2b: Workload full-canvas
  actions + Zod         redesign (depends only on rollup)
  validations
          │
          ▼
Task 3: "My Time" page UI (depends on 2a)
```

- **Batch 1:** Task 1 (blocks everything — schema + types).
- **Batch 2:** Task 2a + Task 2b in parallel (independent; isolated worktrees).
- **Batch 3:** Task 3 (consumes 2a's lib/actions).
- **Critical path:** 1 → 2a → 3 (three waves).

## Interfaces

- **Task 1 produces:** `time_allocations` table + RLS, updated
  `workload_actuals_rollup`, regenerated `src/types/database.types.ts`.
- **Task 2a consumes:** Task 1 types/table. **Produces:** `src/lib/time/*`
  (queries, actions, rollup helpers, categories), `src/lib/validations/time.ts`.
- **Task 2b consumes:** Task 1 rollup (combined actuals). **Produces:** reworked
  `WorkloadGrid` + page layout (full-canvas).
- **Task 3 consumes:** Task 2a lib/actions. **Produces:** `/time` route +
  `src/components/time/*` (weekly card, cell editor, add-row picker).
