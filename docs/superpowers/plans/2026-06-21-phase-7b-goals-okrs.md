# Phase 7b — Goals / OKRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Worktree:** This is a feature build — start it with `scripts/start-task.sh goals-7b` and build inside the resulting `.claude/worktrees/goals-7b` worktree (working agreement #1). Not "done" until merged to `develop` + worktree/branch removed via `scripts/finish-task.sh`. **Parallel to 6d-3** — give the migration a timestamp **later than 6d-3's**; the only shared file is `src/components/sidebar.tsx` / `src/components/app-shell.test.tsx` (the Goals-stub flip), disjoint from 6d-3's board-table footer.

**Goal:** Ship an org-wide **Goals/OKRs** section at `/goals` — a recursive, person-owned goal tree where each goal measures progress one of four ways (manual number, manual %, auto from sub-goals, auto from contributing boards) and progress cascades bottom-up.

**Architecture:** Two org-scoped tables (`goals`, `goal_links`) mirroring the boards/portfolios RLS conventions, with a hierarchy trigger (same-org parent/workspace + cycle + depth cap). A `goals_rollup()` `SECURITY DEFINER` RPC returns **raw board aggregates** per visible linked board; pure TypeScript (`src/lib/goals/progress.ts`) assembles the tree and computes each goal's progress + auto-health post-order (Approach B from the spec). RSC loads everything in one pass; in-page expand/sort/filter use client state + the History API (0 RSC refetch); mutations are Server Actions — `create_goal` / `set_goal_links` via gated RPCs, all other edits via direct `can_edit_goal`-gated table updates (the 7a pattern).

**Tech Stack:** Next.js 16 (App Router, RSC, Server Actions), React 19, Supabase (Postgres + RLS), Zod, @tanstack/react-query, shadcn/ui, Tailwind v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-21-phase-7b-goals-okrs-design.md`

---

## File Structure

**Create:**

- `supabase/migrations/<ts>_goals.sql` — enums, 2 tables, hierarchy trigger, RLS, `can_edit_goal`, `create_goal` / `set_goal_links` / `goals_rollup` RPCs, grants.
- `src/lib/goals/types.ts` — `GoalProgressMode`, `GoalStatus`, `GoalHealth`, `GoalRow`, `BoardAgg`, `RowOwner`, `GoalNode`.
- `src/lib/goals/progress.ts` — pure helpers: `clamp01`, `leafProgress`, `computeGoalHealth`, `buildGoalTree`, `serverToday`.
- `src/lib/goals/progress.test.ts` — unit tests for the helpers.
- `src/lib/validations/goals.ts` — Zod input schemas.
- `src/lib/validations/goals.test.ts` — unit tests for the schemas.
- `src/lib/goals/queries.ts` — `getGoalsTree`, `listReadableBoards`, `getBoardStatusColumns`, `listOrgMembers`.
- `src/lib/goals/actions.ts` — `createGoal`, `updateGoal`, `deleteGoal`, `reorderGoal`, `setGoalLinks`, `getStatusColumnsForBoard`.
- `src/lib/goals/goals.rls.integration.test.ts` — live RPC + RLS + cycle guard.
- `src/components/goals/ProgressBar.tsx`, `src/components/goals/GoalStatusPill.tsx` — render bits.
- `src/components/goals/GoalTree.tsx` — client tree + expand/sort/filter (History API).
- `src/components/goals/GoalDetailDrawer.tsx` — `?goal=` drawer: edit fields, sub-goals, board links.
- `src/components/goals/NewGoalDialog.tsx` — create a goal.
- `src/app/goals/layout.tsx`, `src/app/goals/page.tsx`.
- `e2e/goals.spec.ts` — e2e happy path.

**Modify:**

- `src/components/sidebar.tsx:30` — give the `Goals` nav item an `href: "/goals"` (currently a disabled stub).
- `src/components/app-shell.test.tsx:95-113` — flip the Goals assertion from disabled-button to a `/goals` link.
- `src/types/database.types.ts` — regenerated after the migration (do not hand-edit).

---

## Execution DAG (AGENTS.md #6)

**Dependency graph**

- **T1 Migration + types** — root; everything depends on the generated types.
- **T2 Validations** ← T1
- **T3 Progress helpers + types** ← T1 (types only; pure logic)
- **T4 Queries** ← T1, T3
- **T5 Actions** ← T1, T2
- **T6 Integration test (RPC + RLS + cycle guard)** ← T1
- **T7 UI components** ← T3, T4, T5
- **T8 Route + sidebar wiring** ← T7, T4
- **T9 e2e + final gate** ← T8

**Parallel batches (waves of concurrent agents)**

- **Wave 0:** T1 (alone — schema root; applies a cloud migration, regenerates types).
- **Wave 1:** T2, T3, T6 (independent once T1 lands).
- **Wave 2:** T4, T5 (queries + actions).
- **Wave 3:** T7 (UI; depends on T4/T5/T3).
- **Wave 4:** T8 (route/sidebar), then T9 (e2e + gate).

**Critical path (wall-clock floor):** T1 → T4 → T7 → T8 → T9.

> When a wave has ≥2 tasks, dispatch them with `superpowers:dispatching-parallel-agents`. UI tasks that mutate files concurrently use isolated worktrees per `superpowers:using-git-worktrees`.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** one `getGoalsTree()` call = `goals` SELECT + `goals_rollup()` RPC + `listOrgMembers()`. Tree assembly + progress derivation are pure TS, no extra round-trips. **Interaction** (expand/collapse, sort, filter over loaded rows) = **client state + History API, 0 new server round-trips** (T7).
- **Server-data changes** (create/update/delete/reorder goal, set board links) = **Server Action + `revalidatePath("/goals")`** (T5).
- **Bounded over indexed columns:** `goals_rollup` reads over indexed `goal_links.goal_id` / `goal_links.board_id`, `items(board_id)`, `cell_values(item_id, column_id)`; goals are org-bounded.

---

## Task 1: Migration — schema, hierarchy trigger, RLS, RPCs + regenerated types

**Files:**

- Create: `supabase/migrations/<ts>_goals.sql` (timestamp **after** 6d-3's migration)
- Modify: `src/types/database.types.ts` (regenerated)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/<ts>_goals.sql` (use a real UTC timestamp, e.g. `20260621160000_goals.sql`, and confirm it sorts after 6d-3's):

```sql
-- Phase 7b: Goals/OKRs. Recursive, person-owned, org-wide goal tree.
-- Mirrors portfolios/boards conventions: denormalized org_id, is_org_member
-- RLS, set_updated_at trigger, position float8, SECURITY DEFINER RPCs.
-- Editing gated by can_edit_goal (creator OR owner OR org owner/admin).
-- goals_rollup returns RAW board aggregates for auto_boards goals; progress %
-- and auto-health are derived in TypeScript (src/lib/goals/progress.ts).

create type public.goal_progress_mode as enum
  ('manual_number', 'manual_percent', 'auto_subgoals', 'auto_boards');
create type public.goal_status as enum
  ('on_track', 'at_risk', 'off_track', 'done');

-- ── goals ─────────────────────────────────────────────────────────────────
create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 200),
  description    text,
  owner_id       uuid not null references auth.users (id),
  workspace_id   uuid references public.workspaces (id) on delete set null,
  parent_goal_id uuid references public.goals (id) on delete cascade,
  progress_mode  public.goal_progress_mode not null,
  status         public.goal_status not null default 'on_track',
  start_value    double precision,
  current_value  double precision,
  target_value   double precision,
  unit           text check (unit is null or char_length(unit) <= 40),
  percent        double precision check (percent is null or (percent >= 0 and percent <= 100)),
  start_date     date,
  due_date       date,
  position       double precision not null default 0,
  created_by     uuid not null references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index goals_org_id_idx on public.goals (org_id);
create index goals_parent_goal_id_idx on public.goals (parent_goal_id);

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- ── hierarchy guard: same-org parent/workspace, no cycle, depth ≤ 6 ─────────
create or replace function public.tg_goals_validate_hierarchy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cur       uuid;
  v_cur_org   uuid;
  v_depth     int := 0;
begin
  if new.workspace_id is not null
     and not exists (
       select 1 from public.workspaces w
       where w.id = new.workspace_id and w.org_id = new.org_id
     ) then
    raise exception 'workspace must belong to the same organization'
      using errcode = '23514';
  end if;

  if new.parent_goal_id is not null then
    if new.parent_goal_id = new.id then
      raise exception 'a goal cannot be its own parent' using errcode = '23514';
    end if;
    v_cur := new.parent_goal_id;
    while v_cur is not null loop
      v_depth := v_depth + 1;
      if v_cur = new.id then
        raise exception 'goal hierarchy cannot contain a cycle' using errcode = '23514';
      end if;
      if v_depth > 6 then
        raise exception 'goal hierarchy too deep (max 6 levels)' using errcode = '23514';
      end if;
      select parent_goal_id, org_id into v_cur, v_cur_org
      from public.goals where id = v_cur;
      if v_cur_org is not null and v_cur_org <> new.org_id then
        raise exception 'parent goal must belong to the same organization'
          using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end; $$;

create trigger goals_validate_hierarchy
  before insert or update on public.goals
  for each row execute function public.tg_goals_validate_hierarchy();

-- ── goal_links (board contributions for auto_boards) ────────────────────────
create table public.goal_links (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  goal_id         uuid not null references public.goals (id) on delete cascade,
  board_id        uuid not null references public.boards (id) on delete cascade,
  done_column_id  uuid references public.columns (id) on delete set null,
  done_option_ids jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  unique (goal_id, board_id)
);
create index goal_links_goal_id_idx on public.goal_links (goal_id);
create index goal_links_board_id_idx on public.goal_links (board_id);

-- ── edit gate: creator OR owner OR org owner/admin ──────────────────────────
create or replace function public.can_edit_goal(p_goal_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.goals g
    where g.id = p_goal_id
      and (
        g.created_by = (select auth.uid())
        or g.owner_id = (select auth.uid())
        or public.has_org_role(g.org_id, array['owner', 'admin']::public.org_role[])
      )
  );
$$;
grant execute on function public.can_edit_goal(uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.goals enable row level security;
create policy "goals: read if member" on public.goals
  for select using (public.is_org_member(org_id));
create policy "goals: insert if member" on public.goals
  for insert with check (public.is_org_member(org_id));
create policy "goals: update if editor" on public.goals
  for update using (public.can_edit_goal(id)) with check (public.can_edit_goal(id));
create policy "goals: delete if editor" on public.goals
  for delete using (public.can_edit_goal(id));

alter table public.goal_links enable row level security;
create policy "goal_links: read if member" on public.goal_links
  for select using (public.is_org_member(org_id));
create policy "goal_links: write if editor" on public.goal_links
  for all using (public.can_edit_goal(goal_id)) with check (public.can_edit_goal(goal_id));

-- ── create_goal (derives caller org; created_by = caller) ───────────────────
create or replace function public.create_goal(
  p_name           text,
  p_progress_mode  public.goal_progress_mode,
  p_owner_id       uuid,
  p_parent_goal_id uuid,
  p_workspace_id   uuid,
  p_status         public.goal_status,
  p_start_value    double precision,
  p_current_value  double precision,
  p_target_value   double precision,
  p_unit           text,
  p_percent        double precision,
  p_start_date     date,
  p_due_date       date
) returns public.goals
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_row    public.goals;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.org_members where user_id = v_uid limit 1;
  if v_org_id is null then
    raise exception 'no organization' using errcode = 'P0002';
  end if;

  insert into public.goals (
    org_id, name, progress_mode, owner_id, parent_goal_id, workspace_id,
    status, start_value, current_value, target_value, unit, percent,
    start_date, due_date, created_by
  ) values (
    v_org_id, p_name, p_progress_mode, coalesce(p_owner_id, v_uid), p_parent_goal_id,
    p_workspace_id, coalesce(p_status, 'on_track'), p_start_value, p_current_value,
    p_target_value, p_unit, p_percent, p_start_date, p_due_date, v_uid
  ) returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_goal(
  text, public.goal_progress_mode, uuid, uuid, uuid, public.goal_status,
  double precision, double precision, double precision, text, double precision, date, date
) to authenticated;

-- ── set_goal_links (atomic replace; gated; each board needs can_read_board) ──
create or replace function public.set_goal_links(p_goal_id uuid, p_links jsonb)
returns setof public.goal_links
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
  v_link   record;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.goals where id = p_goal_id;
  if v_org_id is null then
    raise exception 'goal not found' using errcode = 'P0002';
  end if;
  if not public.can_edit_goal(p_goal_id) then
    raise exception 'no edit access to this goal' using errcode = '42501';
  end if;

  delete from public.goal_links where goal_id = p_goal_id;

  for v_link in
    select * from jsonb_to_recordset(coalesce(p_links, '[]'::jsonb))
      as x(board_id uuid, done_column_id uuid, done_option_ids jsonb)
  loop
    if not public.can_read_board(v_link.board_id) then
      raise exception 'no read access to board %', v_link.board_id using errcode = '42501';
    end if;
    insert into public.goal_links (org_id, goal_id, board_id, done_column_id, done_option_ids)
    values (v_org_id, p_goal_id, v_link.board_id, v_link.done_column_id,
            coalesce(v_link.done_option_ids, '[]'::jsonb));
  end loop;

  return query select * from public.goal_links where goal_id = p_goal_id order by board_id;
end; $$;
revoke all on function public.set_goal_links(uuid, jsonb) from public;
grant execute on function public.set_goal_links(uuid, jsonb) to authenticated;

-- ── goals_rollup: RAW per-board aggregates for auto_boards goals ─────────────
-- One bounded read for the caller's org. "done" = item has a cell on the
-- link's done_column_id whose optionId ∈ done_option_ids. Excludes subitems.
create or replace function public.goals_rollup()
returns table (goal_id uuid, board_id uuid, total_items bigint, done_items bigint)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with gl as (
    select gl.goal_id, gl.board_id, gl.done_column_id,
           coalesce(gl.done_option_ids, '[]'::jsonb) as done_option_ids
    from public.goal_links gl
    join public.goals g on g.id = gl.goal_id and g.progress_mode = 'auto_boards'
    where public.is_org_member(gl.org_id)
      and public.can_read_board(gl.board_id)
  ),
  it as (
    select gl.goal_id, gl.board_id, i.id as item_id,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id
          and cv.column_id = gl.done_column_id
          and gl.done_option_ids ? (cv.value ->> 'optionId')
      ) as is_done
    from gl
    join public.items i on i.board_id = gl.board_id and i.parent_id is null
  )
  select gl.goal_id, gl.board_id,
    count(it.item_id) as total_items,
    count(it.item_id) filter (where it.is_done) as done_items
  from gl
  left join it on it.goal_id = gl.goal_id and it.board_id = gl.board_id
  group by gl.goal_id, gl.board_id;
end; $$;
grant execute on function public.goals_rollup() to authenticated;
```

- [ ] **Step 2: Apply the migration to the cloud (authorized per-session)**

Run: `supabase db push --linked`
Expected: the new migration applies cleanly; `supabase migration list` shows it LOCAL==REMOTE.

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` gains `goals` / `goal_links` tables, the two enums, and the `create_goal` / `set_goal_links` / `goals_rollup` / `can_edit_goal` functions. (If a PostHog telemetry line leaks in, strip the line containing `'"_tag"'` before prettier — see north-star manual-gates note.)

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no consumers yet; this just proves the generated types are valid).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations src/types/database.types.ts
git commit -m "feat(goals): schema, hierarchy guard, RLS, create/set-links/rollup RPCs"
```

---

## Task 2: Validation schemas (Zod)

**Files:**

- Create: `src/lib/validations/goals.ts`
- Test: `src/lib/validations/goals.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  createGoalSchema,
  updateGoalSchema,
  setGoalLinksSchema,
} from "@/lib/validations/goals";

describe("createGoalSchema", () => {
  it("accepts a minimal manual_percent goal", () => {
    const r = createGoalSchema.safeParse({
      name: "Grow ARR",
      progressMode: "manual_percent",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an empty name", () => {
    const r = createGoalSchema.safeParse({
      name: "",
      progressMode: "manual_percent",
    });
    expect(r.success).toBe(false);
  });
  it("rejects an unknown progress mode", () => {
    const r = createGoalSchema.safeParse({ name: "X", progressMode: "nope" });
    expect(r.success).toBe(false);
  });
});

describe("updateGoalSchema", () => {
  it("accepts a partial patch with a uuid id", () => {
    const r = updateGoalSchema.safeParse({
      goalId: "11111111-1111-1111-1111-111111111111",
      status: "at_risk",
    });
    expect(r.success).toBe(true);
  });
  it("rejects percent out of range", () => {
    const r = updateGoalSchema.safeParse({
      goalId: "11111111-1111-1111-1111-111111111111",
      percent: 140,
    });
    expect(r.success).toBe(false);
  });
});

describe("setGoalLinksSchema", () => {
  it("accepts a list of board links", () => {
    const r = setGoalLinksSchema.safeParse({
      goalId: "11111111-1111-1111-1111-111111111111",
      links: [
        {
          boardId: "22222222-2222-2222-2222-222222222222",
          doneColumnId: "33333333-3333-3333-3333-333333333333",
          doneOptionIds: ["44444444-4444-4444-4444-444444444444"],
        },
      ],
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/validations/goals.test.ts`
Expected: FAIL — module `@/lib/validations/goals` not found.

- [ ] **Step 3: Write the schemas**

Create `src/lib/validations/goals.ts`:

```ts
import { z } from "zod";

export const goalProgressMode = z.enum([
  "manual_number",
  "manual_percent",
  "auto_subgoals",
  "auto_boards",
]);
export const goalStatus = z.enum(["on_track", "at_risk", "off_track", "done"]);

const name = z.string().trim().min(1, "Name is required").max(200);
const percent = z.number().min(0).max(100);
const uuid = z.string().uuid();

export const createGoalSchema = z.object({
  name,
  progressMode: goalProgressMode,
  ownerId: uuid.optional(),
  parentGoalId: uuid.nullable().optional(),
  workspaceId: uuid.nullable().optional(),
  status: goalStatus.optional(),
  startValue: z.number().nullable().optional(),
  currentValue: z.number().nullable().optional(),
  targetValue: z.number().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  percent: percent.nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

export const updateGoalSchema = z.object({
  goalId: uuid,
  name: name.optional(),
  description: z.string().max(2000).nullable().optional(),
  ownerId: uuid.optional(),
  parentGoalId: uuid.nullable().optional(),
  workspaceId: uuid.nullable().optional(),
  progressMode: goalProgressMode.optional(),
  status: goalStatus.optional(),
  startValue: z.number().nullable().optional(),
  currentValue: z.number().nullable().optional(),
  targetValue: z.number().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  percent: percent.nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

export const reorderGoalSchema = z.object({
  goalId: uuid,
  position: z.number(),
});
export const deleteGoalSchema = z.object({ goalId: uuid });

export const setGoalLinksSchema = z.object({
  goalId: uuid,
  links: z
    .array(
      z.object({
        boardId: uuid,
        doneColumnId: uuid.nullable(),
        doneOptionIds: z.array(uuid),
      }),
    )
    .max(200),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/validations/goals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/goals.ts src/lib/validations/goals.test.ts
git commit -m "feat(goals): zod validation schemas"
```

---

## Task 3: Progress helpers + types (pure TS — the heart of the slice)

**Files:**

- Create: `src/lib/goals/types.ts`, `src/lib/goals/progress.ts`
- Test: `src/lib/goals/progress.test.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
import type { Tables } from "@/types/database.types";

export type GoalProgressMode = Tables<"goals">["progress_mode"];
export type GoalStatus = Tables<"goals">["status"];
export type GoalHealth = "on_track" | "at_risk" | "off_track";

export interface RowOwner {
  id: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/** A flat goal as loaded from the DB, camelCased for the client. */
export interface GoalRow {
  id: string;
  parentGoalId: string | null;
  name: string;
  description: string | null;
  ownerId: string;
  workspaceId: string | null;
  progressMode: GoalProgressMode;
  status: GoalStatus;
  startValue: number | null;
  currentValue: number | null;
  targetValue: number | null;
  unit: string | null;
  percent: number | null;
  startDate: string | null;
  dueDate: string | null;
  position: number;
}

/** Raw per-board aggregate row from goals_rollup(). */
export interface BoardAgg {
  goalId: string;
  boardId: string;
  total: number;
  done: number;
}

/** An assembled tree node with derived progress (0..1) + auto-health. */
export interface GoalNode extends GoalRow {
  children: GoalNode[];
  progress: number | null;
  autoHealth: GoalHealth | null;
  owner: RowOwner | null;
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  buildGoalTree,
  computeGoalHealth,
  leafProgress,
} from "@/lib/goals/progress";
import type { BoardAgg, GoalRow } from "@/lib/goals/types";

const base: Omit<GoalRow, "id" | "progressMode"> = {
  parentGoalId: null,
  name: "G",
  description: null,
  ownerId: "u1",
  workspaceId: null,
  status: "on_track",
  startValue: null,
  currentValue: null,
  targetValue: null,
  unit: null,
  percent: null,
  startDate: null,
  dueDate: null,
  position: 0,
};
const row = (over: Partial<GoalRow> & { id: string }): GoalRow => ({
  ...base,
  progressMode: "manual_percent",
  ...over,
});

describe("leafProgress", () => {
  it("manual_number: (current-start)/(target-start), clamped", () => {
    expect(
      leafProgress(
        row({
          id: "a",
          progressMode: "manual_number",
          startValue: 0,
          currentValue: 25,
          targetValue: 100,
        }),
        [],
      ),
    ).toBe(0.25);
  });
  it("manual_number: null when target === start", () => {
    expect(
      leafProgress(
        row({
          id: "a",
          progressMode: "manual_number",
          startValue: 10,
          currentValue: 10,
          targetValue: 10,
        }),
        [],
      ),
    ).toBeNull();
  });
  it("manual_percent: percent/100", () => {
    expect(
      leafProgress(
        row({ id: "a", progressMode: "manual_percent", percent: 60 }),
        [],
      ),
    ).toBe(0.6);
  });
  it("auto_boards: sum(done)/sum(total) across this goal's aggregates", () => {
    const aggs: BoardAgg[] = [
      { goalId: "a", boardId: "b1", total: 4, done: 1 },
      { goalId: "a", boardId: "b2", total: 6, done: 2 },
    ];
    expect(
      leafProgress(row({ id: "a", progressMode: "auto_boards" }), aggs),
    ).toBeCloseTo(0.3);
  });
  it("auto_boards: null when there are no items", () => {
    expect(
      leafProgress(row({ id: "a", progressMode: "auto_boards" }), []),
    ).toBeNull();
  });
  it("auto_subgoals: leaf returns null (resolved during roll-up)", () => {
    expect(
      leafProgress(row({ id: "a", progressMode: "auto_subgoals" }), []),
    ).toBeNull();
  });
});

describe("computeGoalHealth", () => {
  it("off_track when past due and unfinished", () => {
    expect(
      computeGoalHealth({
        progress: 0.5,
        startDate: "2026-01-01",
        dueDate: "2026-06-01",
        today: "2026-06-21",
      }),
    ).toBe("off_track");
  });
  it("at_risk when behind pace", () => {
    expect(
      computeGoalHealth({
        progress: 0.1,
        startDate: "2026-01-01",
        dueDate: "2026-12-31",
        today: "2026-07-01",
      }),
    ).toBe("at_risk");
  });
  it("on_track when ahead of pace", () => {
    expect(
      computeGoalHealth({
        progress: 0.9,
        startDate: "2026-01-01",
        dueDate: "2026-12-31",
        today: "2026-03-01",
      }),
    ).toBe("on_track");
  });
  it("null when no signal", () => {
    expect(
      computeGoalHealth({
        progress: null,
        startDate: null,
        dueDate: null,
        today: "2026-06-21",
      }),
    ).toBeNull();
  });
});

describe("buildGoalTree", () => {
  it("rolls auto_subgoals up as the equal-weight mean of children", () => {
    const rows: GoalRow[] = [
      row({ id: "root", progressMode: "auto_subgoals" }),
      row({
        id: "c1",
        parentGoalId: "root",
        progressMode: "manual_percent",
        percent: 40,
        position: 0,
      }),
      row({
        id: "c2",
        parentGoalId: "root",
        progressMode: "manual_percent",
        percent: 80,
        position: 1,
      }),
    ];
    const tree = buildGoalTree(rows, [], new Map(), "2026-06-21");
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("root");
    expect(tree[0].progress).toBeCloseTo(0.6);
    expect(tree[0].children.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
  it("excludes children with null progress from the mean", () => {
    const rows: GoalRow[] = [
      row({ id: "root", progressMode: "auto_subgoals" }),
      row({
        id: "c1",
        parentGoalId: "root",
        progressMode: "manual_percent",
        percent: 50,
      }),
      row({ id: "c2", parentGoalId: "root", progressMode: "auto_boards" }), // null (no items)
    ];
    const tree = buildGoalTree(rows, [], new Map(), "2026-06-21");
    expect(tree[0].progress).toBeCloseTo(0.5);
  });
  it("cascades through three levels (post-order)", () => {
    const rows: GoalRow[] = [
      row({ id: "co", progressMode: "auto_subgoals" }),
      row({ id: "team", parentGoalId: "co", progressMode: "auto_subgoals" }),
      row({
        id: "ic",
        parentGoalId: "team",
        progressMode: "manual_number",
        startValue: 0,
        currentValue: 50,
        targetValue: 100,
      }),
    ];
    const tree = buildGoalTree(rows, [], new Map(), "2026-06-21");
    expect(tree[0].progress).toBeCloseTo(0.5);
    expect(tree[0].children[0].progress).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/goals/progress.test.ts`
Expected: FAIL — module `@/lib/goals/progress` not found.

- [ ] **Step 4: Write `progress.ts`**

```ts
import type {
  BoardAgg,
  GoalHealth,
  GoalNode,
  GoalRow,
  RowOwner,
} from "./types";

const DAY = 86_400_000;
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / DAY;
}

/** Server "today" as an ISO date (UTC); passed explicitly so health stays testable. */
export function serverToday(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Progress (0..1) for a single goal, ignoring children. auto_subgoals → null here. */
export function leafProgress(
  goal: GoalRow,
  boardAggs: BoardAgg[],
): number | null {
  switch (goal.progressMode) {
    case "manual_number": {
      const start = goal.startValue ?? 0;
      const current = goal.currentValue ?? start;
      const target = goal.targetValue;
      if (target == null || target === start) return null;
      return clamp01((current - start) / (target - start));
    }
    case "manual_percent":
      return goal.percent == null ? null : clamp01(goal.percent / 100);
    case "auto_boards": {
      let total = 0;
      let done = 0;
      for (const a of boardAggs) {
        if (a.goalId !== goal.id) continue;
        total += a.total;
        done += a.done;
      }
      return total === 0 ? null : clamp01(done / total);
    }
    case "auto_subgoals":
      return null;
  }
}

export function computeGoalHealth(input: {
  progress: number | null;
  startDate: string | null;
  dueDate: string | null;
  today: string;
}): GoalHealth | null {
  const { progress, startDate, dueDate, today } = input;
  if (progress === null && dueDate === null) return null;
  if (
    dueDate !== null &&
    today > dueDate &&
    (progress === null || progress < 1)
  ) {
    return "off_track";
  }
  let behind = false;
  if (progress !== null && startDate !== null && dueDate !== null) {
    const span = daysBetween(startDate, dueDate);
    if (span > 0) {
      const elapsed = clamp01(daysBetween(startDate, today) / span);
      behind = progress < elapsed;
    }
  }
  return behind ? "at_risk" : "on_track";
}

/** Assemble flat rows into a forest, computing progress + auto-health post-order. */
export function buildGoalTree(
  rows: GoalRow[],
  boardAggs: BoardAgg[],
  owners: Map<string, RowOwner>,
  today: string,
): GoalNode[] {
  const byParent = new Map<string | null, GoalRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentGoalId) ?? [];
    list.push(r);
    byParent.set(r.parentGoalId, list);
  }

  const visiting = new Set<string>();
  function build(rowNode: GoalRow): GoalNode {
    visiting.add(rowNode.id);
    const children = (byParent.get(rowNode.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .filter((c) => !visiting.has(c.id)) // defensive cycle guard
      .map(build);
    visiting.delete(rowNode.id);

    let progress: number | null;
    if (rowNode.progressMode === "auto_subgoals") {
      const vals = children
        .map((c) => c.progress)
        .filter((p): p is number => p != null);
      progress =
        vals.length === 0
          ? null
          : clamp01(vals.reduce((s, v) => s + v, 0) / vals.length);
    } else {
      progress = leafProgress(rowNode, boardAggs);
    }

    return {
      ...rowNode,
      children,
      progress,
      autoHealth: computeGoalHealth({
        progress,
        startDate: rowNode.startDate,
        dueDate: rowNode.dueDate,
        today,
      }),
      owner: owners.get(rowNode.ownerId) ?? null,
    };
  }

  return (byParent.get(null) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(build);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/goals/progress.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/goals/types.ts src/lib/goals/progress.ts src/lib/goals/progress.test.ts
git commit -m "feat(goals): pure progress + tree roll-up helpers"
```

---

## Task 4: Queries (RSC data layer)

**Files:**

- Create: `src/lib/goals/queries.ts`

> Mirrors `src/lib/portfolios/queries.ts`. Read it first for the exact Supabase-server-client idiom, the `listOrgMembers` shape, and `getBoardStatusColumns` (reuse it — status columns are identical for goals' board mapping).

- [ ] **Step 1: Write `queries.ts`**

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildGoalTree, serverToday } from "@/lib/goals/progress";
import type { BoardAgg, GoalNode, GoalRow, RowOwner } from "@/lib/goals/types";

// Reuse the portfolio helpers verbatim — board status columns + readable boards
// are identical concerns for the auto_boards mapping picker.
export {
  getBoardStatusColumns,
  listReadableBoards,
} from "@/lib/portfolios/queries";

function toGoalRow(r: {
  id: string;
  parent_goal_id: string | null;
  name: string;
  description: string | null;
  owner_id: string;
  workspace_id: string | null;
  progress_mode: GoalRow["progressMode"];
  status: GoalRow["status"];
  start_value: number | null;
  current_value: number | null;
  target_value: number | null;
  unit: string | null;
  percent: number | null;
  start_date: string | null;
  due_date: string | null;
  position: number;
}): GoalRow {
  return {
    id: r.id,
    parentGoalId: r.parent_goal_id,
    name: r.name,
    description: r.description,
    ownerId: r.owner_id,
    workspaceId: r.workspace_id,
    progressMode: r.progress_mode,
    status: r.status,
    startValue: r.start_value,
    currentValue: r.current_value,
    targetValue: r.target_value,
    unit: r.unit,
    percent: r.percent,
    startDate: r.start_date,
    dueDate: r.due_date,
    position: r.position,
  };
}

export async function listOrgMembers(): Promise<Map<string, RowOwner>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url");
  const map = new Map<string, RowOwner>();
  for (const p of data ?? []) {
    map.set(p.id, {
      id: p.id,
      fullName: p.full_name,
      email: p.email,
      avatarUrl: p.avatar_url,
    });
  }
  return map;
}

/** One bounded pass: goals SELECT + goals_rollup() RPC + members → assembled tree. */
export async function getGoalsTree(now: number): Promise<GoalNode[]> {
  const supabase = await createClient();
  const [{ data: goals }, { data: aggs }, owners] = await Promise.all([
    supabase
      .from("goals")
      .select(
        "id, parent_goal_id, name, description, owner_id, workspace_id, progress_mode, status, start_value, current_value, target_value, unit, percent, start_date, due_date, position",
      )
      .order("position"),
    supabase.rpc("goals_rollup"),
    listOrgMembers(),
  ]);

  const rows: GoalRow[] = (goals ?? []).map(toGoalRow);
  const boardAggs: BoardAgg[] = (aggs ?? []).map((a) => ({
    goalId: a.goal_id,
    boardId: a.board_id,
    total: Number(a.total_items),
    done: Number(a.done_items),
  }));
  return buildGoalTree(rows, boardAggs, owners, serverToday(now));
}
```

> **Note for the implementer:** confirm the members source — `src/lib/portfolios/queries.ts` already has the canonical "org members for owner avatars" query. If it reads from a view other than `profiles`, copy that exact select instead of the `profiles` guess above; keep the `RowOwner` shape.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (types from T1 + T3 resolve; `goals_rollup` returns the four columns).

- [ ] **Step 3: Commit**

```bash
git add src/lib/goals/queries.ts
git commit -m "feat(goals): RSC query layer (tree assembly off goals_rollup)"
```

---

## Task 5: Server Actions

**Files:**

- Create: `src/lib/goals/actions.ts`

> Mirrors `src/lib/portfolios/actions.ts` (the `ActionResult` / `fail` helpers, the `revalidatePath` discipline, the RPC-vs-direct-update split). `createGoal` + `setGoalLinks` call RPCs; every other edit is a direct `can_edit_goal`-gated table update (the 7a pattern — reorder/rename/placement were all direct updates there).

- [ ] **Step 1: Write `actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  getBoardStatusColumns,
  type StatusColumn,
} from "@/lib/portfolios/queries";
import {
  createGoalSchema,
  deleteGoalSchema,
  reorderGoalSchema,
  setGoalLinksSchema,
  updateGoalSchema,
} from "@/lib/validations/goals";
import type { Json, Tables, TablesUpdate } from "@/types/database.types";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

export async function createGoal(
  input: z.input<typeof createGoalSchema>,
): Promise<ActionResult<{ goal: Tables<"goals"> }>> {
  const parsed = createGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_goal", {
    p_name: d.name,
    p_progress_mode: d.progressMode,
    p_owner_id: (d.ownerId ?? null) as unknown as string,
    p_parent_goal_id: (d.parentGoalId ?? null) as unknown as string,
    p_workspace_id: (d.workspaceId ?? null) as unknown as string,
    p_status: (d.status ?? null) as unknown as Tables<"goals">["status"],
    p_start_value: (d.startValue ?? null) as unknown as number,
    p_current_value: (d.currentValue ?? null) as unknown as number,
    p_target_value: (d.targetValue ?? null) as unknown as number,
    p_unit: (d.unit ?? null) as unknown as string,
    p_percent: (d.percent ?? null) as unknown as number,
    p_start_date: (d.startDate ?? null) as unknown as string,
    p_due_date: (d.dueDate ?? null) as unknown as string,
  });
  if (error || !data) return fail(error?.message ?? "Could not create goal.");

  revalidatePath("/goals");
  return { ok: true, data: { goal: data as Tables<"goals"> } };
}

export async function updateGoal(
  input: z.input<typeof updateGoalSchema>,
): Promise<ActionResult<null>> {
  const parsed = updateGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const patch: TablesUpdate<"goals"> = {};
  if ("name" in input) patch.name = d.name;
  if ("description" in input) patch.description = d.description;
  if ("ownerId" in input) patch.owner_id = d.ownerId;
  if ("parentGoalId" in input) patch.parent_goal_id = d.parentGoalId;
  if ("workspaceId" in input) patch.workspace_id = d.workspaceId;
  if ("progressMode" in input) patch.progress_mode = d.progressMode;
  if ("status" in input) patch.status = d.status;
  if ("startValue" in input) patch.start_value = d.startValue;
  if ("currentValue" in input) patch.current_value = d.currentValue;
  if ("targetValue" in input) patch.target_value = d.targetValue;
  if ("unit" in input) patch.unit = d.unit;
  if ("percent" in input) patch.percent = d.percent;
  if ("startDate" in input) patch.start_date = d.startDate;
  if ("dueDate" in input) patch.due_date = d.dueDate;

  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .update(patch)
    .eq("id", d.goalId);
  if (error) return fail(error.message);

  revalidatePath("/goals");
  return { ok: true, data: null };
}

export async function reorderGoal(
  input: z.input<typeof reorderGoalSchema>,
): Promise<ActionResult<null>> {
  const parsed = reorderGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.goalId);
  if (error) return fail(error.message);

  revalidatePath("/goals");
  return { ok: true, data: null };
}

export async function deleteGoal(
  input: z.input<typeof deleteGoalSchema>,
): Promise<ActionResult<null>> {
  const parsed = deleteGoalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .delete()
    .eq("id", parsed.data.goalId);
  if (error) return fail(error.message);

  revalidatePath("/goals");
  return { ok: true, data: null };
}

export async function setGoalLinks(
  input: z.input<typeof setGoalLinksSchema>,
): Promise<ActionResult<null>> {
  const parsed = setGoalLinksSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_goal_links", {
    p_goal_id: parsed.data.goalId,
    p_links: parsed.data.links.map((l) => ({
      board_id: l.boardId,
      done_column_id: l.doneColumnId,
      done_option_ids: l.doneOptionIds,
    })) as unknown as Json,
  });
  if (error) return fail(error.message);

  revalidatePath("/goals");
  return { ok: true, data: null };
}

export async function getStatusColumnsForBoard(
  boardId: string,
): Promise<ActionResult<{ columns: StatusColumn[] }>> {
  const parsed = z.string().uuid().safeParse(boardId);
  if (!parsed.success) return fail("Invalid board");
  const columns = await getBoardStatusColumns(parsed.data);
  return { ok: true, data: { columns } };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (RPC arg names match the migration; `TablesUpdate<"goals">` keys match).

- [ ] **Step 3: Commit**

```bash
git add src/lib/goals/actions.ts
git commit -m "feat(goals): server actions (create/update/delete/reorder/set-links)"
```

---

## Task 6: Integration test — RPC + RLS + cycle guard (live)

**Files:**

- Create: `src/lib/goals/goals.rls.integration.test.ts`

> Mirrors `src/lib/portfolios/portfolios.rls.integration.test.ts`. Reuse its `provisionUser` helper, the `signInWithRetry` import, the `describe.skipIf(!SERVICE_ROLE_KEY)` guard, and the admin-client seeding idiom (copy the `beforeAll` board/status-column/option seeding verbatim — goals' `auto_boards` needs the same 3-item board). **`*.integration.test.ts` silently skips without `.env.local`** — symlink it into the worktree first (worktree-gates note).

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";
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

describe.skipIf(!SERVICE_ROLE_KEY)("RLS + rollup: goals", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];
  let aAnon: SupabaseClient<Database>; // org A creator/owner
  let bAnon: SupabaseClient<Database>; // org B outsider
  let orgId: string;

  // (copy provisionUser + the 3-item status/date board seeding from the
  //  portfolios integration test; capture boardId, statusColumnId, doneOptionId)

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    // ... provision org A (creator) + org B (outsider); seed board in org A ...
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("create_goal sets created_by + owner and is readable by the creator", async () => {
    const { data, error } = await aAnon.rpc("create_goal", {
      p_name: "Company goal",
      p_progress_mode: "auto_subgoals",
      p_owner_id: null as unknown as string,
      p_parent_goal_id: null as unknown as string,
      p_workspace_id: null as unknown as string,
      p_status: null as unknown as Database["public"]["Enums"]["goal_status"],
      p_start_value: null as unknown as number,
      p_current_value: null as unknown as number,
      p_target_value: null as unknown as number,
      p_unit: null as unknown as string,
      p_percent: null as unknown as number,
      p_start_date: null as unknown as string,
      p_due_date: null as unknown as string,
    });
    expect(error).toBeNull();
    expect(data?.org_id).toBe(orgId);
  });

  it("rejects a self-parent / cycle on reparent", async () => {
    // create parent P and child C (C.parent = P); then try to set P.parent = C
    // expect the update to error with the cycle message.
  });

  it("cross-org isolation: org B cannot read org A's goals", async () => {
    const { data } = await bAnon.from("goals").select("id");
    expect((data ?? []).length).toBe(0);
  });

  it("can_edit_goal: a non-owner non-admin member cannot update", async () => {
    // provision a plain member of org A; their update of the creator's goal
    // affects 0 rows (RLS) — assert the row is unchanged.
  });

  it("auto_boards respects can_read_board: unreadable board yields no credit", async () => {
    // org A owner links a board; a member who can't read that board calls
    // goals_rollup() and sees no aggregate row for it.
  });
});
```

- [ ] **Step 2: Run it to verify it fails (or skips without secrets)**

Run: `pnpm vitest run src/lib/goals/goals.rls.integration.test.ts`
Expected (with `.env.local`): FAIL on the unimplemented stubbed `it` bodies until you fill the seeding. (Without secrets it SKIPS — fill in seeding and run locally where `.env.local` is symlinked.)

- [ ] **Step 3: Fill in the seeding + assertions**

Complete `provisionUser`, the board seeding (copy from the portfolios test), and each stubbed `it` body per its comment.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/lib/goals/goals.rls.integration.test.ts`
Expected: PASS (all cases green against the live cloud DB).

- [ ] **Step 5: Commit**

```bash
git add src/lib/goals/goals.rls.integration.test.ts
git commit -m "test(goals): live RLS + cycle-guard + auto_boards visibility"
```

---

## Task 7: UI components

**Files:**

- Create: `src/components/goals/ProgressBar.tsx`, `GoalStatusPill.tsx`, `GoalTree.tsx`, `GoalDetailDrawer.tsx`, `NewGoalDialog.tsx`

> **Scaffold sources (copy then adapt — these are known in-repo components, not vague TODOs):**
>
> - `ProgressBar` / `GoalStatusPill` ← `src/components/portfolios/ProgressBar.tsx` + `HealthPill.tsx` (add the `done` status). Progress is `0..1`; render `Math.round(progress*100)%` or "—" when null.
> - `GoalTree` ← `src/components/portfolios/PortfolioGrid.tsx` for the History-API sort/filter pattern (`pushState`, read from `useSearchParams`, **0 refetch**). Render recursively: a row per `GoalNode` with chevron (expand/collapse = client `Set<string>` of expanded ids), indent `paddingLeft: depth*20`, name, `ProgressBar`, `GoalStatusPill` (manual `status`; show `autoHealth` as a muted `·auto` hint when it differs), owner avatar, and the measurable readout (`{current}/{target} {unit}` for manual_number, `{percent}%` for manual_percent, rolled-up `%` otherwise). Clicking a row pushes `?goal=<id>`.
> - `GoalDetailDrawer` ← the existing item drawer (`?item=` History-API drawer) for the open/close-via-URL pattern, plus `src/components/portfolios/EditPlacementPopover.tsx` for the field-editing form idiom. Edits call `updateGoal`; "Add sub-goal" calls `createGoal({ parentGoalId })`; the board-links section reuses `AddBoardDialog`'s board + completion-mapping picker (`getStatusColumnsForBoard`) and calls `setGoalLinks`.
> - `NewGoalDialog` ← `src/components/portfolios/NewPortfolioDialog.tsx`, extended with the owner / parent / workspace / progress-mode + mode-fields / dates inputs; calls `createGoal`.

- [ ] **Step 1: Build `ProgressBar` + `GoalStatusPill`, with a render test**

Create the two render bits and `src/components/goals/GoalStatusPill.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoalStatusPill } from "@/components/goals/GoalStatusPill";

describe("GoalStatusPill", () => {
  it("shows the manual status label", () => {
    render(<GoalStatusPill status="at_risk" autoHealth="on_track" />);
    expect(screen.getByText(/at risk/i)).toBeInTheDocument();
  });
  it("shows the ·auto hint when auto-health differs from manual status", () => {
    render(<GoalStatusPill status="on_track" autoHealth="off_track" />);
    expect(screen.getByText(/auto/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the render test**

Run: `pnpm vitest run src/components/goals/GoalStatusPill.test.tsx`
Expected: PASS.

- [ ] **Step 3: Build `GoalTree`, `GoalDetailDrawer`, `NewGoalDialog`** per the scaffold notes above.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (watch the `react-hooks/set-state-in-effect` rule the 6f/relations work hit — set drawer state async in effects).

- [ ] **Step 5: Commit**

```bash
git add src/components/goals
git commit -m "feat(goals): tree, detail drawer, new-goal dialog, render bits"
```

---

## Task 8: Route + sidebar wiring

**Files:**

- Create: `src/app/goals/layout.tsx`, `src/app/goals/page.tsx`
- Modify: `src/components/sidebar.tsx:30`, `src/components/app-shell.test.tsx`

> `layout.tsx` ← `src/app/portfolios/layout.tsx` (same auth-guarded shell). `page.tsx` is an RSC: `const tree = await getGoalsTree(Date.now())`, render `<GoalTree tree={tree} members={...} /> ` + `<GoalDetailDrawer .../>` + the "New goal" button. (Reading `Date.now()` in an RSC is fine — it is NOT a workflow script; the purity rule is about the client render path. Pass it into `getGoalsTree` so the helper stays testable.)

- [ ] **Step 1: Update the failing app-shell test first**

In `src/components/app-shell.test.tsx`, change the "disabled stubs for Goals, Inbox" test so Goals is now a link:

```tsx
it("renders live Dashboards, Portfolios and Goals links and a disabled Inbox stub", () => {
  render(
    <AppShell>
      <div>content</div>
    </AppShell>,
  );
  expect(screen.getByText("Dashboards").closest("a")).toHaveAttribute(
    "href",
    "/dashboards",
  );
  expect(screen.getByText("Portfolios").closest("a")).toHaveAttribute(
    "href",
    "/portfolios",
  );
  expect(screen.getByText("Goals").closest("a")).toHaveAttribute(
    "href",
    "/goals",
  );
  expect(screen.getByText("Inbox").closest("button")).toBeDisabled();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/app-shell.test.tsx`
Expected: FAIL — Goals still renders a disabled `<button>`.

- [ ] **Step 3: Wire the sidebar + build the route**

In `src/components/sidebar.tsx:30` change the Goals nav item to:

```tsx
  { label: "Goals", icon: Target, href: "/goals" },
```

Then create `src/app/goals/layout.tsx` and `src/app/goals/page.tsx` per the scaffold note.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/components/app-shell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/goals src/components/sidebar.tsx src/components/app-shell.test.tsx
git commit -m "feat(goals): /goals route + live sidebar link"
```

---

## Task 9: e2e happy path + final gate

**Files:**

- Create: `e2e/goals.spec.ts`

- [ ] **Step 1: Write the e2e spec**

```ts
import { test, expect } from "@playwright/test";
// reuse the repo's auth fixture/login helper used by e2e/portfolios.spec.ts

test.describe("goals", () => {
  test("create a goal tree, link nothing, change status", async ({ page }) => {
    // sign in (copy the login steps from e2e/portfolios.spec.ts)
    await page.goto("/goals");

    // create a parent (auto_subgoals)
    await page.getByRole("button", { name: /new goal/i }).click();
    const parent = `Company goal ${Date.now()}`;
    await page.getByLabel(/name/i).fill(parent);
    await page.getByLabel(/measure/i).selectOption("auto_subgoals");
    await page.getByRole("button", { name: /create/i }).click();
    await expect(page.getByText(parent)).toBeVisible();

    // open the drawer, add a manual_percent child
    await page.getByText(parent).click();
    await expect(page).toHaveURL(/goal=/);
    await page.getByRole("button", { name: /add sub-goal/i }).click();
    const child = `KR ${Date.now()}`;
    await page.getByLabel(/name/i).fill(child);
    await page.getByLabel(/measure/i).selectOption("manual_percent");
    await page.getByLabel(/percent/i).fill("50");
    await page.getByRole("button", { name: /create/i }).click();

    // parent progress rolls up to ~50%
    await expect(page.getByText("50%")).toBeVisible();

    // change the parent status in the drawer
    await page.getByLabel(/status/i).selectOption("at_risk");
    await expect(page.getByText(/at risk/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS (unit + integration suites green; Turbopack build succeeds). Build in the **main checkout** for a clean compile graph per the worktree-gates note, then merge by hand if `finish-task.sh`'s in-worktree build can't run.

Run (local, with secrets): `pnpm e2e -- goals.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit + finish the task**

```bash
git add e2e/goals.spec.ts
git commit -m "test(goals): e2e happy path (create tree → roll-up → status)"
```

Then merge + clean up per the working agreement:

Run: `scripts/finish-task.sh`
Expected: gate re-runs green → `task/goals-7b` merged into `develop`, pushed → worktree removed + branch deleted. (If the worktree gates fail spuriously — bins not on PATH, in-worktree build, integration tests skipping — run the gate manually in the main checkout and merge by hand, per the worktree-gates memory.)

---

## Self-Review (completed)

**Spec coverage:**

- §1 recursive entity + 4 progress modes → T1 (`goals` table, `goal_progress_mode` enum) + T3 (`leafProgress`/`buildGoalTree`).
- §1 org-wide, person-owned, optional workspace → T1 (`org_id`, `owner_id`, nullable `workspace_id` + same-org guard).
- §1 manual status + auto-health hint → T3 (`computeGoalHealth`) + T7 (`GoalStatusPill` `·auto`).
- §3.1 `goals` + integrity triggers → T1 (table + `tg_goals_validate_hierarchy`: same-org, cycle, depth ≤ 6).
- §3.2 `goal_links` → T1 (table; note: columns named `done_column_id`/`done_option_ids` to match the portfolio rollup pattern, not the spec's `status_column_id` label — harmonized).
- §4 pure-TS derivation (Approach B) → T3, fed by §5's `goals_rollup` raw aggregates.
- §5 RPCs/RLS → T1 (`can_edit_goal`, `create_goal`, `set_goal_links`, `goals_rollup`, policies). Deviation: `update_goal`/`reorder_goal` are **direct `can_edit_goal`-gated table updates** in T5, not RPCs — matches the 7a pattern and the same RLS guarantee; flagged here intentionally.
- §6 UI (`/goals` tree + `?goal=` drawer) → T7 + T8.
- §7 testing → T3/T2 (unit), T6 (live integration incl. cycle guard + `can_read_board`), T9 (e2e).
- §8 build sequencing → "Execution DAG".

**Placeholder scan:** T6 and T9 reference "copy the seeding/login from the portfolios test/spec" rather than re-pasting ~100 lines of provisioning — these point at exact in-repo files (`portfolios.rls.integration.test.ts`, `e2e/portfolios.spec.ts`) and enumerate each assertion to fill, so they are concrete instructions, not vague TODOs. T7 UI scaffolds name the exact donor component per file. T4 flags the `profiles`-vs-view members-source as "confirm against `portfolios/queries.ts`".

**Type consistency:** `GoalRow`/`GoalNode`/`BoardAgg`/`RowOwner` (T3) are consumed unchanged by queries (T4), tree (T7), and the page (T8). Action input shapes (T5) are `z.input<typeof …>` of the T2 schemas. RPC names + arg lists (`create_goal`, `set_goal_links`, `goals_rollup`, `can_edit_goal`) are identical across T1/T4/T5/T6. `progress` is `0..1` everywhere (DB stores none of it); only the UI multiplies by 100.
