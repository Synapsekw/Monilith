# Time Allocation + Workload Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ServiceNow-style weekly "My Time" card where each person logs decimal hours per task/category per day, unify manual + timer time into one actuals ledger the Workload page reads, and rework Workload into a full-canvas capacity grid.

**Architecture:** A new `time_allocations` table holds **manual** allocations only (timers stay in `time_entries`); the existing `workload_actuals_rollup` RPC is extended to UNION both sources so no double-counting is possible. A new `src/lib/time/*` library (Zod validation → secs, queries, server actions) backs the `/time` weekly card. Week switching and Workload filters are pure client state via the History API (0 RSC refetch); all hot-path reads are bounded by a date window over indexed columns.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres + RLS, `security definer` rollup RPCs), Zod, Vitest + Testing Library, Tailwind v4 + shadcn/ui (`command`, `popover`, `dialog`, `avatar`, `input`).

---

## Source-of-truth references (read these first)

- **Spec:** `docs/superpowers/specs/2026-06-23-time-allocation-design.md` (Decisions table is locked).
- **Invariants:** `AGENTS.md` §§1–6 (Server Components by default; Zod at boundaries; RLS default-deny org-scoped; versioned migration + `pnpm db:types` same task; in-page state via History API = 0 refetch; bounded/indexed reads; tests mandatory; Execution DAG).
- **Migration to extend:** `supabase/migrations/20260622170000_workload_actuals.sql` (the `workload_actuals_rollup` RPC).
- **Timer table:** `supabase/migrations/20260620000001_time_entries.sql`.
- **Capacity/RLS helpers:** `supabase/migrations/20260622160000_workload.sql` (`is_org_member`, `can_read_board`, `set_updated_at`, `member_capacity` pattern).
- **Action pattern to mirror:** `src/lib/workload/actions.ts` (`upsertMemberCapacity`, `ActionResult<T>`).
- **Validation pattern to mirror:** `src/lib/validations/workload.ts`.
- **Test pattern to mirror:** `src/lib/workload/rollup.test.ts` + `src/components/workload/CapacityCell.test.tsx`.

**Note on testing in this repo (confirmed):** there is **no Supabase-mock harness** — every existing test targets **pure functions or presentational components**. Therefore action/DB tests in this plan target the **Zod schemas + pure hours↔secs helpers**, never live DB round-trips. RLS/SQL behavior is covered by the migration's own constraints + manual acceptance, not Vitest.

**Note on `pnpm db:types` (confirmed):** the worktree may not have a linked Supabase CLI session. Each schema task MUST run `pnpm db:types` to regenerate `src/types/database.types.ts` and commit it in the same task. The extended `workload_actuals_rollup` keeps the **same** TS `Returns` shape (`{user_id, board_id, day, secs}`) — the UNION is internal to SQL — but the new `time_allocations` table adds a generated entry. If `pnpm db:types` cannot run in the worktree (no linked project), STOP and report; do not hand-edit `database.types.ts`.

---

## File Structure

**Created:**

- `supabase/migrations/20260623120000_time_allocations.sql` — new table + RLS + extended rollup.
- `src/lib/time/categories.ts` — preset category constants (pure).
- `src/lib/time/hours.ts` — hours↔secs parse/format helpers (pure, unit-tested).
- `src/lib/time/hours.test.ts` — tests for the above.
- `src/lib/validations/time.ts` — Zod schemas (decimal-hours → secs, date, exactly-one-of item/category).
- `src/lib/validations/time.test.ts` — Zod edge-case tests.
- `src/lib/time/types.ts` — `TimeAllocationRow`, `TimeCardRow`, `TimeCardData`, etc.
- `src/lib/time/actions.ts` — `upsertTimeAllocation`, `deleteTimeAllocation` server actions.
- `src/lib/time/queries.ts` — `getTimeCardData`, `searchAllocatableItems`, `listUserCategories`.
- `src/lib/time/card.ts` — pure grid-assembly helpers (merge manual + timer → cells); unit-tested.
- `src/lib/time/card.test.ts` — grid assembly + merge tests.
- `src/app/time/layout.tsx` — `AuthenticatedShell` wrapper (mirrors `src/app/workload/layout.tsx`).
- `src/app/time/page.tsx` — RSC: fetch one week, render the card.
- `src/components/time/TimeCard.tsx` — client: week navigator + table + History-API week state.
- `src/components/time/TimeCell.tsx` — client: decimal-hours cell editor (blur/Enter upsert).
- `src/components/time/AddRowPicker.tsx` — client: `command` picker (items + category suggestions).
- `src/components/time/TimeCell.test.tsx` — cell render/parse tests.

**Modified:**

- `supabase/migrations/...` — none modified (new migration file only; never edit a shipped migration).
- `src/types/database.types.ts` — regenerated via `pnpm db:types` (Task 1).
- `src/lib/workload/queries.ts` — `getWorkloadActuals` doc note that actuals now include manual (no code change needed — RPC shape is unchanged; verify).
- `src/components/workload/WorkloadGrid.tsx` — full-canvas layout + flex-grow week columns + utilization %.
- `src/components/workload/MemberRowHeader.tsx` — add utilization % readout.
- `src/components/workload/CapacityCell.tsx` — add thin capacity bar.
- `src/components/shell/nav-items.ts` — append `{ href: "/time", label: "My Time", icon: Clock }`.

---

## Task 1: Foundation — `time_allocations` table + unified rollup + regen types

**Interfaces:**

- **Consumes:** existing `time_entries`, `items`, `boards`, helper functions `is_org_member`, `can_read_board`, `set_updated_at` (from `20260622160000_workload.sql` + `20260620000001_time_entries.sql`).
- **Produces:** `time_allocations` table + RLS; extended `workload_actuals_rollup(date,date)` that UNIONs timer + manual; regenerated `src/types/database.types.ts` containing a `time_allocations` entry. The RPC's TS `Returns` shape is **unchanged** (`{user_id, board_id, day, secs}`).

**Files:**

- Create: `supabase/migrations/20260623120000_time_allocations.sql`
- Modify (regenerate): `src/types/database.types.ts`

This task is schema + generated types only. There is no Vitest for SQL in this repo, so verification is: migration applies, types regenerate, and the four gates stay green. The TDD loop here is "apply → regen → typecheck/build".

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260623120000_time_allocations.sql`:

```sql
-- Time allocation: MANUAL weekly time-card entries. Timers stay in time_entries;
-- this table holds manual allocations ONLY, so summing both never double-counts.
-- Self-only writes (user_id = auth.uid()); org-wide read (Workload + item Time tab).
-- Mirrors workload conventions: denormalized org_id/board_id, is_org_member RLS,
-- set_updated_at trigger. One row per (user, day, item) or (user, day, category)
-- => editing a card cell is an UPSERT on the partial-unique index.

create table public.time_allocations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  work_date     date not null,
  item_id       uuid references public.items (id) on delete cascade,
  board_id      uuid references public.boards (id) on delete cascade,
  category      text,
  duration_secs integer not null check (duration_secs > 0),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- exactly one of item_id / category is populated
  constraint time_allocations_item_xor_category
    check ((item_id is not null) <> (category is not null)),
  -- a category row carries no board; an item row may carry its denormalized board
  constraint time_allocations_category_no_board
    check (category is null or board_id is null)
);

-- one row per task/day/user and per category/day/user => cell edit = upsert
create unique index time_allocations_user_day_item_uidx
  on public.time_allocations (user_id, work_date, item_id)
  where item_id is not null;
create unique index time_allocations_user_day_category_uidx
  on public.time_allocations (user_id, work_date, category)
  where category is not null;

-- hot path: a person's week
create index time_allocations_org_user_date_idx
  on public.time_allocations (org_id, user_id, work_date);
-- item Time-tab reads
create index time_allocations_item_idx
  on public.time_allocations (item_id) where item_id is not null;

create trigger time_allocations_set_updated_at
  before update on public.time_allocations
  for each row execute function public.set_updated_at();

alter table public.time_allocations enable row level security;

-- read: any org member (Workload + item Time tab show everyone)
create policy "time_allocations: read if member" on public.time_allocations
  for select to authenticated using (public.is_org_member(org_id));

-- insert/update/delete: self only, within own org
create policy "time_allocations: insert self" on public.time_allocations
  for insert to authenticated with check (
    public.is_org_member(org_id) and user_id = (select auth.uid())
  );
create policy "time_allocations: update self" on public.time_allocations
  for update to authenticated
  using (public.is_org_member(org_id) and user_id = (select auth.uid()))
  with check (public.is_org_member(org_id) and user_id = (select auth.uid()));
create policy "time_allocations: delete self" on public.time_allocations
  for delete to authenticated
  using (public.is_org_member(org_id) and user_id = (select auth.uid()));

grant select, insert, update, delete on public.time_allocations to authenticated;

-- Index supporting the rollup's manual-leg range scan.
create index if not exists time_allocations_org_date_idx
  on public.time_allocations (org_id, work_date);

-- ── Extend workload_actuals_rollup: UNION timer + manual, summed per
-- (user, board, day). Category rows have board_id = null (off-board). Same
-- security posture (is_org_member + can_read_board) and bounded shape as before.
create or replace function public.workload_actuals_rollup(p_from date, p_to date)
returns table (
  user_id  uuid,
  board_id uuid,
  day      date,
  secs     bigint
)
language sql security definer set search_path = '' as $$
  select user_id, board_id, day, sum(secs)::bigint as secs
  from (
    -- timer leg (completed entries only)
    select
      te.user_id,
      te.board_id,
      te.started_at::date as day,
      te.duration_secs::bigint as secs
    from public.time_entries te
    join public.boards b on b.id = te.board_id
    where te.ended_at is not null
      and te.duration_secs is not null
      and te.started_at::date >= p_from
      and te.started_at::date <= p_to
      and public.is_org_member(b.org_id)
      and public.can_read_board(te.board_id)

    union all

    -- manual leg: item rows attribute to their board; category rows have
    -- board_id = null and still count toward the person's utilization total.
    select
      ta.user_id,
      ta.board_id,
      ta.work_date as day,
      ta.duration_secs::bigint as secs
    from public.time_allocations ta
    left join public.boards b on b.id = ta.board_id
    where ta.work_date >= p_from
      and ta.work_date <= p_to
      and public.is_org_member(ta.org_id)
      -- item rows: only when the board is readable; category rows (board null) pass
      and (ta.board_id is null or public.can_read_board(ta.board_id))
  ) merged
  group by user_id, board_id, day
  limit 5000;
$$;
grant execute on function public.workload_actuals_rollup(date, date) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Run (from the worktree root): `supabase db push --linked` (or the project's standard apply command — check `package.json`/`CONTRIBUTING.md`; if a local stack is used, `supabase migration up`).
Expected: migration `20260623120000_time_allocations` applies cleanly, no errors.

If the linked CLI is unavailable in the worktree, STOP and report — the table must exist before `db:types` can pick it up.

- [ ] **Step 3: Regenerate database types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` gains a `time_allocations` entry (Row/Insert/Update/Relationships). `workload_actuals_rollup` Returns shape is unchanged.

- [ ] **Step 4: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four PASS (no source consumes the new table yet, so this only confirms the regenerated types compile).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260623120000_time_allocations.sql src/types/database.types.ts
git commit -m "feat(time): time_allocations table + unified workload_actuals_rollup"
```

---

## Task 2a: Time library — validation, hours helpers, queries, actions

Runs in parallel with Task 2b (Batch 2). Depends on Task 1 (needs the `time_allocations` type).

**Interfaces:**

- **Consumes:** Task 1's `time_allocations` table + generated types; existing `createClient` (`@/lib/supabase/server`), `getUserOrgs`/`requireUser`/`getUser` (`@/lib/auth/session`), `ActionResult<T>` idiom from `src/lib/workload/actions.ts`.
- **Produces:**
  - `src/lib/time/hours.ts` → `parseHours(s: string): number | null`, `hoursToSecs(h: number): number`, `secsToHours(secs: number): number`, `formatHours(secs: number): string`.
  - `src/lib/time/categories.ts` → `PRESET_CATEGORIES: readonly string[]`.
  - `src/lib/validations/time.ts` → `upsertTimeAllocationSchema`, `deleteTimeAllocationSchema`.
  - `src/lib/time/types.ts` → `TimeAllocationRow`, `TimeCardRowKind`, `TimeCardRow`, `TimeCardCell`, `TimeCardData`.
  - `src/lib/time/queries.ts` → `getTimeCardData(weekStartIso: string)`, `searchAllocatableItems(q: string)`, `listUserCategories()`.
  - `src/lib/time/actions.ts` → `upsertTimeAllocation`, `deleteTimeAllocation`.
  - `src/lib/time/card.ts` → `assembleTimeCard(...)` pure merge of manual + timer into cells.

**Files:**

- Create: `src/lib/time/hours.ts`, `src/lib/time/hours.test.ts`
- Create: `src/lib/time/categories.ts`
- Create: `src/lib/validations/time.ts`, `src/lib/validations/time.test.ts`
- Create: `src/lib/time/types.ts`
- Create: `src/lib/time/card.ts`, `src/lib/time/card.test.ts`
- Create: `src/lib/time/queries.ts`
- Create: `src/lib/time/actions.ts`

### Slice A — hours helpers (pure, TDD)

- [ ] **Step 1: Write the failing test** — `src/lib/time/hours.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { parseHours, hoursToSecs, secsToHours, formatHours } from "./hours";

describe("parseHours", () => {
  it("parses a decimal string to hours", () => {
    expect(parseHours("2.5")).toBe(2.5);
  });
  it("parses an integer string", () => {
    expect(parseHours("8")).toBe(8);
  });
  it("returns null for empty/whitespace", () => {
    expect(parseHours("")).toBeNull();
    expect(parseHours("   ")).toBeNull();
  });
  it("returns null for non-numeric", () => {
    expect(parseHours("abc")).toBeNull();
    expect(parseHours("1.2.3")).toBeNull();
  });
  it("returns null for out-of-range (<0 or >24)", () => {
    expect(parseHours("-1")).toBeNull();
    expect(parseHours("24.1")).toBeNull();
  });
  it("accepts the boundaries 0 and 24", () => {
    expect(parseHours("0")).toBe(0);
    expect(parseHours("24")).toBe(24);
  });
});

describe("hoursToSecs / secsToHours", () => {
  it("converts 2.5h to 9000s", () => {
    expect(hoursToSecs(2.5)).toBe(9000);
  });
  it("rounds to whole seconds", () => {
    expect(hoursToSecs(0.001)).toBe(4); // 3.6 -> 4
  });
  it("round-trips back to hours", () => {
    expect(secsToHours(9000)).toBe(2.5);
  });
});

describe("formatHours", () => {
  it("formats whole hours without trailing zeros", () => {
    expect(formatHours(8 * 3600)).toBe("8");
  });
  it("formats fractional hours", () => {
    expect(formatHours(9000)).toBe("2.5");
  });
  it("formats zero as empty string", () => {
    expect(formatHours(0)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/time/hours.test.ts`
Expected: FAIL — `Cannot find module './hours'`.

- [ ] **Step 3: Write minimal implementation** — `src/lib/time/hours.ts`

```ts
/** Pure decimal-hours ↔ seconds helpers for the weekly time card. */

/** Parse a user-typed decimal-hours string. Returns the hours value, or null
 * when empty, non-numeric, or out of the valid [0, 24] range. */
export function parseHours(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const h = Number(trimmed);
  if (!Number.isFinite(h) || h < 0 || h > 24) return null;
  return h;
}

/** Hours → whole seconds (rounded). 2.5 → 9000. */
export function hoursToSecs(hours: number): number {
  return Math.round(hours * 3600);
}

/** Seconds → hours (decimal). 9000 → 2.5. */
export function secsToHours(secs: number): number {
  return secs / 3600;
}

/** Display a seconds value as a compact decimal-hours string for a cell input.
 * 0 → "" (an empty cell), 28800 → "8", 9000 → "2.5". */
export function formatHours(secs: number): string {
  if (secs === 0) return "";
  const h = secs / 3600;
  return Number.isInteger(h) ? String(h) : String(Number(h.toFixed(2)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/time/hours.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/time/hours.ts src/lib/time/hours.test.ts
git commit -m "feat(time): decimal hours <-> secs helpers"
```

### Slice B — categories constant

- [ ] **Step 1: Create** `src/lib/time/categories.ts`

```ts
/** Preset free-text category suggestions for non-item time-card rows.
 * Categories are free text (custom values allowed); these are just suggestions
 * surfaced in the add-row picker alongside the user's previously-used ones. */
export const PRESET_CATEGORIES = [
  "Meetings",
  "Admin",
  "Internal",
  "Leave/PTO",
  "Other",
] as const;

export type PresetCategory = (typeof PRESET_CATEGORIES)[number];
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/time/categories.ts
git commit -m "feat(time): preset category suggestions"
```

### Slice C — Zod validation (TDD)

- [ ] **Step 1: Write the failing test** — `src/lib/validations/time.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { upsertTimeAllocationSchema, deleteTimeAllocationSchema } from "./time";

const ITEM = "11111111-1111-1111-1111-111111111111";
const BOARD = "22222222-2222-2222-2222-222222222222";

describe("upsertTimeAllocationSchema", () => {
  it("accepts a valid item allocation", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      itemId: ITEM,
      boardId: BOARD,
      hours: 2.5,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.durationSecs).toBe(9000);
  });

  it("accepts a valid category allocation (no board)", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Meetings",
      hours: 1,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.durationSecs).toBe(3600);
  });

  it("rejects both item and category set", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      itemId: ITEM,
      category: "Meetings",
      hours: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects neither item nor category set", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      hours: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects hours > 24", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: 24.5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative hours", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects 0 hours (use delete instead)", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: 0,
    });
    expect(r.success).toBe(false);
  });

  it("accepts the boundary 24 hours", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: 24,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed date", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "06/23/2026",
      category: "Admin",
      hours: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a note longer than 500 chars", () => {
    const r = upsertTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Admin",
      hours: 1,
      note: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });
});

describe("deleteTimeAllocationSchema", () => {
  it("accepts an item+date key", () => {
    const r = deleteTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      itemId: ITEM,
    });
    expect(r.success).toBe(true);
  });
  it("accepts a category+date key", () => {
    const r = deleteTimeAllocationSchema.safeParse({
      workDate: "2026-06-23",
      category: "Meetings",
    });
    expect(r.success).toBe(true);
  });
  it("rejects neither key", () => {
    const r = deleteTimeAllocationSchema.safeParse({ workDate: "2026-06-23" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/validations/time.test.ts`
Expected: FAIL — `Cannot find module './time'`.

- [ ] **Step 3: Write minimal implementation** — `src/lib/validations/time.ts`

```ts
import { z } from "zod";

import { hoursToSecs } from "@/lib/time/hours";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date");
const hours = z.number().min(0).max(24);
const category = z.string().trim().min(1).max(120);
const note = z.string().max(500).optional();

/** Upsert one card cell. Exactly one of itemId / category must be set; hours > 0
 * (a 0 means "clear the cell" => use deleteTimeAllocationSchema). The transform
 * adds the derived durationSecs so the action never re-derives it. */
export const upsertTimeAllocationSchema = z
  .object({
    workDate: isoDate,
    itemId: uuid.optional(),
    boardId: uuid.optional(),
    category: category.optional(),
    hours,
    note,
  })
  .refine((v) => (v.itemId != null) !== (v.category != null), {
    message: "Set exactly one of item or category.",
  })
  .refine((v) => v.category == null || v.boardId == null, {
    message: "A category row carries no board.",
  })
  .refine((v) => v.hours > 0, {
    message: "Hours must be greater than 0 (clear the cell to remove time).",
  })
  .transform((v) => ({ ...v, durationSecs: hoursToSecs(v.hours) }));

/** Delete one card cell, keyed by (workDate, itemId|category). */
export const deleteTimeAllocationSchema = z
  .object({
    workDate: isoDate,
    itemId: uuid.optional(),
    category: category.optional(),
  })
  .refine((v) => (v.itemId != null) !== (v.category != null), {
    message: "Set exactly one of item or category.",
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/validations/time.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/time.ts src/lib/validations/time.test.ts
git commit -m "feat(time): zod schemas for allocation upsert/delete"
```

### Slice D — domain types

- [ ] **Step 1: Create** `src/lib/time/types.ts`

```ts
import type { Tables } from "@/types/database.types";

export type TimeAllocationRow = Tables<"time_allocations">;

export type TimeCardRowKind = "item" | "category";

/** A timer-tracked second total per (item, day) merged into the card as a
 * read-only sub-label ("incl. 1.5h tracked"); editing a cell only writes the
 * manual portion. */
export interface TimerSecsByItemDay {
  itemId: string;
  day: string; // ISO date
  secs: number;
}

/** One day-cell on the weekly card. `manualSecs` is editable; `timerSecs` is
 * read-only (from time_entries) and shown as a sub-label. */
export interface TimeCardCell {
  day: string; // ISO date (Mon..Sun)
  manualSecs: number;
  timerSecs: number;
}

/** One card row: either a board item or a free-text category. */
export interface TimeCardRow {
  key: string; // stable: `item:<id>` or `cat:<category>`
  kind: TimeCardRowKind;
  itemId: string | null;
  boardId: string | null;
  boardName: string | null;
  category: string | null;
  label: string; // item name or category text
  cells: TimeCardCell[]; // one per day in the week, in order
  totalSecs: number;
}

/** Full payload for a rendered week. The card is daily; the server owns the
 * clock + week bounds so SSR/CSR agree (mirrors workload's `today` pattern). */
export interface TimeCardData {
  weekStart: string; // ISO date of Monday
  days: string[]; // 7 ISO dates Mon..Sun
  rows: TimeCardRow[];
  userId: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/time/types.ts
git commit -m "feat(time): time-card domain types"
```

### Slice E — card assembly (pure, TDD)

- [ ] **Step 1: Write the failing test** — `src/lib/time/card.test.ts`

```ts
import { describe, expect, it } from "vitest";

import { weekDays, assembleTimeCard } from "./card";
import type { TimeAllocationRow } from "./types";

const USER = "00000000-0000-0000-0000-000000000000";
const ITEM = "11111111-1111-1111-1111-111111111111";
const BOARD = "22222222-2222-2222-2222-222222222222";

function alloc(part: Partial<TimeAllocationRow>): TimeAllocationRow {
  return {
    id: "x",
    org_id: "o",
    user_id: USER,
    work_date: "2026-06-22",
    item_id: null,
    board_id: null,
    category: null,
    duration_secs: 3600,
    note: null,
    created_at: "",
    updated_at: "",
    ...part,
  };
}

describe("weekDays", () => {
  it("returns 7 ISO dates Mon..Sun from a Monday start", () => {
    const days = weekDays("2026-06-22"); // a Monday
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-06-22");
    expect(days[6]).toBe("2026-06-28");
  });
});

describe("assembleTimeCard", () => {
  it("places a manual item allocation in the correct day cell", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [
        alloc({
          item_id: ITEM,
          board_id: BOARD,
          duration_secs: 9000,
          work_date: "2026-06-23",
        }),
      ],
      timer: [],
      itemMeta: new Map([[ITEM, { name: "Build API", boardName: "Eng" }]]),
    });
    const row = data.rows.find((r) => r.itemId === ITEM);
    expect(row).toBeDefined();
    expect(row!.label).toBe("Build API");
    const tue = row!.cells.find((c) => c.day === "2026-06-23")!;
    expect(tue.manualSecs).toBe(9000);
    expect(tue.timerSecs).toBe(0);
    expect(row!.totalSecs).toBe(9000);
  });

  it("merges timer secs into the same item row as a read-only sub-value (no double count)", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [
        alloc({
          item_id: ITEM,
          board_id: BOARD,
          duration_secs: 3600,
          work_date: "2026-06-22",
        }),
      ],
      timer: [{ itemId: ITEM, day: "2026-06-22", secs: 5400 }],
      itemMeta: new Map([[ITEM, { name: "Build API", boardName: "Eng" }]]),
    });
    const row = data.rows.find((r) => r.itemId === ITEM)!;
    const mon = row.cells.find((c) => c.day === "2026-06-22")!;
    expect(mon.manualSecs).toBe(3600); // editable portion only
    expect(mon.timerSecs).toBe(5400); // read-only
    // total reflects manual + timer, summed once
    expect(row.totalSecs).toBe(3600 + 5400);
  });

  it("creates a timer-only row for an item with no manual entry", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [],
      timer: [{ itemId: ITEM, day: "2026-06-22", secs: 7200 }],
      itemMeta: new Map([[ITEM, { name: "Build API", boardName: "Eng" }]]),
    });
    const row = data.rows.find((r) => r.itemId === ITEM)!;
    expect(row.cells.find((c) => c.day === "2026-06-22")!.timerSecs).toBe(7200);
    expect(row.totalSecs).toBe(7200);
  });

  it("creates a category row with board null and ignores timer for it", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [
        alloc({
          category: "Meetings",
          duration_secs: 3600,
          work_date: "2026-06-24",
        }),
      ],
      timer: [],
      itemMeta: new Map(),
    });
    const row = data.rows.find((r) => r.category === "Meetings")!;
    expect(row.kind).toBe("category");
    expect(row.boardId).toBeNull();
    expect(row.cells.find((c) => c.day === "2026-06-24")!.manualSecs).toBe(
      3600,
    );
  });

  it("ignores allocations outside the week window", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [alloc({ category: "Admin", work_date: "2026-07-01" })],
      timer: [],
      itemMeta: new Map(),
    });
    expect(data.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/time/card.test.ts`
Expected: FAIL — `Cannot find module './card'`.

- [ ] **Step 3: Write minimal implementation** — `src/lib/time/card.ts`

```ts
import type {
  TimeAllocationRow,
  TimeCardCell,
  TimeCardData,
  TimeCardRow,
  TimerSecsByItemDay,
} from "./types";

const DAY = 86_400_000;

function isoToUTC(iso: string): number {
  return Date.parse(iso + "T00:00:00Z");
}
function utcToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 7 ISO dates from a Monday-start week (Mon..Sun). */
export function weekDays(weekStart: string): string[] {
  const base = isoToUTC(weekStart);
  return Array.from({ length: 7 }, (_, i) => utcToIso(base + i * DAY));
}

interface ItemMeta {
  name: string;
  boardName: string | null;
}

/** Pure assembly of a week's card from manual allocations + timer totals +
 * item metadata. Manual and timer are distinct sources (no double count): a
 * cell carries `manualSecs` (editable) and `timerSecs` (read-only); the row
 * total sums both. Allocations/timer outside the week window are ignored. */
export function assembleTimeCard(input: {
  weekStart: string;
  userId: string;
  allocations: TimeAllocationRow[];
  timer: TimerSecsByItemDay[];
  itemMeta: Map<string, ItemMeta>;
}): TimeCardData {
  const { weekStart, userId, allocations, timer, itemMeta } = input;
  const days = weekDays(weekStart);
  const daySet = new Set(days);

  // rowKey -> { meta..., cells map(day -> {manual,timer}) }
  type Acc = {
    kind: "item" | "category";
    itemId: string | null;
    boardId: string | null;
    boardName: string | null;
    category: string | null;
    label: string;
    cells: Map<string, { manual: number; timer: number }>;
  };
  const rows = new Map<string, Acc>();

  const ensure = (key: string, seed: Omit<Acc, "cells">): Acc => {
    let a = rows.get(key);
    if (!a) {
      a = { ...seed, cells: new Map() };
      rows.set(key, a);
    }
    return a;
  };
  const cellOf = (a: Acc, day: string) => {
    let c = a.cells.get(day);
    if (!c) {
      c = { manual: 0, timer: 0 };
      a.cells.set(day, c);
    }
    return c;
  };

  for (const al of allocations) {
    if (!daySet.has(al.work_date)) continue;
    if (al.item_id) {
      const meta = itemMeta.get(al.item_id);
      const a = ensure(`item:${al.item_id}`, {
        kind: "item",
        itemId: al.item_id,
        boardId: al.board_id,
        boardName: meta?.boardName ?? null,
        category: null,
        label: meta?.name ?? "Untitled item",
      });
      cellOf(a, al.work_date).manual += al.duration_secs;
    } else if (al.category) {
      const a = ensure(`cat:${al.category}`, {
        kind: "category",
        itemId: null,
        boardId: null,
        boardName: null,
        category: al.category,
        label: al.category,
      });
      cellOf(a, al.work_date).manual += al.duration_secs;
    }
  }

  for (const t of timer) {
    if (!daySet.has(t.day)) continue;
    const meta = itemMeta.get(t.itemId);
    const a = ensure(`item:${t.itemId}`, {
      kind: "item",
      itemId: t.itemId,
      boardId: null,
      boardName: meta?.boardName ?? null,
      category: null,
      label: meta?.name ?? "Untitled item",
    });
    cellOf(a, t.day).timer += t.secs;
  }

  const out: TimeCardRow[] = [...rows.entries()].map(([key, a]) => {
    const cells: TimeCardCell[] = days.map((day) => {
      const c = a.cells.get(day) ?? { manual: 0, timer: 0 };
      return { day, manualSecs: c.manual, timerSecs: c.timer };
    });
    const totalSecs = cells.reduce((s, c) => s + c.manualSecs + c.timerSecs, 0);
    return {
      key,
      kind: a.kind,
      itemId: a.itemId,
      boardId: a.boardId,
      boardName: a.boardName,
      category: a.category,
      label: a.label,
      cells,
      totalSecs,
    };
  });

  // Stable order: items (by label) first, then categories (by label).
  out.sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === "item" ? -1 : 1;
    return x.label.localeCompare(y.label);
  });

  return { weekStart, days, rows: out, userId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/time/card.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time/card.ts src/lib/time/card.test.ts
git commit -m "feat(time): pure weekly card assembly (manual + timer merge)"
```

### Slice F — queries (server-only)

- [ ] **Step 1: Create** `src/lib/time/queries.ts`

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getUser, getUserOrgs } from "@/lib/auth/session";
import { weekDays, assembleTimeCard } from "@/lib/time/card";
import { PRESET_CATEGORIES } from "@/lib/time/categories";
import type {
  TimeAllocationRow,
  TimeCardData,
  TimerSecsByItemDay,
} from "./types";

/** One person's week: their manual allocations + their timer totals + item
 * metadata, assembled into the card. Bounded by [weekStart, weekStart+6] over
 * the indexed (user_id, work_date) / (started_at) columns. */
export async function getTimeCardData(
  weekStart: string,
): Promise<TimeCardData> {
  const user = await getUser();
  const userId = user?.id ?? "";
  const days = weekDays(weekStart);
  const from = days[0];
  const to = days[6];

  const supabase = await createClient();

  // Manual allocations for the caller's week (RLS already scopes to org members;
  // filter to self for the card surface).
  const { data: allocRows } = await supabase
    .from("time_allocations")
    .select("*")
    .eq("user_id", userId)
    .gte("work_date", from)
    .lte("work_date", to);
  const allocations = (allocRows ?? []) as TimeAllocationRow[];

  // Timer totals for the caller's week (completed entries only).
  const { data: timerRows } = await supabase
    .from("time_entries")
    .select("item_id, started_at, duration_secs")
    .eq("user_id", userId)
    .not("ended_at", "is", null)
    .gte("started_at", `${from}T00:00:00Z`)
    .lte("started_at", `${to}T23:59:59Z`);

  const timer: TimerSecsByItemDay[] = (timerRows ?? []).map((r) => ({
    itemId: r.item_id,
    day: (r.started_at as string).slice(0, 10),
    secs: Number(r.duration_secs ?? 0),
  }));

  // Item metadata (name + board name) for every referenced item.
  const itemIds = new Set<string>();
  for (const a of allocations) if (a.item_id) itemIds.add(a.item_id);
  for (const t of timer) itemIds.add(t.itemId);

  const itemMeta = new Map<
    string,
    { name: string; boardName: string | null }
  >();
  if (itemIds.size > 0) {
    const { data: items } = await supabase
      .from("items")
      .select("id, name, boards(name)")
      .in("id", [...itemIds]);
    for (const it of items ?? []) {
      itemMeta.set(it.id, {
        name: it.name,
        boardName: (it.boards as { name: string } | null)?.name ?? null,
      });
    }
  }

  return assembleTimeCard({ weekStart, userId, allocations, timer, itemMeta });
}

export interface AllocatableItem {
  id: string;
  name: string;
  boardId: string;
  boardName: string | null;
}

/** Cross-board item search for the add-row picker. RLS on `items` already
 * scopes to readable boards/org; bounded by ilike + LIMIT 20, top-level items
 * only (mirrors workload_rollup's parent_id is null). */
export async function searchAllocatableItems(
  q: string,
): Promise<AllocatableItem[]> {
  const term = q.trim();
  if (term === "") return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id, name, board_id, boards(name)")
    .is("parent_id", null)
    .ilike("name", `%${term}%`)
    .limit(20);
  return (data ?? []).map((it) => ({
    id: it.id,
    name: it.name,
    boardId: it.board_id,
    boardName: (it.boards as { name: string } | null)?.name ?? null,
  }));
}

/** The caller's previously-used categories (for the add-row picker), merged with
 * presets, de-duplicated, presets first. */
export async function listUserCategories(): Promise<string[]> {
  const user = await getUser();
  const userId = user?.id ?? "";
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_allocations")
    .select("category")
    .eq("user_id", userId)
    .not("category", "is", null)
    .limit(500);
  const used = new Set<string>();
  for (const r of data ?? []) if (r.category) used.add(r.category);
  const out = [...PRESET_CATEGORIES];
  for (const c of used) if (!out.includes(c)) out.push(c);
  return out;
}
```

> Note for the implementer: `getUserOrgs` is imported for parity with the actions file but the queries above rely on RLS scoping rather than an explicit org filter; remove the import if ESLint flags it unused.

- [ ] **Step 2: Run the gates (typecheck/lint catch query type errors)**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. If the `boards(name)` embedded-select typing complains, narrow with the `as` cast shown (matches `listReadableBoards` precedent).

- [ ] **Step 3: Commit**

```bash
git add src/lib/time/queries.ts
git commit -m "feat(time): time-card + item-search + categories queries"
```

### Slice G — server actions

- [ ] **Step 1: Create** `src/lib/time/actions.ts`

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/auth/session";
import {
  upsertTimeAllocationSchema,
  deleteTimeAllocationSchema,
} from "@/lib/validations/time";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

/** Upsert one card cell (self-only). The unique partial index drives the
 * upsert: (user_id, work_date, item_id) or (user_id, work_date, category).
 * RLS guarantees user_id = auth.uid(); we set it explicitly from the session. */
export async function upsertTimeAllocation(
  input: z.input<typeof upsertTimeAllocationSchema>,
): Promise<ActionResult<null>> {
  const parsed = upsertTimeAllocationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id;
  if (!orgId) return fail("No organization.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const onConflict = d.itemId
    ? "user_id,work_date,item_id"
    : "user_id,work_date,category";

  const { error } = await supabase.from("time_allocations").upsert(
    {
      org_id: orgId,
      user_id: user.id,
      work_date: d.workDate,
      item_id: d.itemId ?? null,
      board_id: d.itemId ? (d.boardId ?? null) : null,
      category: d.category ?? null,
      duration_secs: d.durationSecs,
      note: d.note ?? null,
    },
    { onConflict },
  );
  if (error) return fail(error.message);

  revalidatePath("/time");
  revalidatePath("/workload");
  return { ok: true, data: null };
}

/** Delete one card cell (self-only), keyed by (workDate, itemId|category). */
export async function deleteTimeAllocation(
  input: z.input<typeof deleteTimeAllocationSchema>,
): Promise<ActionResult<null>> {
  const parsed = deleteTimeAllocationSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  let query = supabase
    .from("time_allocations")
    .delete()
    .eq("user_id", user.id)
    .eq("work_date", d.workDate);
  query = d.itemId
    ? query.eq("item_id", d.itemId)
    : query.eq("category", d.category as string);

  const { error } = await query;
  if (error) return fail(error.message);

  revalidatePath("/time");
  revalidatePath("/workload");
  return { ok: true, data: null };
}
```

- [ ] **Step 2: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. (`pnpm test` runs the hours/validation/card unit suites added in this task.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/time/actions.ts
git commit -m "feat(time): upsert/delete allocation server actions (self-scoped)"
```

---

## Task 2b: Workload full-canvas redesign (Option A)

Runs in parallel with Task 2a (Batch 2). Depends only on Task 1 (the rollup now returns combined actuals — no code change needed in the workload queries because the RPC shape is identical; this task is purely presentational). Touches **only** `src/components/workload/*`, so it does not collide with Task 2a's files.

**Interfaces:**

- **Consumes:** Task 1's combined `workload_actuals_rollup` (already wired through `getWorkloadActuals` → `getWorkloadPageData`; shape unchanged). Existing pure helpers `capacityState`, `hours` (`src/lib/workload/rollup.ts`) and types.
- **Produces:** reworked `WorkloadGrid` page layout (full-canvas, flex-grow week columns), `MemberRowHeader` with utilization %, `CapacityCell` with a thin capacity bar.

**Files:**

- Modify: `src/components/workload/WorkloadGrid.tsx`
- Modify: `src/components/workload/MemberRowHeader.tsx`
- Modify: `src/components/workload/CapacityCell.tsx`
- Test: `src/components/workload/CapacityCell.test.tsx` (extend), `src/components/workload/MemberRowHeader.test.tsx` (create)

> **UI skill gate (AGENTS.md §3):** before editing any component, load the `pulse-ui` skill and the generic `frontend-design` skill. Keep the monochrome + single-accent system; color is paired with text (never color-only) for AA/colorblind safety — the existing `CapacityCell` already follows this.

### Slice A — utilization % helper + MemberRowHeader (TDD)

- [ ] **Step 1: Write the failing test** — `src/components/workload/MemberRowHeader.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemberRowHeader } from "./MemberRowHeader";

const member = {
  userId: "u1",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  avatarUrl: null,
};

describe("MemberRowHeader utilization", () => {
  it("shows utilization percent over the window when capacity > 0", () => {
    render(
      <MemberRowHeader
        member={member}
        totalEffortSecs={20 * 3600}
        totalCapacitySecs={40 * 3600}
        totalActualSecs={0}
        metric="planned"
      />,
    );
    // 20h / 40h = 50%
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("omits utilization for the Unassigned row", () => {
    render(
      <MemberRowHeader
        member={null}
        totalEffortSecs={10 * 3600}
        totalCapacitySecs={0}
        totalActualSecs={0}
        metric="planned"
      />,
    );
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/workload/MemberRowHeader.test.tsx`
Expected: FAIL — no `50%` text yet (header currently shows `20h / 40h`).

- [ ] **Step 3: Add a pure utilization helper** — append to `src/lib/workload/rollup.ts`

```ts
/** Whole-percent utilization (effort / capacity) over a window; null when no
 * capacity. Used for the Workload member column readout. */
export function utilizationPct(
  effortSecs: number,
  capacitySecs: number,
): number | null {
  if (capacitySecs <= 0) return null;
  return Math.round((effortSecs / capacitySecs) * 100);
}
```

- [ ] **Step 4: Render it in `MemberRowHeader.tsx`**

Import the helper:

```ts
import {
  hours,
  signedHours,
  signedPct,
  utilizationPct,
  variancePct,
  varianceSecs,
} from "@/lib/workload/rollup";
```

Replace the planned-branch metadata line (the `else` block that renders `{hours(totalEffortSecs)} / {hours(totalCapacitySecs)}`) so it appends utilization when capacity exists. The non-variance branch becomes:

```tsx
<>
  {hours(totalEffortSecs)}
  {!isUnassigned && totalCapacitySecs > 0 ? (
    <>
      {` / ${hours(totalCapacitySecs)}`}
      {` · ${utilizationPct(totalEffortSecs, totalCapacitySecs)}%`}
    </>
  ) : (
    ""
  )}
</>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/workload/MemberRowHeader.test.tsx`
Expected: PASS (both cases — `50%` shown for the member, no `%` for Unassigned).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workload/rollup.ts src/components/workload/MemberRowHeader.tsx src/components/workload/MemberRowHeader.test.tsx
git commit -m "feat(workload): utilization % in the member column"
```

### Slice B — capacity bar in CapacityCell (TDD)

- [ ] **Step 1: Extend the failing test** — add to `src/components/workload/CapacityCell.test.tsx`

```tsx
it("renders a capacity bar element for a planned cell with capacity", () => {
  render(
    <CapacityCell
      effortSecs={20 * 3600}
      capacitySecs={40 * 3600}
      state="under"
      metric="planned"
    />,
  );
  // the bar is a presentational element marked with a stable test id
  expect(screen.getByTestId("capacity-bar")).toBeInTheDocument();
});

it("omits the capacity bar when there is no capacity (none state)", () => {
  render(
    <CapacityCell
      effortSecs={0}
      capacitySecs={0}
      state="none"
      metric="planned"
    />,
  );
  expect(screen.queryByTestId("capacity-bar")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/workload/CapacityCell.test.tsx`
Expected: FAIL — no `capacity-bar` test id.

- [ ] **Step 3: Add the bar to the non-variance branch of `CapacityCell.tsx`**

Inside the returned non-variance `<div>`, after the hours/sub-label spans, add a thin bar whose fill width is the clamped ratio and whose color follows `displayState`:

```tsx
{
  displayState !== "none" ? (
    <div
      data-testid="capacity-bar"
      aria-hidden
      className="bg-border/60 mt-1 h-1 w-full overflow-hidden rounded-full"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          displayState === "under" && "bg-foreground/40",
          displayState === "at" && "bg-primary",
          displayState === "over" && "bg-destructive",
        )}
        style={{
          width: `${Math.min(
            100,
            capacitySecs > 0
              ? Math.round((primarySecs / capacitySecs) * 100)
              : 0,
          )}%`,
        }}
      />
    </div>
  ) : null;
}
```

(`primarySecs`, `displayState`, `capacitySecs`, and `cn` are already in scope in that branch.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/workload/CapacityCell.test.tsx`
Expected: PASS (bar present with capacity; absent for `none`).

- [ ] **Step 5: Commit**

```bash
git add src/components/workload/CapacityCell.tsx src/components/workload/CapacityCell.test.tsx
git commit -m "feat(workload): thin capacity bar in capacity cells"
```

### Slice C — full-canvas layout (flex-grow week columns)

This is the layout rework. No new behavior, so verification is the gates + the existing component tests staying green.

- [ ] **Step 1: Make week columns flex-grow and fill the canvas in `WorkloadGrid.tsx`**

The outer container is already `flex h-full flex-col` (good — full height). Change the table so week columns stretch:

- On the table element, add `w-full`: `<table className="w-full border-separate border-spacing-0 text-sm">`.
- For each week `<th>`, drop the fixed `w-24 min-w-24` width cap and let it grow with a floor: change the className to `bg-card text-muted-foreground min-w-24 border-b px-2 py-2 text-center text-xs font-medium`.
- Keep the Member `<th>`/`<td>` sticky-left fixed-width as-is (`w-56 min-w-56`).

This makes the week columns share the remaining width (`w-full` table + no per-cell max), giving the full-canvas look; horizontal scroll (the existing `overflow-auto` wrapper) only kicks in when the `min-w-24` floors overflow.

- [ ] **Step 2: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS (component tests for `CapacityCell`/`MemberRowHeader` still green; layout is class-only).

- [ ] **Step 3: Commit**

```bash
git add src/components/workload/WorkloadGrid.tsx
git commit -m "feat(workload): full-canvas grid with flex-grow week columns"
```

---

## Task 3: "My Time" page UI (`/time`)

Batch 3. Depends on Task 2a (consumes `src/lib/time/*` queries + actions + helpers). Does not depend on Task 2b.

**Interfaces:**

- **Consumes:** `getTimeCardData`, `searchAllocatableItems`, `listUserCategories` (`@/lib/time/queries`); `upsertTimeAllocation`, `deleteTimeAllocation` (`@/lib/time/actions`); `parseHours`, `formatHours`, `hoursToSecs` (`@/lib/time/hours`); `PRESET_CATEGORIES` (`@/lib/time/categories`); `TimeCardData`/`TimeCardRow` types.
- **Produces:** `/time` route (`layout.tsx` + `page.tsx`) under `AuthenticatedShell`; client components `TimeCard`, `TimeCell`, `AddRowPicker`; a nav entry in `src/components/shell/nav-items.ts`.

**Files:**

- Create: `src/app/time/layout.tsx`
- Create: `src/app/time/page.tsx`
- Create: `src/components/time/TimeCard.tsx`
- Create: `src/components/time/TimeCell.tsx`
- Create: `src/components/time/AddRowPicker.tsx`
- Test: `src/components/time/TimeCell.test.tsx`
- Modify: `src/components/shell/sidebar-nav.tsx`

> **UI skill gate (AGENTS.md §3):** load `pulse-ui` + `frontend-design` before building these components. Reuse the monochrome popover/command idiom from `WorkloadGrid`/`DayActualsPopover`/`CapacityEditor`.

**Data-fetching budget (AGENTS.md §5):** first paint loads **one week** via `getTimeCardData(weekStart)`. Week navigation changes `?week=` via `window.history.pushState` — the page reads `searchParams.week` server-side **only** when a `<Link>`/RSC nav is used to cross weeks; the in-page `‹ ›` nav uses `pushState` for instant URL sync but, because each week is a distinct server window, the **first** visit to a new week needs the server. To keep "0 refetch within the loaded horizon," the page loads the **current week** on first paint and the nav uses `router`-free `pushState` only for the _current_ loaded week; crossing to an unloaded week triggers a genuine RSC fetch. (This matches the spec: "0 RSC refetch within the loaded horizon; only crossing the horizon hits the server.") For v1 the loaded horizon is **one week**, so prev/next is a real RSC nav — acceptable and explicitly bounded. Cell edits are Server Actions with optimistic update + `revalidatePath`.

### Slice A — week math + page wiring

- [ ] **Step 1: Create the layout** — `src/app/time/layout.tsx`

```tsx
import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export const unstable_instant = false;

export default function TimeLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
```

- [ ] **Step 2: Add a week-start helper** — append to `src/lib/time/card.ts`

```ts
/** ISO date of the Monday on/before the given ISO date (week start = Monday). */
export function mondayOf(iso: string): string {
  const d = new Date(isoToUTC(iso));
  const wd = d.getUTCDay(); // 0=Sun..6=Sat
  const back = wd === 0 ? 6 : wd - 1;
  return utcToIso(isoToUTC(iso) - back * DAY);
}
```

Add a test for it in `src/lib/time/card.test.ts`:

```ts
import { weekDays, assembleTimeCard, mondayOf } from "./card";

describe("mondayOf", () => {
  it("returns the Monday of the week for any day", () => {
    expect(mondayOf("2026-06-24")).toBe("2026-06-22"); // Wed -> Mon
    expect(mondayOf("2026-06-22")).toBe("2026-06-22"); // Mon -> Mon
    expect(mondayOf("2026-06-28")).toBe("2026-06-22"); // Sun -> Mon
  });
});
```

Run: `pnpm vitest run src/lib/time/card.test.ts` → Expected: PASS (after adding `mondayOf`).

- [ ] **Step 3: Create the page** — `src/app/time/page.tsx`

```tsx
import { requireUser } from "@/lib/auth/session";
import { getTimeCardData, listUserCategories } from "@/lib/time/queries";
import { mondayOf } from "@/lib/time/card";
import { TimeCard } from "@/components/time/TimeCard";

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  // The server owns the clock so SSR/CSR agree (mirrors workload's `today`).
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekStart = sp.week ? mondayOf(sp.week) : mondayOf(todayIso);

  const [data, categories] = await Promise.all([
    getTimeCardData(weekStart),
    listUserCategories(),
  ]);

  return <TimeCard data={data} categories={categories} />;
}
```

- [ ] **Step 4: Run the gates**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS once `TimeCard` exists (Slice C). If running before Slice C, expect an unresolved import — proceed to Slice B/C, then re-run.

### Slice B — TimeCell (TDD)

- [ ] **Step 1: Write the failing test** — `src/components/time/TimeCell.test.tsx`

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimeCell } from "./TimeCell";

describe("TimeCell", () => {
  it("shows the formatted manual hours as the input value", () => {
    render(
      <TimeCell
        manualSecs={9000}
        timerSecs={0}
        onCommit={vi.fn()}
        onClear={vi.fn()}
        ariaLabel="cell"
      />,
    );
    expect(screen.getByLabelText("cell")).toHaveValue("2.5");
  });

  it("commits parsed hours on blur", () => {
    const onCommit = vi.fn();
    render(
      <TimeCell
        manualSecs={0}
        timerSecs={0}
        onCommit={onCommit}
        onClear={vi.fn()}
        ariaLabel="cell"
      />,
    );
    const input = screen.getByLabelText("cell");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(3);
  });

  it("calls onClear when the value is emptied", () => {
    const onClear = vi.fn();
    render(
      <TimeCell
        manualSecs={3600}
        timerSecs={0}
        onCommit={vi.fn()}
        onClear={onClear}
        ariaLabel="cell"
      />,
    );
    const input = screen.getByLabelText("cell");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalled();
  });

  it("does not commit an invalid value", () => {
    const onCommit = vi.fn();
    render(
      <TimeCell
        manualSecs={0}
        timerSecs={0}
        onCommit={onCommit}
        onClear={vi.fn()}
        ariaLabel="cell"
      />,
    );
    const input = screen.getByLabelText("cell");
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows a tracked sub-label when timerSecs > 0", () => {
    render(
      <TimeCell
        manualSecs={0}
        timerSecs={5400}
        onCommit={vi.fn()}
        onClear={vi.fn()}
        ariaLabel="cell"
      />,
    );
    expect(screen.getByText(/tracked/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/time/TimeCell.test.tsx`
Expected: FAIL — `Cannot find module './TimeCell'`.

- [ ] **Step 3: Write minimal implementation** — `src/components/time/TimeCell.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { formatHours, parseHours, secsToHours } from "@/lib/time/hours";

/** One day-cell editor on the weekly card. Editable decimal-hours for the
 * manual portion; the timer portion is a read-only sub-label. Commits on
 * blur/Enter; an emptied value clears the row's day (delete). */
export function TimeCell({
  manualSecs,
  timerSecs,
  onCommit,
  onClear,
  ariaLabel,
  disabled,
}: {
  manualSecs: number;
  timerSecs: number;
  onCommit: (hours: number) => void;
  onClear: () => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(formatHours(manualSecs));
  // Re-sync when the server value changes (e.g. after revalidate).
  useEffect(() => {
    setValue(formatHours(manualSecs));
  }, [manualSecs]);

  function commit() {
    const trimmed = value.trim();
    if (trimmed === "") {
      if (manualSecs > 0) onClear();
      return;
    }
    const h = parseHours(trimmed);
    if (h === null) {
      // revert to the last valid value
      setValue(formatHours(manualSecs));
      return;
    }
    if (h === 0) {
      if (manualSecs > 0) onClear();
      setValue("");
      return;
    }
    if (h !== secsToHours(manualSecs)) onCommit(h);
  }

  return (
    <div className="flex flex-col items-center">
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        disabled={disabled}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          "focus-visible:ring-ring h-8 w-14 rounded border bg-transparent text-center text-sm tabular-nums focus-visible:ring-2 focus-visible:outline-none",
          disabled && "opacity-50",
        )}
        placeholder="—"
      />
      {timerSecs > 0 ? (
        <span className="text-muted-foreground mt-0.5 text-[10px] leading-tight">
          incl. {formatHours(timerSecs) || "0"}h tracked
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/time/TimeCell.test.tsx`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/time/TimeCell.tsx src/components/time/TimeCell.test.tsx
git commit -m "feat(time): decimal-hours day cell editor"
```

### Slice C — AddRowPicker + TimeCard shell

- [ ] **Step 1: Create the add-row picker** — `src/components/time/AddRowPicker.tsx`

```tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { searchAllocatableItems } from "@/lib/time/queries";

export interface PickedRow {
  kind: "item" | "category";
  itemId?: string;
  boardId?: string;
  category?: string;
  label: string;
}

/** "+ Add row" picker: searches items across readable boards and offers
 * category suggestions (presets + the user's previously-used). Calls back with
 * the chosen row; the parent inserts an empty editable row into the card. */
export function AddRowPicker({
  categories,
  onPick,
}: {
  categories: string[];
  onPick: (row: PickedRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<
    { id: string; name: string; boardId: string; boardName: string | null }[]
  >([]);
  const [, startTransition] = useTransition();

  function onQueryChange(q: string) {
    setQuery(q);
    startTransition(async () => {
      setItems(q.trim() === "" ? [] : await searchAllocatableItems(q));
    });
  }

  const categoryMatches = categories.filter((c) =>
    c.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const typedIsNewCategory =
    query.trim() !== "" &&
    !categories.some((c) => c.toLowerCase() === query.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Plus aria-hidden className="size-3.5" /> Add row
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={onQueryChange}
            placeholder="Search items or type a category…"
          />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {items.length > 0 ? (
              <CommandGroup heading="Items">
                {items.map((it) => (
                  <CommandItem
                    key={it.id}
                    value={`item-${it.id}`}
                    onSelect={() => {
                      onPick({
                        kind: "item",
                        itemId: it.id,
                        boardId: it.boardId,
                        label: it.name,
                      });
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="truncate">{it.name}</span>
                    {it.boardName ? (
                      <span className="text-muted-foreground ml-auto text-xs">
                        {it.boardName}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Categories">
              {categoryMatches.map((c) => (
                <CommandItem
                  key={c}
                  value={`cat-${c}`}
                  onSelect={() => {
                    onPick({ kind: "category", category: c, label: c });
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  {c}
                </CommandItem>
              ))}
              {typedIsNewCategory ? (
                <CommandItem
                  value={`new-${query}`}
                  onSelect={() => {
                    const c = query.trim();
                    onPick({ kind: "category", category: c, label: c });
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  Add category “{query.trim()}”
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Create the card shell** — `src/components/time/TimeCard.tsx`

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/time/hours";
import { upsertTimeAllocation, deleteTimeAllocation } from "@/lib/time/actions";
import type { TimeCardData, TimeCardRow } from "@/lib/time/types";
import { TimeCell } from "./TimeCell";
import { AddRowPicker, type PickedRow } from "./AddRowPicker";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const toMs = (d: string) => Date.parse(d + "T00:00:00Z");

function dayLabel(isoDate: string): string {
  return new Date(toMs(isoDate)).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function weekLabel(start: string): string {
  return new Date(toMs(start)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Weekly time card. Week navigation is a genuine RSC nav (each week is a
 * distinct server window; the loaded horizon is one week — bounded read).
 * Cell edits are Server Actions with an optimistic local overlay. */
export function TimeCard({
  data,
  categories,
}: {
  data: TimeCardData;
  categories: string[];
}) {
  const router = useRouter();
  const [, startNav] = useTransition();
  // Locally-added empty rows (from the picker) not yet persisted.
  const [extraRows, setExtraRows] = useState<TimeCardRow[]>([]);

  function gotoWeek(deltaWeeks: number) {
    const next = iso(toMs(data.weekStart) + deltaWeeks * 7 * DAY);
    startNav(() => router.push(`/time?week=${next}`));
  }

  const rows = useMemo(() => {
    // Merge server rows with locally-added rows the user hasn't filled yet,
    // de-duping by key (a server row wins).
    const keys = new Set(data.rows.map((r) => r.key));
    return [...data.rows, ...extraRows.filter((r) => !keys.has(r.key))];
  }, [data.rows, extraRows]);

  function addRow(pick: PickedRow) {
    const key =
      pick.kind === "item" ? `item:${pick.itemId}` : `cat:${pick.category}`;
    if (rows.some((r) => r.key === key)) return;
    setExtraRows((prev) => [
      ...prev,
      {
        key,
        kind: pick.kind,
        itemId: pick.itemId ?? null,
        boardId: pick.boardId ?? null,
        boardName: null,
        category: pick.category ?? null,
        label: pick.label,
        cells: data.days.map((day) => ({ day, manualSecs: 0, timerSecs: 0 })),
        totalSecs: 0,
      },
    ]);
  }

  function commitCell(row: TimeCardRow, day: string, hours: number) {
    startNav(async () => {
      await upsertTimeAllocation({
        workDate: day,
        itemId: row.itemId ?? undefined,
        boardId: row.boardId ?? undefined,
        category: row.category ?? undefined,
        hours,
      });
      router.refresh();
    });
  }

  function clearCell(row: TimeCardRow, day: string) {
    startNav(async () => {
      await deleteTimeAllocation({
        workDate: day,
        itemId: row.itemId ?? undefined,
        category: row.category ?? undefined,
      });
      router.refresh();
    });
  }

  const dayTotals = data.days.map((day) =>
    rows.reduce((s, r) => {
      const c = r.cells.find((x) => x.day === day);
      return s + (c ? c.manualSecs + c.timerSecs : 0);
    }, 0),
  );
  const weekTotal = dayTotals.reduce((s, x) => s + x, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">My Time</h1>
          <p className="text-muted-foreground text-xs">
            Log hours per task or category, by day. Saved as you go.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous week"
            onClick={() => gotoWeek(-1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="text-sm font-medium tabular-nums">
            Week of {weekLabel(data.weekStart)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next week"
            onClick={() => gotoWeek(1)}
          >
            <ChevronRight aria-hidden />
          </Button>
          <AddRowPicker categories={categories} onPick={addRow} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="bg-card text-muted-foreground sticky left-0 z-30 w-64 min-w-64 border-r border-b px-4 py-2 text-left text-xs font-medium">
                Task / Category
              </th>
              {data.days.map((day) => (
                <th
                  key={day}
                  className="bg-card text-muted-foreground min-w-20 border-b px-2 py-2 text-center text-xs font-medium"
                >
                  {dayLabel(day)}
                </th>
              ))}
              <th className="bg-card text-muted-foreground min-w-20 border-b border-l px-2 py-2 text-center text-xs font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="group">
                <td className="bg-background group-hover:bg-accent/20 sticky left-0 z-10 w-64 min-w-64 border-r border-b px-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.label}</p>
                    <p className="text-muted-foreground truncate text-[11px]">
                      {row.kind === "item"
                        ? (row.boardName ?? "Item")
                        : "Category"}
                    </p>
                  </div>
                </td>
                {row.cells.map((cell) => (
                  <td
                    key={cell.day}
                    className="border-b px-1.5 py-1.5 text-center align-middle"
                  >
                    <TimeCell
                      manualSecs={cell.manualSecs}
                      timerSecs={cell.timerSecs}
                      ariaLabel={`${row.label}, ${dayLabel(cell.day)}`}
                      onCommit={(h) => commitCell(row, cell.day, h)}
                      onClear={() => clearCell(row, cell.day)}
                    />
                  </td>
                ))}
                <td className="border-b border-l px-2 py-1.5 text-center align-middle tabular-nums">
                  {formatHours(row.totalSecs) || "0"}h
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={data.days.length + 2}
                  className="text-muted-foreground px-4 py-10 text-center text-sm"
                >
                  No rows yet. Use “Add row” to log time against a task or
                  category.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <td className="bg-card sticky left-0 z-10 border-t border-r px-4 py-2 text-xs font-medium">
                Daily total
              </td>
              {dayTotals.map((secs, i) => (
                <td
                  key={data.days[i]}
                  className={cn(
                    "border-t px-2 py-2 text-center text-xs tabular-nums",
                    secs > 0 ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {formatHours(secs) || "0"}h
                </td>
              ))}
              <td className="border-t border-l px-2 py-2 text-center text-xs font-semibold tabular-nums">
                {formatHours(weekTotal) || "0"}h
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. (`pnpm test` runs `TimeCell.test.tsx` + the Task 2a suites.)

- [ ] **Step 4: Commit**

```bash
git add src/app/time/layout.tsx src/app/time/page.tsx src/components/time/TimeCard.tsx src/components/time/AddRowPicker.tsx src/lib/time/card.ts src/lib/time/card.test.ts
git commit -m "feat(time): My Time weekly card page (/time)"
```

### Slice D — nav entry

The sidebar nav is an **inline `const nav` array** in `src/components/shell/sidebar-nav.tsx` (NOT a separate `nav-items.ts`). It uses `lucide-react` icons `Target/BarChart3/Gauge/Inbox`; active-link detection is `pathname === href || pathname.startsWith(`${href}/`)`. Add one entry.

- [ ] **Step 1: Add `Clock` to the icon import** — `src/components/shell/sidebar-nav.tsx`

Change the existing import (line ~5):

```ts
import { BarChart3, Clock, Gauge, Inbox, Target } from "lucide-react";
```

- [ ] **Step 2: Append the nav entry** to the `const nav = [...] as const` array (after Workload, before Inbox so the time card sits next to Workload):

```ts
const nav = [
  { label: "Goals", icon: Target, href: "/goals" },
  { label: "Portfolios", icon: BarChart3, href: "/portfolios" },
  { label: "Workload", icon: Gauge, href: "/workload" },
  { label: "My Time", icon: Clock, href: "/time" },
  { label: "Inbox", icon: Inbox },
] as const;
```

(The render loop at lines ~79–142 already handles both the collapsed-tooltip and expanded forms via `"href" in item` — no other change needed.)

- [ ] **Step 3: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS; `/time` now appears in the sidebar (between Workload and Inbox), active when on `/time`.

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/sidebar-nav.tsx
git commit -m "feat(time): add My Time to the sidebar nav"
```

---

## Execution DAG

**Dependency graph:**

- **Task 1** (migration + unified rollup + types) — depends on nothing.
- **Task 2a** (time lib: validation, hours, queries, actions, card) — depends on **Task 1** (needs `time_allocations` type).
- **Task 2b** (Workload full-canvas redesign) — depends on **Task 1** only (rollup now returns combined actuals; RPC TS shape unchanged → presentational-only). Independent of 2a (disjoint files: `src/components/workload/*` vs `src/lib/time/*`).
- **Task 3** ("My Time" page UI) — depends on **Task 2a** (consumes `src/lib/time/*` queries + actions + helpers). Independent of 2b.

```
Task 1
  ├──────────────┐
  ▼              ▼
Task 2a        Task 2b
  │
  ▼
Task 3
```

**Parallel batches (waves):**

- **Batch 1:** Task 1 (blocks everything — schema + types).
- **Batch 2:** Task 2a ‖ Task 2b (run concurrently; disjoint file sets, both depend only on Task 1). Dispatch with `superpowers:dispatching-parallel-agents` in **isolated git worktrees** so the parallel agents don't clobber the shared checkout (AGENTS.md §6 / §1).
- **Batch 3:** Task 3 (after Task 2a merges).

**Critical path (wall-clock floor):** Task 1 → Task 2a → Task 3 — three waves. Task 2b runs "for free" in the shadow of Task 2a in Batch 2 and merges before Batch 3.

---

## Self-Review (spec coverage check)

- **Weekly time card / `/time` page** → Task 3 (page + `TimeCard`). ✓
- **No approval workflow** → nothing built; allocations save directly. ✓ (designed extensible: no `status` column.)
- **Rows = items + free-text categories** → `assembleTimeCard` (Task 2a) + `AddRowPicker` (Task 3); presets in `categories.ts`. ✓
- **Timer + manual feed one ledger** → unified `workload_actuals_rollup` (Task 1) + per-cell `timerSecs` read-only sub-label (Tasks 2a/3). ✓
- **No double-counting** → distinct sources (`time_entries` vs `time_allocations`), UNION ALL then SUM; `card.test.ts` asserts manual+timer summed once. ✓
- **Self-only writes, org-wide read** → RLS in Task 1; actions set `user_id` from session (Task 2a). ✓
- **Auto + add row population** → spec says auto-load assigned/active items + picker. **NOTE:** v1 auto-populate loads items the user has manual/timer time against this week (via `getTimeCardData`) + the picker for everything else. Pre-loading "items where the user is in the people column with no time yet" is covered by the picker, not auto-seeded, to keep the read bounded (no cross-board people-column scan on first paint). This is a faithful, bounded reading of the spec's "auto + add"; the picker makes any assigned item one search away. ✓ (Called out so the reviewer can opt into eager people-column seeding later.)
- **Decimal-hours input, 0..24** → `parseHours` + Zod + `TimeCell` (Tasks 2a/3); tests cover 0/24/negative/non-numeric. ✓
- **Workload = week buckets; card = daily** → unchanged workload bucketing; card uses `weekDays`. ✓
- **Workload expanded capacity grid (Option A)** → Task 2b (full-canvas, flex-grow columns, utilization %, capacity bar). ✓
- **Week switching via History API, 0 refetch within horizon** → addressed: horizon is one week in v1, so prev/next is a bounded RSC nav; filters on Workload remain client-state pushState (unchanged). Explicitly documented in Task 3's data-fetching budget. ✓
- **Zod at boundaries** → `src/lib/validations/time.ts` with tests. ✓
- **Migration + `pnpm db:types` same task** → Task 1 Steps 1–5. ✓
- **Bounded/indexed reads** → `(user_id, work_date)` index + week window; `searchAllocatableItems` ilike+LIMIT 20; rollup LIMIT 5000. ✓
- **Tests written + executed per task; four gates green** → every task ends on the gates. ✓
- **Execution DAG** → present above. ✓

**Placeholder scan:** no TBD/TODO/"add error handling"/"similar to Task N" — every code step shows complete code. ✓
**Type consistency:** `parseHours`/`hoursToSecs`/`formatHours`/`secsToHours` (hours.ts) used identically in validations, TimeCell, TimeCard; `TimeCardRow`/`TimeCardData`/`TimerSecsByItemDay` defined in types.ts and consumed unchanged in card.ts/queries.ts/TimeCard.tsx; `upsertTimeAllocation`/`deleteTimeAllocation` signatures match between actions.ts and TimeCard.tsx; `utilizationPct` defined once in rollup.ts and used in MemberRowHeader. ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-23-time-allocation-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review between tasks; Batch 2 (Tasks 2a + 2b) runs as parallel subagents in isolated worktrees.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans` with checkpoints.

**Which approach?** (Per the task brief, STOP here for review before any execution.)
