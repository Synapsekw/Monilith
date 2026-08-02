# Phase 7c — Workload / Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Worktree:** This is a feature build — it runs in `.claude/worktrees/workload-7c` on `task/workload-7c` (already created). Not "done" until merged to `develop` + worktree/branch removed via `scripts/finish-task.sh`. Give the migration a timestamp **later than every existing migration** in `supabase/migrations/`. The only shared file with other surfaces is `src/components/sidebar.tsx` / `src/components/app-shell.test.tsx` (a brand-new Workload nav item).
>
> **UI build-time skills (AGENTS.md #3):** Tasks 7–9 build UI — load the **`pulse-ui`** project skill and the generic **`frontend-design`** skill before writing any component, for the monochrome + single-accent tokens, app primitives, and the capacity color semantics (under/at/over).

**Goal:** Ship an org-wide **Workload** section at `/workload` — one row per member, a horizontal timeline of week buckets showing each person's assigned effort vs. their capacity (over/under-allocation at a glance), reading assignments straight from existing board People/Date/time-tracking cells.

**Architecture:** One small new org-scoped table (`member_capacity`) + a tiny `org_workload_settings` defaults table, both with `is_org_member` RLS. A single bounded `workload_rollup(from, to)` `SECURITY DEFINER` RPC returns **raw** `(item, assignee, date-range, estimate)` rows for boards the caller can read (`can_read_board`-gated, subitems excluded). Pure TypeScript (`src/lib/workload/rollup.ts`) spreads each item's effort across its working days, buckets by week, sums per member, and compares to capacity. The RSC loads everything in one bounded pass; in-page sort/filter/window-shift are client state + the History API (0 RSC refetch); capacity/default edits are Server Actions with `revalidatePath`.

**Tech Stack:** Next.js 16 (App Router, RSC, Server Actions), React 19, Supabase (Postgres + RLS), Zod, @tanstack/react-query (already in app), shadcn/ui, Tailwind v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-22-phase-7c-workload-capacity-design.md`

---

## File Structure

**Create:**

- `supabase/migrations/<ts>_workload.sql` — `member_capacity` + `org_workload_settings` tables, `set_updated_at` trigger, RLS, `can_edit_member_capacity`, the `workload_rollup` RPC, grants.
- `src/lib/workload/types.ts` — `MemberCapacity`, `OrgWorkloadDefaults`, `WorkloadRawRow`, `WeekBucket`, `CapacityState`, `BucketCell`, `MemberRow`, `WorkloadGrid`, `EFFORT_FALLBACK` constants.
- `src/lib/workload/rollup.ts` — pure helpers: `spreadItemEffort`, `bucketByWeek`, `buildWindow`, `capacityState`, `bucketCapacitySecs`, `buildWorkloadGrid`, `serverToday`.
- `src/lib/workload/rollup.test.ts` — unit tests for all helpers.
- `src/lib/validations/workload.ts` — Zod input schemas.
- `src/lib/validations/workload.test.ts` — unit tests for the schemas.
- `src/lib/workload/queries.ts` — `getWorkloadGrid`, `listOrgMembersForWorkload`, `getMemberCapacities`, `getWorkloadDefaults`, re-export window helpers.
- `src/lib/workload/actions.ts` — `upsertMemberCapacity`, `setWorkloadDefaults`.
- `src/lib/workload/workload.rls.integration.test.ts` — live RPC + RLS + `can_read_board` + capacity-edit gate.
- `src/components/workload/CapacityCell.tsx`, `MemberRowHeader.tsx` — render bits.
- `src/components/workload/WorkloadGrid.tsx` — client grid + sort/filter/window (History API).
- `src/components/workload/CapacityEditor.tsx` — per-member capacity popover.
- `src/components/workload/WorkloadDefaultsDialog.tsx` — org-admin defaults dialog.
- `src/app/workload/layout.tsx`, `src/app/workload/page.tsx`.
- `e2e/workload.spec.ts` — e2e happy path.

**Modify:**

- `src/components/sidebar.tsx` — add a new `Workload` nav item (`Gauge` lucide icon, `href: "/workload"`) to the `nav` array.
- `src/components/app-shell.test.tsx` — extend the nav assertion to expect a live `/workload` link.
- `src/types/database.types.ts` — regenerated after the migration (do not hand-edit).

---

## Execution DAG (AGENTS.md #6)

**Per-task Interfaces (Consumes / Produces):**

- **T1 Migration + types** — Consumes: existing `organizations`/`boards`/`columns`/`items`/`cell_values` schema + `is_org_member`/`can_read_board`/`has_org_role`/`set_updated_at`. Produces: `member_capacity` + `org_workload_settings` tables, `can_edit_member_capacity`, `workload_rollup` RPC, regenerated `database.types.ts`.
- **T2 Validations** — Consumes: nothing (pure Zod). Produces: `upsertMemberCapacitySchema`, `setWorkloadDefaultsSchema`, `workloadWindowSchema`.
- **T3 Rollup helpers + types** — Consumes: `database.types.ts` (T1) for enum/row types only. Produces: `src/lib/workload/types.ts`, `src/lib/workload/rollup.ts` (`buildWorkloadGrid` etc.).
- **T4 Queries** — Consumes: `workload_rollup` RPC (T1), `rollup.ts` + `types.ts` (T3), supabase server client. Produces: `getWorkloadGrid`, `getMemberCapacities`, `getWorkloadDefaults`, `listOrgMembersForWorkload`.
- **T5 Actions** — Consumes: schemas (T2), `member_capacity`/`org_workload_settings` (T1). Produces: `upsertMemberCapacity`, `setWorkloadDefaults` Server Actions.
- **T6 Integration test** — Consumes: `workload_rollup` + RLS (T1). Produces: live proof of org isolation, `can_read_board` gating, capacity-edit gate.
- **T7 UI components** — Consumes: `types.ts` (T3), actions (T5), queries (T4). Produces: `WorkloadGrid`, `CapacityEditor`, `WorkloadDefaultsDialog`, render bits.
- **T8 Route + sidebar** — Consumes: `getWorkloadGrid` (T4), UI (T7). Produces: `/workload` route, live sidebar link.
- **T9 e2e + final gate** — Consumes: the running route (T8). Produces: green gate + e2e.

**Dependency graph**

- T1 — root (everything depends on the generated types and the RPC).
- T2 ← (none; can even precede T1, but grouped post-T1 for a single migration-first wave)
- T3 ← T1 (types only)
- T4 ← T1, T3
- T5 ← T1, T2
- T6 ← T1
- T7 ← T3, T4, T5
- T8 ← T7, T4
- T9 ← T8

**Parallel batches (waves of concurrent agents)**

- **Wave 0:** T1 (alone — schema root; applies the cloud migration, regenerates types).
- **Wave 1:** T2, T3, T6 (independent once T1 lands).
- **Wave 2:** T4, T5 (queries + actions; both need T1, T4 also needs T3, T5 also needs T2).
- **Wave 3:** T7 (UI; needs T3/T4/T5).
- **Wave 4:** T8 (route/sidebar), then T9 (e2e + gate).

> When a wave has ≥2 tasks, dispatch them with `superpowers:dispatching-parallel-agents`. UI tasks that mutate files concurrently use isolated worktrees per `superpowers:using-git-worktrees`.

**Critical path (wall-clock floor):** **T1 → T4 → T7 → T8 → T9** (the schema → queries → UI → route → gate chain). T3 feeds T4 but is shorter than the T1 migration root; T2/T5/T6 sit off the critical path.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** one RSC pass — `getWorkloadGrid(from, to)` = `workload_rollup(from, to)` RPC + `listOrgMembersForWorkload` + `member_capacity` SELECT + `getWorkloadDefaults`, in parallel (`Promise.all`). Grid assembly (spread + bucket + capacity) is **pure TS**, no extra round-trips.
- **Interaction (0 server round-trips):** sort members, filter by workspace/board, shift the visible week window **within the loaded horizon**, open/close the capacity editor → **client state + History API** (`window.history.pushState`, read via `useSearchParams`) over the already-loaded grid (AGENTS.md gotcha-09). Paging the window **beyond** the loaded horizon → a fresh RSC load with new `?from/&to` (rare; explicitly an RSC nav because it needs more data).
- **Server-data changes:** `upsertMemberCapacity`, `setWorkloadDefaults` → **Server Action + `revalidatePath("/workload")`** (T5).
- **Bounded over indexed columns:** `workload_rollup` is filtered to the `[from, to]` horizon, reads over indexed `cell_values(item_id, column_id)` + `items(board_id)`, excludes subitems (`parent_id is null`), gated by `can_read_board`, with a `LIMIT 5000` backstop. `member_capacity` is org-bounded (≤1 row/member).

---

## Task 1: Migration — tables, RLS, capacity-edit gate, rollup RPC + regenerated types

**Files:**

- Create: `supabase/migrations/<ts>_workload.sql` (timestamp **after** every existing migration; e.g. `20260622160000_workload.sql` — verify it sorts last with `ls supabase/migrations`)
- Modify: `src/types/database.types.ts` (regenerated)

- [ ] **Step 1: Confirm the migration timestamp sorts last**

Run: `ls supabase/migrations | tail -5`
Expected: your new filename `<ts>_workload.sql` sorts after the last existing one (pick a `<ts>` greater than the latest; `20260622160000` is safe given the latest is `20260622130000_*`).

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/<ts>_workload.sql`:

```sql
-- Phase 7c: Workload / capacity. Org-wide per-member effort-vs-capacity view.
-- No new "assignment" data: assignments are READ from existing people/date/
-- time_tracking cell_values. We persist only per-member capacity + org defaults.
-- Mirrors portfolios/goals conventions: denormalized org_id, is_org_member RLS,
-- set_updated_at trigger, SECURITY DEFINER rollup returning RAW rows (bucketing
-- + capacity math live in TypeScript: src/lib/workload/rollup.ts).

-- ── member_capacity (sparse: a row only when a member customizes) ────────────
create table public.member_capacity (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  hours_per_day numeric not null default 8 check (hours_per_day >= 0 and hours_per_day <= 24),
  working_days  smallint[] not null default '{1,2,3,4,5}'::smallint[],
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, user_id)
);
create index member_capacity_org_id_idx on public.member_capacity (org_id);

create trigger member_capacity_set_updated_at
  before update on public.member_capacity
  for each row execute function public.set_updated_at();

-- ── org_workload_settings (one row per org; defaults for un-customized members)
create table public.org_workload_settings (
  org_id                uuid primary key references public.organizations (id) on delete cascade,
  default_hours_per_day numeric not null default 8 check (default_hours_per_day >= 0 and default_hours_per_day <= 24),
  default_per_item_hours numeric not null default 4 check (default_per_item_hours >= 0),
  default_working_days  smallint[] not null default '{1,2,3,4,5}'::smallint[],
  updated_at            timestamptz not null default now()
);

create trigger org_workload_settings_set_updated_at
  before update on public.org_workload_settings
  for each row execute function public.set_updated_at();

-- ── edit gate: self OR org owner/admin ──────────────────────────────────────
create or replace function public.can_edit_member_capacity(p_org_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select (
    p_user_id = (select auth.uid())
    or public.has_org_role(p_org_id, array['owner', 'admin']::public.org_role[])
  );
$$;
grant execute on function public.can_edit_member_capacity(uuid, uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.member_capacity enable row level security;
create policy "member_capacity: read if member" on public.member_capacity
  for select using (public.is_org_member(org_id));
create policy "member_capacity: insert if editor" on public.member_capacity
  for insert with check (public.can_edit_member_capacity(org_id, user_id));
create policy "member_capacity: update if editor" on public.member_capacity
  for update using (public.can_edit_member_capacity(org_id, user_id))
  with check (public.can_edit_member_capacity(org_id, user_id));
create policy "member_capacity: delete if editor" on public.member_capacity
  for delete using (public.can_edit_member_capacity(org_id, user_id));

alter table public.org_workload_settings enable row level security;
create policy "org_workload_settings: read if member" on public.org_workload_settings
  for select using (public.is_org_member(org_id));
create policy "org_workload_settings: write if admin" on public.org_workload_settings
  for all using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- ── workload_rollup: RAW (item, assignee, date-range, estimate) rows ─────────
-- One bounded read for the caller's org over the [p_from, p_to] horizon.
-- Resolves each board's date column (first 'date' kind) and the item's
-- time_tracking estimate cell. Unnests people cell userIds → one row per
-- (item, assignee); items with no assignee yield a single user_id = NULL row.
-- Excludes subitems. Gated by is_org_member + can_read_board (no leak).
create or replace function public.workload_rollup(p_from date, p_to date)
returns table (
  item_id       uuid,
  board_id      uuid,
  item_name     text,
  user_id       uuid,
  start_date    date,
  end_date      date,
  estimate_secs bigint
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with date_col as (
    -- first date column per readable, in-org board
    select distinct on (c.board_id) c.board_id, c.id as column_id
    from public.columns c
    join public.boards b on b.id = c.board_id
    where c.kind = 'date'
      and public.is_org_member(b.org_id)
      and public.can_read_board(c.board_id)
    order by c.board_id, c.position, c.id
  ),
  dated as (
    select
      i.id as item_id,
      i.board_id,
      i.name as item_name,
      (dv.value ->> 'date')::date as start_date,
      coalesce((dv.value ->> 'end')::date, (dv.value ->> 'date')::date) as end_date,
      -- estimate from the item's time_tracking cell, if any
      (
        select (cv.value ->> 'estimateSeconds')::bigint
        from public.cell_values cv
        join public.columns tc on tc.id = cv.column_id and tc.kind = 'time_tracking'
        where cv.item_id = i.id
        limit 1
      ) as estimate_secs,
      -- assignee userIds from the item's people cell, if any
      (
        select pv.value -> 'userIds'
        from public.cell_values pv
        join public.columns pc on pc.id = pv.column_id and pc.kind = 'people'
        where pv.item_id = i.id
        limit 1
      ) as user_ids
    from date_col dc
    join public.items i on i.board_id = dc.board_id and i.parent_id is null
    join public.cell_values dv on dv.item_id = i.id and dv.column_id = dc.column_id
    where (dv.value ->> 'date') is not null
      -- overlap test against the horizon
      and (dv.value ->> 'date')::date <= p_to
      and coalesce((dv.value ->> 'end')::date, (dv.value ->> 'date')::date) >= p_from
  )
  select d.item_id, d.board_id, d.item_name,
         (u.uid)::uuid as user_id,
         d.start_date, d.end_date, d.estimate_secs
  from dated d
  left join lateral (
    select value::text as uid
    from jsonb_array_elements_text(coalesce(d.user_ids, '[]'::jsonb)) as value
  ) u on true
  limit 5000;
end; $$;
grant execute on function public.workload_rollup(date, date) to authenticated;
```

> **Implementer notes (verify against the live schema before applying):**
>
> - Confirm the `column_kind` enum values are exactly `'date'`, `'people'`, `'time_tracking'` (per `src/lib/boards/column-kinds.ts` + `database.types.ts` Enums). If any differs, fix the `c.kind = …` predicates.
> - Confirm `set_updated_at`, `is_org_member`, `can_read_board`, `has_org_role`, and the `org_role` enum exist with these signatures (they are used verbatim by portfolios/goals — see `supabase/migrations/20260621160000_goals.sql`).
> - The `left join lateral … jsonb_array_elements_text` over an empty/NULL `user_ids` yields **one** row with `uid = NULL` (the Unassigned bucket) because of `coalesce(..., '[]')` + the LEFT join. Verify this in Step 4's check; if it drops the row instead, switch to `coalesce(d.user_ids, '["__none__"]'::jsonb)` and map the sentinel to NULL in TS — but the LEFT-lateral form is correct.

- [ ] **Step 3: Apply the migration to the cloud (authorized per-session)**

Run: `supabase db push --linked`
Expected: applies cleanly; `supabase migration list` shows it LOCAL==REMOTE.

- [ ] **Step 4: Smoke-test the RPC shape via SQL**

Run (psql or the Supabase SQL editor / MCP `execute_sql`):

```sql
select * from public.workload_rollup(current_date - 14, current_date + 70) limit 5;
```

Expected: returns the 7 columns; an assigned dated item appears once per assignee; a dated item with no assignee appears once with `user_id = NULL`; subitems are absent. (If empty because no test data, seed one dated+assigned item on a board and re-run.)

- [ ] **Step 5: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` gains `member_capacity` + `org_workload_settings` tables and the `workload_rollup` / `can_edit_member_capacity` functions. (If a PostHog telemetry line leaks in, strip the line containing `'"_tag"'` before prettier — see north-star manual-gates note.)

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no consumers yet; proves the generated types are valid).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations src/types/database.types.ts
git commit -m "feat(workload): schema, capacity gate, RLS, workload_rollup RPC"
```

---

## Task 2: Validation schemas (Zod)

**Files:**

- Create: `src/lib/validations/workload.ts`
- Test: `src/lib/validations/workload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  upsertMemberCapacitySchema,
  setWorkloadDefaultsSchema,
  workloadWindowSchema,
} from "@/lib/validations/workload";

describe("upsertMemberCapacitySchema", () => {
  it("accepts valid capacity", () => {
    const r = upsertMemberCapacitySchema.safeParse({
      userId: "11111111-1111-1111-1111-111111111111",
      hoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(r.success).toBe(true);
  });
  it("rejects hours over 24", () => {
    const r = upsertMemberCapacitySchema.safeParse({
      userId: "11111111-1111-1111-1111-111111111111",
      hoursPerDay: 30,
      workingDays: [1],
    });
    expect(r.success).toBe(false);
  });
  it("rejects an out-of-range weekday", () => {
    const r = upsertMemberCapacitySchema.safeParse({
      userId: "11111111-1111-1111-1111-111111111111",
      hoursPerDay: 8,
      workingDays: [0, 8],
    });
    expect(r.success).toBe(false);
  });
});

describe("setWorkloadDefaultsSchema", () => {
  it("accepts valid defaults", () => {
    const r = setWorkloadDefaultsSchema.safeParse({
      defaultHoursPerDay: 8,
      defaultPerItemHours: 4,
      defaultWorkingDays: [1, 2, 3, 4, 5],
    });
    expect(r.success).toBe(true);
  });
  it("rejects negative per-item hours", () => {
    const r = setWorkloadDefaultsSchema.safeParse({
      defaultHoursPerDay: 8,
      defaultPerItemHours: -1,
      defaultWorkingDays: [1],
    });
    expect(r.success).toBe(false);
  });
});

describe("workloadWindowSchema", () => {
  it("accepts an ISO from/to pair", () => {
    const r = workloadWindowSchema.safeParse({
      from: "2026-06-01",
      to: "2026-08-31",
    });
    expect(r.success).toBe(true);
  });
  it("rejects a non-ISO date", () => {
    const r = workloadWindowSchema.safeParse({
      from: "June 1",
      to: "2026-08-31",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/validations/workload.test.ts`
Expected: FAIL — module `@/lib/validations/workload` not found.

- [ ] **Step 3: Write the schemas**

Create `src/lib/validations/workload.ts`:

```ts
import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date");
const weekday = z.number().int().min(1).max(7);
const workingDays = z.array(weekday).max(7);
const hoursPerDay = z.number().min(0).max(24);

export const upsertMemberCapacitySchema = z.object({
  userId: uuid,
  hoursPerDay,
  workingDays,
});

export const setWorkloadDefaultsSchema = z.object({
  defaultHoursPerDay: hoursPerDay,
  defaultPerItemHours: z.number().min(0),
  defaultWorkingDays: workingDays,
});

export const workloadWindowSchema = z.object({
  from: isoDate,
  to: isoDate,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/validations/workload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/workload.ts src/lib/validations/workload.test.ts
git commit -m "feat(workload): zod validation schemas"
```

---

## Task 3: Rollup helpers + types (pure TS — the heart of the slice)

**Files:**

- Create: `src/lib/workload/types.ts`, `src/lib/workload/rollup.ts`
- Test: `src/lib/workload/rollup.test.ts`

> Mirrors `src/lib/portfolios/rollup.ts` (`serverToday`, pure derivation) and `src/lib/goals/progress.ts` (pure tree math). All effort is in **seconds** internally; the UI formats to hours.

- [ ] **Step 1: Write `types.ts`**

```ts
import type { Tables } from "@/types/database.types";

export type MemberCapacityRow = Tables<"member_capacity">;

/** App fallbacks when an org has no org_workload_settings row. */
export const EFFORT_FALLBACK = {
  hoursPerDay: 8,
  perItemHours: 4,
  workingDays: [1, 2, 3, 4, 5] as number[], // ISO weekday: 1=Mon … 7=Sun
} as const;

export interface OrgWorkloadDefaults {
  hoursPerDay: number;
  perItemHours: number;
  workingDays: number[];
}

export interface MemberCapacity {
  userId: string;
  hoursPerDay: number;
  workingDays: number[];
  customized: boolean; // false ⇒ derived from org defaults
}

export interface WorkloadMember {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/** One raw row from workload_rollup(): one per (item, assignee). */
export interface WorkloadRawRow {
  itemId: string;
  boardId: string;
  itemName: string;
  userId: string | null; // null ⇒ unassigned
  startDate: string; // ISO
  endDate: string; // ISO
  estimateSecs: number | null;
}

export type CapacityState = "under" | "at" | "over" | "none";

export interface WeekBucket {
  weekKey: string; // ISO date of the bucket's start day
  label: string; // e.g. "Jun 1"
  workingDays: number; // count of working days in this bucket (for the row's member)
}

export interface BucketCell {
  weekKey: string;
  effortSecs: number;
  capacitySecs: number;
  ratio: number | null; // effort/capacity; null when capacity is 0
  state: CapacityState;
}

export interface MemberRow {
  userId: string | null; // null ⇒ the synthetic "Unassigned" row
  member: WorkloadMember | null;
  cells: BucketCell[];
  totalEffortSecs: number;
  totalCapacitySecs: number;
}

export interface WorkloadGrid {
  window: WeekBucket[]; // canonical column order (working-day counts are per-member; see note)
  rows: MemberRow[];
}
```

> **Note:** `WeekBucket.workingDays` in `window` is informational (uses the org default mask); each member's per-bucket `capacitySecs` is computed from **that member's** mask in `buildWorkloadGrid`. The `window` array fixes the column order/labels.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  spreadItemEffort,
  bucketByWeek,
  buildWindow,
  capacityState,
  buildWorkloadGrid,
} from "@/lib/workload/rollup";
import type {
  MemberCapacity,
  WorkloadMember,
  WorkloadRawRow,
} from "@/lib/workload/types";

const H = 3600;

describe("spreadItemEffort", () => {
  it("puts all effort on a single working day", () => {
    const m = spreadItemEffort(
      "2026-06-01",
      "2026-06-01",
      8 * H,
      [1, 2, 3, 4, 5],
    );
    expect(m.get("2026-06-01")).toBe(8 * H);
    expect([...m.keys()]).toHaveLength(1);
  });
  it("spreads evenly across working days, skipping the weekend", () => {
    // Mon 2026-06-01 .. Fri 2026-06-05 = 5 working days; Sat/Sun excluded
    const m = spreadItemEffort(
      "2026-06-01",
      "2026-06-07",
      10 * H,
      [1, 2, 3, 4, 5],
    );
    expect(m.get("2026-06-01")).toBeCloseTo(2 * H);
    expect(m.get("2026-06-05")).toBeCloseTo(2 * H);
    expect(m.has("2026-06-06")).toBe(false); // Saturday
    expect(m.has("2026-06-07")).toBe(false); // Sunday
  });
  it("falls back to the start day when the range has no working days", () => {
    // Sat..Sun with Mon-Fri mask → no working day; never drop effort
    const m = spreadItemEffort(
      "2026-06-06",
      "2026-06-07",
      4 * H,
      [1, 2, 3, 4, 5],
    );
    expect(m.get("2026-06-06")).toBe(4 * H);
  });
});

describe("bucketByWeek", () => {
  it("rolls per-day effort into Monday-start week buckets", () => {
    const perDay = new Map([
      ["2026-06-01", 2 * H], // Mon (week of Jun 1)
      ["2026-06-05", 2 * H], // Fri (same week)
      ["2026-06-08", 1 * H], // next Mon (week of Jun 8)
    ]);
    const b = bucketByWeek(perDay, 1);
    expect(b.get("2026-06-01")).toBe(4 * H);
    expect(b.get("2026-06-08")).toBe(1 * H);
  });
});

describe("buildWindow", () => {
  it("builds an ordered list of week buckets around today", () => {
    const w = buildWindow("2026-06-17", 1, 4, 1); // 1 back, 4 fwd, Mon start = 6 buckets
    expect(w).toHaveLength(6);
    expect(w[0].weekKey < w[5].weekKey).toBe(true);
    expect(w.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.weekKey))).toBe(true);
  });
});

describe("capacityState", () => {
  it("none when capacity is 0", () => {
    expect(capacityState(5 * H, 0)).toBe("none");
  });
  it("under / at / over thresholds", () => {
    expect(capacityState(10 * H, 40 * H)).toBe("under");
    expect(capacityState(40 * H, 40 * H)).toBe("at");
    expect(capacityState(50 * H, 40 * H)).toBe("over");
  });
});

describe("buildWorkloadGrid", () => {
  const members: WorkloadMember[] = [
    { userId: "u1", fullName: "Ann", email: null, avatarUrl: null },
  ];
  const caps: MemberCapacity[] = [
    {
      userId: "u1",
      hoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      customized: true,
    },
  ];
  const defaults = {
    hoursPerDay: 8,
    perItemHours: 4,
    workingDays: [1, 2, 3, 4, 5],
  };

  it("buckets an item's estimate into the right week for its assignee", () => {
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i1",
        boardId: "b1",
        itemName: "Task",
        userId: "u1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 8 * H,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    const cell = ann.cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cell.effortSecs).toBe(8 * H);
    expect(cell.capacitySecs).toBe(5 * 8 * H); // 5 working days × 8h
    expect(cell.state).toBe("under");
  });

  it("applies the per-item default when an item has no estimate", () => {
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i2",
        boardId: "b1",
        itemName: "No estimate",
        userId: "u1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: null,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    const cell = ann.cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cell.effortSecs).toBe(4 * H); // defaults.perItemHours
  });

  it("gives full effort to EACH of multiple assignees", () => {
    const members2: WorkloadMember[] = [
      { userId: "u1", fullName: "Ann", email: null, avatarUrl: null },
      { userId: "u2", fullName: "Bo", email: null, avatarUrl: null },
    ];
    const caps2: MemberCapacity[] = [
      {
        userId: "u1",
        hoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        customized: true,
      },
      {
        userId: "u2",
        hoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        customized: true,
      },
    ];
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i3",
        boardId: "b1",
        itemName: "Shared",
        userId: "u1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 6 * H,
      },
      {
        itemId: "i3",
        boardId: "b1",
        itemName: "Shared",
        userId: "u2",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 6 * H,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members2,
      caps2,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const cellOf = (uid: string) =>
      grid.rows
        .find((r) => r.userId === uid)!
        .cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cellOf("u1").effortSecs).toBe(6 * H);
    expect(cellOf("u2").effortSecs).toBe(6 * H);
  });

  it("collects unassigned items into a synthetic null-user row with capacity 0", () => {
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i4",
        boardId: "b1",
        itemName: "Orphan",
        userId: null,
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 4 * H,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const un = grid.rows.find((r) => r.userId === null)!;
    const cell = un.cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cell.effortSecs).toBe(4 * H);
    expect(cell.state).toBe("none"); // no capacity for the unassigned bucket
  });

  it("renders a zero-effort row for a member with no assignments", () => {
    const grid = buildWorkloadGrid(
      [],
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    expect(ann.totalEffortSecs).toBe(0);
    expect(ann.cells.every((c) => c.effortSecs === 0)).toBe(true);
  });

  it("uses org defaults for a member with no capacity row", () => {
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i5",
        boardId: "b1",
        itemName: "T",
        userId: "u1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 8 * H,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members,
      [],
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    const cell = ann.cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cell.capacitySecs).toBe(5 * 8 * H); // from defaults
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/workload/rollup.test.ts`
Expected: FAIL — module `@/lib/workload/rollup` not found.

- [ ] **Step 4: Write `rollup.ts`**

```ts
import type {
  BucketCell,
  CapacityState,
  MemberCapacity,
  MemberRow,
  OrgWorkloadDefaults,
  WeekBucket,
  WorkloadGrid,
  WorkloadMember,
  WorkloadRawRow,
} from "./types";

const DAY = 86_400_000;

/** Server "today" as an ISO date (UTC); passed explicitly so math stays testable. */
export function serverToday(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function isoToUTC(iso: string): number {
  return Date.parse(iso + "T00:00:00Z");
}
function utcToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
/** ISO weekday 1=Mon … 7=Sun for an ISO date. */
function isoWeekday(iso: string): number {
  const d = new Date(isoToUTC(iso)).getUTCDay(); // 0=Sun … 6=Sat
  return d === 0 ? 7 : d;
}
/** Start (ISO date) of the bucket containing `iso`, given a weekStartsOn (1=Mon). */
function weekStartOf(iso: string, weekStartsOn: number): string {
  const wd = isoWeekday(iso);
  const back = (wd - weekStartsOn + 7) % 7;
  return utcToIso(isoToUTC(iso) - back * DAY);
}

/** Spread `effortSecs` evenly across the working days in [start, end] (inclusive). */
export function spreadItemEffort(
  start: string,
  end: string,
  effortSecs: number,
  workingDays: number[],
): Map<string, number> {
  const mask = new Set(workingDays);
  const days: string[] = [];
  for (let ms = isoToUTC(start); ms <= isoToUTC(end); ms += DAY) {
    const iso = utcToIso(ms);
    if (mask.has(isoWeekday(iso))) days.push(iso);
  }
  const out = new Map<string, number>();
  if (days.length === 0) {
    out.set(start, effortSecs); // never drop effort
    return out;
  }
  const per = effortSecs / days.length;
  for (const d of days) out.set(d, (out.get(d) ?? 0) + per);
  return out;
}

/** Roll a per-day effort map up into week buckets keyed by the bucket start. */
export function bucketByWeek(
  perDay: Map<string, number>,
  weekStartsOn: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [iso, secs] of perDay) {
    const key = weekStartOf(iso, weekStartsOn);
    out.set(key, (out.get(key) ?? 0) + secs);
  }
  return out;
}

/** Count of working days in the 7-day bucket starting at `weekKey`. */
function workingDaysInBucket(weekKey: string, workingDays: number[]): number {
  const mask = new Set(workingDays);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    if (mask.has(isoWeekday(utcToIso(isoToUTC(weekKey) + i * DAY)))) n++;
  }
  return n;
}

/** Ordered visible week buckets around `today`. */
export function buildWindow(
  today: string,
  weeksBack: number,
  weeksFwd: number,
  weekStartsOn: number,
): WeekBucket[] {
  const startKey = weekStartOf(today, weekStartsOn);
  const buckets: WeekBucket[] = [];
  for (let i = -weeksBack; i <= weeksFwd; i++) {
    const weekKey = utcToIso(isoToUTC(startKey) + i * 7 * DAY);
    const d = new Date(isoToUTC(weekKey));
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    buckets.push({ weekKey, label, workingDays: 5 });
  }
  return buckets;
}

export function capacityState(
  effortSecs: number,
  capacitySecs: number,
): CapacityState {
  if (capacitySecs <= 0) return "none";
  if (effortSecs > capacitySecs) return "over";
  if (effortSecs === capacitySecs) return "at";
  return "under";
}

function resolveCapacity(
  userId: string,
  caps: MemberCapacity[],
  defaults: OrgWorkloadDefaults,
): { hoursPerDay: number; workingDays: number[] } {
  const c = caps.find((x) => x.userId === userId);
  return c
    ? { hoursPerDay: c.hoursPerDay, workingDays: c.workingDays }
    : { hoursPerDay: defaults.hoursPerDay, workingDays: defaults.workingDays };
}

/** Top-level assembler: raw rows → per-member week-bucketed effort vs. capacity. */
export function buildWorkloadGrid(
  rows: WorkloadRawRow[],
  members: WorkloadMember[],
  caps: MemberCapacity[],
  defaults: OrgWorkloadDefaults,
  today: string,
  weeksBack: number,
  weeksFwd: number,
  weekStartsOn: number,
): WorkloadGrid {
  const window = buildWindow(today, weeksBack, weeksFwd, weekStartsOn);
  const windowKeys = window.map((b) => b.weekKey);

  // effort per (userId|null) per weekKey
  const effort = new Map<string | null, Map<string, number>>();
  const ensure = (uid: string | null) => {
    let m = effort.get(uid);
    if (!m) {
      m = new Map<string, number>();
      effort.set(uid, m);
    }
    return m;
  };

  for (const row of rows) {
    const cap =
      row.userId === null
        ? { hoursPerDay: 0, workingDays: defaults.workingDays } // spread over default calendar
        : resolveCapacity(row.userId, caps, defaults);
    const effortSecs =
      row.estimateSecs != null
        ? row.estimateSecs
        : defaults.perItemHours * 3600;
    const perDay = spreadItemEffort(
      row.startDate,
      row.endDate,
      effortSecs,
      cap.workingDays,
    );
    const byWeek = bucketByWeek(perDay, weekStartsOn);
    const target = ensure(row.userId);
    for (const [weekKey, secs] of byWeek) {
      if (!windowKeys.includes(weekKey)) continue; // clamp to the visible window
      target.set(weekKey, (target.get(weekKey) ?? 0) + secs);
    }
  }

  const buildRow = (
    userId: string | null,
    member: WorkloadMember | null,
  ): MemberRow => {
    const eMap = effort.get(userId) ?? new Map<string, number>();
    const cap =
      userId === null ? null : resolveCapacity(userId, caps, defaults);
    let totalEffort = 0;
    let totalCap = 0;
    const cells: BucketCell[] = window.map((b) => {
      const effortSecs = eMap.get(b.weekKey) ?? 0;
      const capacitySecs =
        cap === null
          ? 0
          : workingDaysInBucket(b.weekKey, cap.workingDays) *
            cap.hoursPerDay *
            3600;
      totalEffort += effortSecs;
      totalCap += capacitySecs;
      return {
        weekKey: b.weekKey,
        effortSecs,
        capacitySecs,
        ratio: capacitySecs > 0 ? effortSecs / capacitySecs : null,
        state: capacityState(effortSecs, capacitySecs),
      };
    });
    return {
      userId,
      member,
      cells,
      totalEffortSecs: totalEffort,
      totalCapacitySecs: totalCap,
    };
  };

  const rowsOut: MemberRow[] = members.map((m) => buildRow(m.userId, m));
  if (effort.has(null)) rowsOut.unshift(buildRow(null, null)); // leading Unassigned row
  return { window, rows: rowsOut };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/workload/rollup.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workload/types.ts src/lib/workload/rollup.ts src/lib/workload/rollup.test.ts
git commit -m "feat(workload): pure spread/bucket/capacity grid helpers"
```

---

## Task 4: Queries (RSC data layer)

**Files:**

- Create: `src/lib/workload/queries.ts`

> Mirrors `src/lib/portfolios/queries.ts` (server-client idiom, `listOrgMembers` shape). Read it first. The org id comes from `getUserOrgs()` → `orgs[0].id` (the app's single-active-org convention used by every layout).

- [ ] **Step 1: Write `queries.ts`**

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/auth/session";
import { listOrgMembers } from "@/lib/boards/queries";
import { buildWorkloadGrid, serverToday } from "@/lib/workload/rollup";
import { EFFORT_FALLBACK } from "@/lib/workload/types";
import type {
  MemberCapacity,
  OrgWorkloadDefaults,
  WorkloadGrid,
  WorkloadMember,
  WorkloadRawRow,
} from "@/lib/workload/types";

export async function listOrgMembersForWorkload(
  orgId: string,
): Promise<WorkloadMember[]> {
  const members = await listOrgMembers(orgId); // { userId, fullName, email, avatarUrl }[]
  return members.map((m) => ({
    userId: m.userId,
    fullName: m.fullName,
    email: m.email,
    avatarUrl: m.avatarUrl,
  }));
}

export async function getMemberCapacities(
  orgId: string,
): Promise<MemberCapacity[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("member_capacity")
    .select("user_id, hours_per_day, working_days")
    .eq("org_id", orgId);
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    hoursPerDay: Number(r.hours_per_day),
    workingDays: (r.working_days ?? []).map(Number),
    customized: true,
  }));
}

export async function getWorkloadDefaults(
  orgId: string,
): Promise<OrgWorkloadDefaults> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("org_workload_settings")
    .select(
      "default_hours_per_day, default_per_item_hours, default_working_days",
    )
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) {
    return {
      hoursPerDay: EFFORT_FALLBACK.hoursPerDay,
      perItemHours: EFFORT_FALLBACK.perItemHours,
      workingDays: [...EFFORT_FALLBACK.workingDays],
    };
  }
  return {
    hoursPerDay: Number(data.default_hours_per_day),
    perItemHours: Number(data.default_per_item_hours),
    workingDays: (data.default_working_days ?? EFFORT_FALLBACK.workingDays).map(
      Number,
    ),
  };
}

/** One bounded pass: rollup RPC + members + capacities + defaults → assembled grid. */
export async function getWorkloadGrid(
  from: string,
  to: string,
  now: number,
  weeksBack = 1,
  weeksFwd = 4,
  weekStartsOn = 1,
): Promise<{ grid: WorkloadGrid; orgId: string }> {
  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id ?? "";
  const supabase = await createClient();
  const [{ data: raw }, members, caps, defaults] = await Promise.all([
    supabase.rpc("workload_rollup", { p_from: from, p_to: to }),
    listOrgMembersForWorkload(orgId),
    getMemberCapacities(orgId),
    getWorkloadDefaults(orgId),
  ]);

  const rows: WorkloadRawRow[] = (raw ?? []).map((r) => ({
    itemId: r.item_id,
    boardId: r.board_id,
    itemName: r.item_name,
    userId: r.user_id,
    startDate: r.start_date,
    endDate: r.end_date,
    estimateSecs: r.estimate_secs == null ? null : Number(r.estimate_secs),
  }));

  const grid = buildWorkloadGrid(
    rows,
    members,
    caps,
    defaults,
    serverToday(now),
    weeksBack,
    weeksFwd,
    weekStartsOn,
  );
  return { grid, orgId };
}
```

> **Implementer note:** confirm `listOrgMembers` is exported from `@/lib/boards/queries` with the `{ userId, fullName, email, avatarUrl }` shape (it is — see the People-column primitive map). If the export name differs, adjust the import; keep the `WorkloadMember` shape.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (RPC return columns from T1 resolve; `WorkloadRawRow`/`WorkloadGrid` from T3 resolve).

- [ ] **Step 3: Commit**

```bash
git add src/lib/workload/queries.ts
git commit -m "feat(workload): RSC query layer (grid assembly off workload_rollup)"
```

---

## Task 5: Server Actions

**Files:**

- Create: `src/lib/workload/actions.ts`

> Mirrors `src/lib/portfolios/actions.ts` (the `ActionResult` / `fail` helpers, `revalidatePath` discipline). Both edits are **direct RLS-gated table writes** (the 7a direct-update pattern) — RLS (`can_edit_member_capacity` / org-admin) is the real boundary.

- [ ] **Step 1: Write `actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/auth/session";
import {
  setWorkloadDefaultsSchema,
  upsertMemberCapacitySchema,
} from "@/lib/validations/workload";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

export async function upsertMemberCapacity(
  input: z.input<typeof upsertMemberCapacitySchema>,
): Promise<ActionResult<null>> {
  const parsed = upsertMemberCapacitySchema.safeParse(input);
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

  // RLS (can_edit_member_capacity) gates this; the unique (org_id,user_id) drives the upsert.
  const { error } = await supabase.from("member_capacity").upsert(
    {
      org_id: orgId,
      user_id: d.userId,
      hours_per_day: d.hoursPerDay,
      working_days: d.workingDays,
      created_by: user.id,
    },
    { onConflict: "org_id,user_id" },
  );
  if (error) return fail(error.message);

  revalidatePath("/workload");
  return { ok: true, data: null };
}

export async function setWorkloadDefaults(
  input: z.input<typeof setWorkloadDefaultsSchema>,
): Promise<ActionResult<null>> {
  const parsed = setWorkloadDefaultsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id;
  if (!orgId) return fail("No organization.");

  const supabase = await createClient();
  // RLS (has_org_role owner/admin) gates this write.
  const { error } = await supabase.from("org_workload_settings").upsert(
    {
      org_id: orgId,
      default_hours_per_day: d.defaultHoursPerDay,
      default_per_item_hours: d.defaultPerItemHours,
      default_working_days: d.defaultWorkingDays,
    },
    { onConflict: "org_id" },
  );
  if (error) return fail(error.message);

  revalidatePath("/workload");
  return { ok: true, data: null };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (`TablesInsert<"member_capacity">` / `org_workload_settings` keys match the migration).

- [ ] **Step 3: Commit**

```bash
git add src/lib/workload/actions.ts
git commit -m "feat(workload): server actions (upsert capacity / set defaults)"
```

---

## Task 6: Integration test — RPC + RLS + can_read_board + capacity gate (live)

**Files:**

- Create: `src/lib/workload/workload.rls.integration.test.ts`

> Mirrors `src/lib/portfolios/portfolios.rls.integration.test.ts`. Reuse its `provisionUser` helper, the `signInWithRetry` import (`@/test/integration-auth`), the `describe.skipIf(!SERVICE_ROLE_KEY)` guard, and the admin-client board/people/date/estimate seeding (copy the board+columns+item seeding; add a `people` cell with `{ userIds: [...] }`, a `date` cell with `{ date, end }`, and a `time_tracking` estimate cell `{ estimateSeconds }`). **`*.integration.test.ts` silently skips without `.env.local`** — `start-task.sh` symlinks it into the worktree; confirm it's present.

- [ ] **Step 1: Write the failing test**

```ts
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!SERVICE_ROLE_KEY)("RLS + rollup: workload", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];
  let aAnon: SupabaseClient<Database>; // org A owner
  let aMember: SupabaseClient<Database>; // org A plain member
  let bAnon: SupabaseClient<Database>; // org B outsider
  let orgAId: string;
  let aOwnerId: string;
  let aMemberId: string;

  // (copy provisionUser from the portfolios integration test; seed in beforeAll:
  //  org A with a board that has date + people + time_tracking columns and one
  //  item dated within [today-7, today+7], assigned to aOwnerId, estimate 8h.)

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    // ... provision org A owner + plain member, org B outsider; seed board+item ...
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("workload_rollup returns the assigned dated item for the org owner", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 14 * 86400000)
      .toISOString()
      .slice(0, 10);
    const to = new Date(Date.now() + 70 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await aAnon.rpc("workload_rollup", {
      p_from: from,
      p_to: to,
    });
    expect(error).toBeNull();
    expect((data ?? []).some((r) => r.user_id === aOwnerId)).toBe(true);
    void today;
  });

  it("cross-org isolation: org B's rollup does not see org A's items", async () => {
    const from = new Date(Date.now() - 14 * 86400000)
      .toISOString()
      .slice(0, 10);
    const to = new Date(Date.now() + 70 * 86400000).toISOString().slice(0, 10);
    const { data } = await bAnon.rpc("workload_rollup", {
      p_from: from,
      p_to: to,
    });
    // org B can read none of org A's boards → no rows for the seeded item
    expect(
      (data ?? []).every((r) => r.board_id !== /* seededBoardId */ ""),
    ).toBe(true);
  });

  it("can_read_board gating: a member who can't read the board gets no credit", async () => {
    // If the seeded board is private/unshared to aMember, aMember's rollup omits it.
    const from = new Date(Date.now() - 14 * 86400000)
      .toISOString()
      .slice(0, 10);
    const to = new Date(Date.now() + 70 * 86400000).toISOString().slice(0, 10);
    const { data } = await aMember.rpc("workload_rollup", {
      p_from: from,
      p_to: to,
    });
    // assert the seeded item is absent for a non-reader (fill seededItemId)
    expect((data ?? []).every((r) => r.item_id !== /* seededItemId */ "")).toBe(
      true,
    );
  });

  it("capacity edit: self can upsert, an unrelated member cannot edit another's row", async () => {
    const ins = await aMember.from("member_capacity").upsert(
      {
        org_id: orgAId,
        user_id: aMemberId,
        hours_per_day: 6,
        working_days: [1, 2, 3, 4, 5],
        created_by: aMemberId,
      },
      { onConflict: "org_id,user_id" },
    );
    expect(ins.error).toBeNull(); // self-edit allowed

    const bad = await aMember.from("member_capacity").upsert(
      {
        org_id: orgAId,
        user_id: aOwnerId,
        hours_per_day: 1,
        working_days: [1],
        created_by: aMemberId,
      },
      { onConflict: "org_id,user_id" },
    );
    expect(bad.error).not.toBeNull(); // editing someone else's capacity is RLS-denied
  });
});
```

- [ ] **Step 2: Run it (skips without secrets)**

Run: `pnpm vitest run src/lib/workload/workload.rls.integration.test.ts`
Expected (with `.env.local`): FAIL on the stubbed seeding until filled. Without secrets: SKIPS.

- [ ] **Step 3: Fill in the seeding + the `/* seededBoardId */` / `/* seededItemId */` placeholders**

Complete `provisionUser`, the board seeding (board + date/people/time_tracking columns + one dated, assigned, estimated item), capture `seededBoardId` / `seededItemId`, and substitute them into the three assertions above.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/lib/workload/workload.rls.integration.test.ts`
Expected: PASS (all cases green against the live cloud DB).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workload/workload.rls.integration.test.ts
git commit -m "test(workload): live RLS + can_read_board + capacity-gate"
```

---

## Task 7: UI components

**Files:**

- Create: `src/components/workload/CapacityCell.tsx`, `MemberRowHeader.tsx`, `WorkloadGrid.tsx`, `CapacityEditor.tsx`, `WorkloadDefaultsDialog.tsx`
- Test: `src/components/workload/CapacityCell.test.tsx`

> **Load the `pulse-ui` + `frontend-design` skills first** (AGENTS.md #3) for tokens + the capacity color semantics (under = muted, at = accent, over = warning/destructive).
>
> **Scaffold sources (copy then adapt — known in-repo components):**
>
> - `CapacityCell` ← a small badge/cell; render `formatHours(effortSecs)` over `formatHours(capacitySecs)` and color by `state`. Reuse `formatDuration` from `src/lib/boards/time-format.ts` (or a local `Math.round(secs/3600)+"h"`).
> - `MemberRowHeader` ← `src/components/portfolios/` row-owner cell idiom (avatar + name); add the row total + a capacity-editor trigger.
> - `WorkloadGrid` ← `src/components/portfolios/PortfolioGrid.tsx` for the History-API sort/filter pattern (`pushState`, read from `useSearchParams`, **0 refetch**). Sticky-left member column + horizontally scrollable week columns; sort by `?sort=name|load`, filter by `?ws=<id>` (client-side filter over loaded rows — note: workspace/board filtering needs each row's contributing board/workspace; if not carried on the grid, scope v1 filter to **sort only** and defer board/workspace filter — see Step 3).
> - `CapacityEditor` ← `src/components/portfolios/EditPlacementPopover.tsx` form idiom; fields `hoursPerDay` + working-day checkboxes; calls `upsertMemberCapacity`; enabled for self or org admin (pass an `canEdit` prop computed in the page).
> - `WorkloadDefaultsDialog` ← `src/components/portfolios/NewPortfolioDialog.tsx` dialog idiom; org-admin-only; calls `setWorkloadDefaults`.

- [ ] **Step 1: Build `CapacityCell` + a render test**

Create `src/components/workload/CapacityCell.tsx` and `src/components/workload/CapacityCell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CapacityCell } from "@/components/workload/CapacityCell";

describe("CapacityCell", () => {
  it("shows the effort / capacity readout in hours", () => {
    render(
      <CapacityCell
        effortSecs={18 * 3600}
        capacitySecs={40 * 3600}
        state="under"
      />,
    );
    expect(screen.getByText(/18h/)).toBeInTheDocument();
    expect(screen.getByText(/40h/)).toBeInTheDocument();
  });
  it("renders an over-capacity cell distinctly", () => {
    render(
      <CapacityCell
        effortSecs={50 * 3600}
        capacitySecs={40 * 3600}
        state="over"
      />,
    );
    expect(screen.getByText(/50h/)).toBeInTheDocument();
    // the over state applies a data attribute the test can assert
    expect(screen.getByTestId("capacity-cell")).toHaveAttribute(
      "data-state",
      "over",
    );
  });
});
```

- [ ] **Step 2: Run the render test**

Run: `pnpm vitest run src/components/workload/CapacityCell.test.tsx`
Expected: PASS (after implementing `CapacityCell` with a `data-testid="capacity-cell" data-state={state}` wrapper).

- [ ] **Step 3: Build `MemberRowHeader`, `WorkloadGrid`, `CapacityEditor`, `WorkloadDefaultsDialog`** per the scaffold notes. For v1, the in-page control is **sort** (`?sort=name|load`) via the History API (0 refetch); workspace/board filtering is **deferred** unless the grid rows carry workspace/board (they don't in T3's `MemberRow`) — note this in the component and the closing message.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (watch the `react-hooks/set-state-in-effect` rule — set any URL-derived state in effects async, as relations/6f did).

- [ ] **Step 5: Commit**

```bash
git add src/components/workload
git commit -m "feat(workload): grid, capacity editor, defaults dialog, cells"
```

---

## Task 8: Route + sidebar wiring

**Files:**

- Create: `src/app/workload/layout.tsx`, `src/app/workload/page.tsx`
- Modify: `src/components/sidebar.tsx`, `src/components/app-shell.test.tsx`

> `layout.tsx` ← `src/app/portfolios/layout.tsx` (same `requireUser()` + `AppShell` shell, `TimeZoneProvider`). `page.tsx` is an RSC: compute the default window from `Date.now()`, call `getWorkloadGrid(from, to, Date.now())`, render `<WorkloadGrid grid={grid} ... />` + the defaults dialog + capacity editors. (Reading `Date.now()` in an RSC is fine — the purity rule is about the client render path; pass it into `getWorkloadGrid`.)

- [ ] **Step 1: Update the failing app-shell test first**

In `src/components/app-shell.test.tsx`, extend the nav assertion so Workload is a live link (add alongside the existing Dashboards/Portfolios/Goals link assertions):

```tsx
expect(screen.getByText("Workload").closest("a")).toHaveAttribute(
  "href",
  "/workload",
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/app-shell.test.tsx`
Expected: FAIL — no Workload nav item yet.

- [ ] **Step 3: Add the sidebar item + build the route**

In `src/components/sidebar.tsx`, add to the `nav` array (import `Gauge` from `lucide-react`):

```tsx
  { label: "Workload", icon: Gauge, href: "/workload" },
```

Then create `src/app/workload/layout.tsx` (copy `portfolios/layout.tsx`) and `src/app/workload/page.tsx`:

```tsx
// src/app/workload/page.tsx
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { isOrgAdmin } from "@/lib/org/guard";
import { getWorkloadGrid } from "@/lib/workload/queries";
import { WorkloadGrid } from "@/components/workload/WorkloadGrid";

function defaultWindow(now: number): { from: string; to: string } {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(now - 14 * 86400000), to: iso(now + 70 * 86400000) }; // 12-week horizon
}

export default async function WorkloadPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = Date.now();
  const win =
    sp.from && sp.to ? { from: sp.from, to: sp.to } : defaultWindow(now);

  const [{ grid }, orgAdmin] = await Promise.all([
    getWorkloadGrid(win.from, win.to, now),
    isOrgAdmin(),
  ]);

  return (
    <WorkloadGrid grid={grid} currentUserId={user.id} isOrgAdmin={orgAdmin} />
  );
}
```

> **Note:** `from`/`to` come from `searchParams` so paging the window **beyond** the horizon is a genuine RSC load (per the budget). The default 12-week horizon means in-window sort/shift stays 0-refetch on the client.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/components/app-shell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/workload src/components/sidebar.tsx src/components/app-shell.test.tsx
git commit -m "feat(workload): /workload route + live sidebar link"
```

---

## Task 9: e2e happy path + final gate

**Files:**

- Create: `e2e/workload.spec.ts`

- [ ] **Step 1: Write the e2e spec**

```ts
import { test, expect } from "@playwright/test";
// reuse the repo's auth fixture/login helper used by e2e/portfolios.spec.ts

test.describe("workload", () => {
  test("renders the workload grid with a member row and a week timeline", async ({
    page,
  }) => {
    // sign in (copy the login steps from e2e/portfolios.spec.ts)
    await page.goto("/workload");

    // the grid renders: at least one member row header + week column headers
    await expect(
      page.getByRole("heading", { name: /workload/i }),
    ).toBeVisible();
    // a capacity cell readout shows an "h / h" format somewhere in the grid
    await expect(page.getByText(/\dh\s*\/\s*\d+h/).first()).toBeVisible();

    // open a capacity editor on a member row and save (self capacity)
    await page
      .getByRole("button", { name: /capacity/i })
      .first()
      .click();
    await page.getByLabel(/hours per day/i).fill("6");
    await page.getByRole("button", { name: /save/i }).click();
    // after revalidation, the member's capacity reflects 6h/day (30h over a 5-day week)
    await expect(page.getByText(/30h/).first()).toBeVisible();
  });
});
```

> If the seeded test org has no dated+assigned items, the `h / h` assertion may need a seeding step (or assert only the grid shell + a member row). Keep the e2e resilient: assert the **grid shell + at least one member row** as the must-pass, and treat the capacity-edit round-trip as the primary behavior.

- [ ] **Step 2: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS (unit + integration suites green; Turbopack build succeeds). Build in the **main checkout** for a clean compile graph if the in-worktree Turbopack build hits the known root-inference issue, then merge by hand per the worktree-gates note.

Run (local, with secrets): `pnpm e2e -- workload.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit + finish the task**

```bash
git add e2e/workload.spec.ts
git commit -m "test(workload): e2e happy path (grid renders + capacity edit)"
```

Then merge + clean up per the working agreement:

Run: `scripts/finish-task.sh`
Expected: gate re-runs green → `task/workload-7c` merged into `develop`, pushed → worktree removed + branch deleted. (If the worktree gates fail spuriously — bins not on PATH, in-worktree build, integration tests skipping — run the gate manually in the main checkout and merge by hand, per the worktree-gates memory.)

- [ ] **Step 4: Hand the user the "How to test this" walkthrough** (working agreement). A numbered manual-test guide: pull `develop`, `pnpm dev`, sidebar → Workload, observe the per-person week grid + over/under colors, edit your capacity, see the cells recolor; a second org sees none of your work.

---

## Self-Review (completed)

**Spec coverage:**

- §1 one-row-per-member week-bucketed effort vs. capacity, reading existing cells → T1 (`workload_rollup`) + T3 (`buildWorkloadGrid`).
- §2 effort source priority (estimate → org default; no-date excluded) → T1 (RPC selects estimate + only dated items) + T3 (`buildWorkloadGrid` default fallback).
- §2 multi-day even spread across working days → T3 (`spreadItemEffort`, tested incl. weekend exclusion + no-working-day fallback).
- §2 multi-assignee → full effort to each → T1 (one row per assignee) + T3 (dup test).
- §2 per-member capacity + org default → T1 (`member_capacity` + `org_workload_settings`) + T3 (`resolveCapacity`) + T5 (`upsertMemberCapacity`/`setWorkloadDefaults`).
- §2 Unassigned row → T1 (NULL user_id row) + T3 (synthetic null row, capacity 0).
- §3 data model → T1 (both tables, RLS, gate, trigger). **Q1 resolved to the separate `org_workload_settings` table** (core `organizations` untouched).
- §4 bounded RPC returning raw rows → T1; pure-TS derivation → T3.
- §5 RPCs/RLS + `can_edit_member_capacity` + `can_read_board` gate → T1; capacity edits as direct gated writes → T5; live proof → T6.
- §6 UI (`/workload` grid + capacity editor + defaults dialog + new sidebar item) → T7 + T8; `pulse-ui`/`frontend-design` skills flagged at T7.
- §7 testing → T3/T2 (unit), T6 (live integration), T9 (e2e).
- §7 perf budget → "Performance & data-fetching budget" section + the page's `searchParams` window (in-horizon = 0 refetch; beyond-horizon = explicit RSC nav).
- §8 build sequencing → "Execution DAG".

**Placeholder scan:** T6 references "copy the seeding/login from the portfolios test/spec" and carries `/* seededBoardId */` / `/* seededItemId */` markers that Step 3 explicitly fills — these point at exact in-repo files and enumerate each assertion, so they are concrete instructions, not vague TODOs. T7 names the exact donor component per file and flags the workspace/board-filter deferral (v1 = sort only) with a concrete reason (grid rows don't carry board/workspace). All code steps show complete code.

**Type consistency:** `WorkloadRawRow` / `WorkloadMember` / `MemberCapacity` / `OrgWorkloadDefaults` / `WeekBucket` / `BucketCell` / `MemberRow` / `WorkloadGrid` (T3) are consumed unchanged by queries (T4), the grid (T7), and the page (T8). `buildWorkloadGrid(rows, members, caps, defaults, today, weeksBack, weeksFwd, weekStartsOn)` has the same signature in T3's definition, T3's tests, and T4's caller. RPC name + args (`workload_rollup(p_from, p_to)`) and the gate (`can_edit_member_capacity(p_org_id, p_user_id)`) are identical across T1/T4/T6. Effort is **seconds** everywhere; only the UI (`CapacityCell`, T7) formats to hours. Action input shapes (T5) are `z.input<typeof …>` of the T2 schemas.
