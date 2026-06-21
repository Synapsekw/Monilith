# Phase 7a — Portfolios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Worktree:** This is a feature build — start it with `scripts/start-task.sh portfolios-7a` and build inside the resulting `../Monolith-portfolios-7a` worktree (working agreement #1). Not "done" until merged to `develop` + worktree/branch removed via `scripts/finish-task.sh`.

**Goal:** Ship an org-wide **Portfolios** exec grid where each row is one board, summarizing it with auto-rolled progress/timeline/health plus manual owner/priority/budget/status — at `/portfolios`.

**Architecture:** Two org-scoped tables (`portfolios`, `portfolio_boards`) + a `can_edit_portfolio` gate, all mirroring boards/dashboards RLS conventions. A `SECURITY DEFINER` `portfolio_rollup(p_portfolio_id, p_today)` RPC returns **raw aggregates** per visible board (counts, timeline min/max, overdue); pure TypeScript helpers derive `progressPct` + `autoHealth` (testable, timezone-controllable). RSC loads everything in one pass; in-page sort/group/filter use client state + the History API (0 RSC refetch); all mutations are Server Actions with targeted `revalidatePath`.

**Tech Stack:** Next.js 16 (App Router, RSC, Server Actions), React 19, Supabase (Postgres + RLS), Zod, @tanstack/react-query, shadcn/ui, Tailwind v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-21-phase-7a-portfolios-design.md`

---

## File Structure

**Create:**

- `supabase/migrations/<ts>_portfolios.sql` — enums, 2 tables, RLS, `can_edit_portfolio`, 3 RPCs, grants.
- `src/lib/portfolios/types.ts` — `PortfolioHealth`, `PortfolioPriority`, `RollupRow`, `Placement`, `PortfolioRow`.
- `src/lib/portfolios/rollup.ts` — pure helpers: `progressPct`, `computeAutoHealth`, `mergeRows`, `serverToday`.
- `src/lib/portfolios/rollup.test.ts` — unit tests for the helpers.
- `src/lib/validations/portfolios.ts` — Zod input + value schemas.
- `src/lib/validations/portfolios.test.ts` — unit tests for the schemas.
- `src/lib/portfolios/queries.ts` — `listPortfolios`, `getPortfolio`, `getPortfolioRows`, `getBoardStatusColumns`, `listReadableBoards`.
- `src/lib/portfolios/actions.ts` — `createPortfolio`, `renamePortfolio`, `deletePortfolio`, `addBoardToPortfolio`, `removePortfolioBoard`, `updatePortfolioPlacement`, `updatePortfolioMapping`.
- `src/lib/portfolios/portfolios.rls.integration.test.ts` — live RPC + RLS.
- `src/components/portfolios/HealthPill.tsx`, `ProgressBar.tsx`, `PriorityPill.tsx` — render bits.
- `src/components/portfolios/PortfolioGrid.tsx` — client grid + sort/group/filter (History API).
- `src/components/portfolios/AddBoardDialog.tsx` — pick board + completion mapping.
- `src/components/portfolios/EditPlacementPopover.tsx` — edit manual fields.
- `src/components/portfolios/NewPortfolioDialog.tsx` — create portfolio.
- `src/app/portfolios/layout.tsx`, `src/app/portfolios/page.tsx`, `src/app/portfolios/[portfolioId]/page.tsx`.
- `e2e/portfolios.spec.ts` — e2e happy path.

**Modify:**

- `src/components/sidebar.tsx` — enable the `Portfolios` nav stub → link to `/portfolios`.
- `src/types/database.types.ts` — regenerated after the migration (do not hand-edit).

---

## Execution DAG (AGENTS.md #6)

**Dependency graph**

- **T1 Migration + types** — root; everything depends on the generated types.
- **T2 Validations** ← T1
- **T3 Rollup helpers + types** ← T1 (types only; pure logic)
- **T4 Queries** ← T1, T2, T3
- **T5 Actions** ← T1, T2
- **T6 Integration test (RPC + RLS)** ← T1
- **T7 UI components** ← T3, T4, T5
- **T8 Routes + sidebar wiring** ← T7, T4
- **T9 e2e + final gate** ← T8

**Parallel batches (waves of concurrent agents)**

- **Wave 0:** T1 (alone — schema root; applies a cloud migration, regenerates types).
- **Wave 1:** T2, T3, T6 (independent once T1 lands — validations, pure helpers, the RPC/RLS integration test).
- **Wave 2:** T4, T5 (queries + actions; depend on T2/T3).
- **Wave 3:** T7 (UI; depends on T4/T5/T3).
- **Wave 4:** T8 (routes/sidebar), then T9 (e2e + gate).

**Critical path (wall-clock floor):** T1 → T4 → T7 → T8 → T9.

> When a wave has ≥2 tasks, dispatch them with `superpowers:dispatching-parallel-agents`. UI tasks that mutate files concurrently use isolated worktrees per `superpowers:using-git-worktrees`.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** one `getPortfolioRows()` call = portfolio row + `portfolio_rollup` RPC + `portfolio_boards` read + `listOrgMembers`. **Interaction** (sort / group-by / filter over loaded rows) = **client state + History API, 0 new server round-trips** (T7).
- **Server-data changes** (add/remove board, edit manual fields, edit mapping, create/rename/delete portfolio) = **Server Action + `revalidatePath`** of `/portfolios` and `/portfolios/[id]` (T5).
- **Bounded over indexed columns:** `portfolio_boards` is capped at 200 placements/portfolio; the rollup reads over indexed `portfolio_boards.portfolio_id`, `items(board_id)`, `cell_values(board_id, column_id)`.

---

## Task 1: Migration — schema, RLS, RPCs + regenerated types

**Files:**

- Create: `supabase/migrations/<ts>_portfolios.sql` (use the real UTC timestamp prefix `YYYYMMDDHHMMSS_portfolios.sql`; it must sort **after** the latest existing migration).
- Modify: `src/types/database.types.ts` (regenerated, not hand-edited).

> **Cloud apply is a manual gate.** This migration is applied to the linked Supabase project with `supabase db push --linked` (cloud-native repo, no local stack). Per the north-star convention, apply it **only with explicit per-session authorization from Danijel**. After applying, regenerate types.

- [ ] **Step 1: Write the migration file**

```sql
-- Phase 7a: Portfolios. Org-wide (no workspace_id) exec roll-up of boards.
-- Mirrors boards/dashboards conventions: denormalized org_id, is_org_member
-- RLS, set_updated_at trigger, position float8, SECURITY DEFINER RPCs that
-- derive org_id. Editing is gated by can_edit_portfolio (creator or org
-- owner/admin). portfolio_rollup returns RAW aggregates; progress % and health
-- are derived in TypeScript (src/lib/portfolios/rollup.ts).

create type public.portfolio_priority as enum ('low', 'medium', 'high', 'critical');
create type public.portfolio_health as enum ('on_track', 'at_risk', 'off_track');

-- ── portfolios ────────────────────────────────────────────────────────────
create table public.portfolios (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  description text,
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index portfolios_org_id_idx on public.portfolios (org_id);

create trigger portfolios_set_updated_at
  before update on public.portfolios
  for each row execute function public.set_updated_at();

-- ── portfolio_boards ──────────────────────────────────────────────────────
create table public.portfolio_boards (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  portfolio_id    uuid not null references public.portfolios (id) on delete cascade,
  board_id        uuid not null references public.boards (id) on delete cascade,
  position        double precision not null default 0,
  owner_user_id   uuid references auth.users (id) on delete set null,
  priority        public.portfolio_priority,
  budget          numeric,
  health_override public.portfolio_health,
  status_note     text check (status_note is null or char_length(status_note) <= 280),
  done_column_id  uuid references public.columns (id) on delete set null,
  done_option_ids jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (portfolio_id, board_id)
);
create index portfolio_boards_portfolio_id_idx on public.portfolio_boards (portfolio_id);
create index portfolio_boards_board_id_idx on public.portfolio_boards (board_id);

create trigger portfolio_boards_set_updated_at
  before update on public.portfolio_boards
  for each row execute function public.set_updated_at();

-- ── edit gate: creator OR org owner/admin ───────────────────────────────────
create or replace function public.can_edit_portfolio(p_portfolio_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.portfolios p
    where p.id = p_portfolio_id
      and (
        p.created_by = (select auth.uid())
        or public.has_org_role(p.org_id, array['owner', 'admin']::public.org_role[])
      )
  );
$$;
grant execute on function public.can_edit_portfolio(uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.portfolios enable row level security;
create policy "portfolios: read if member" on public.portfolios
  for select using (public.is_org_member(org_id));
create policy "portfolios: insert if member" on public.portfolios
  for insert with check (public.is_org_member(org_id));
create policy "portfolios: update if editor" on public.portfolios
  for update using (public.can_edit_portfolio(id))
  with check (public.can_edit_portfolio(id));
create policy "portfolios: delete if editor" on public.portfolios
  for delete using (public.can_edit_portfolio(id));

alter table public.portfolio_boards enable row level security;
create policy "portfolio_boards: read if member" on public.portfolio_boards
  for select using (public.is_org_member(org_id));
create policy "portfolio_boards: insert if editor" on public.portfolio_boards
  for insert with check (public.can_edit_portfolio(portfolio_id));
create policy "portfolio_boards: update if editor" on public.portfolio_boards
  for update using (public.can_edit_portfolio(portfolio_id))
  with check (public.can_edit_portfolio(portfolio_id));
create policy "portfolio_boards: delete if editor" on public.portfolio_boards
  for delete using (public.can_edit_portfolio(portfolio_id));

-- ── create_portfolio ─────────────────────────────────────────────────────────
create or replace function public.create_portfolio(p_name text)
returns public.portfolios
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_row    public.portfolios;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Org-wide object: derive the caller's (single) org membership.
  select org_id into v_org_id from public.org_members
  where user_id = v_uid limit 1;
  if v_org_id is null then
    raise exception 'no organization' using errcode = 'P0002';
  end if;

  insert into public.portfolios (org_id, name, created_by)
  values (v_org_id, p_name, v_uid)
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_portfolio(text) to authenticated;

-- ── add_portfolio_board (caps at 200; requires can_read_board) ────────────────
create or replace function public.add_portfolio_board(
  p_portfolio_id   uuid,
  p_board_id       uuid,
  p_done_column_id uuid,
  p_done_option_ids jsonb
) returns public.portfolio_boards
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_count  int;
  v_pos    double precision;
  v_row    public.portfolio_boards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.portfolios where id = p_portfolio_id;
  if v_org_id is null then
    raise exception 'portfolio not found' using errcode = 'P0002';
  end if;
  if not public.can_edit_portfolio(p_portfolio_id) then
    raise exception 'no edit access to this portfolio' using errcode = '42501';
  end if;
  if not public.can_read_board(p_board_id) then
    raise exception 'no read access to this board' using errcode = '42501';
  end if;
  select count(*) into v_count from public.portfolio_boards
  where portfolio_id = p_portfolio_id;
  if v_count >= 200 then
    raise exception 'portfolio is full (200 boards max)' using errcode = '54000';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos
  from public.portfolio_boards where portfolio_id = p_portfolio_id;

  insert into public.portfolio_boards
    (org_id, portfolio_id, board_id, position, done_column_id, done_option_ids)
  values
    (v_org_id, p_portfolio_id, p_board_id, v_pos, p_done_column_id,
     coalesce(p_done_option_ids, '[]'::jsonb))
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.add_portfolio_board(uuid, uuid, uuid, jsonb) to authenticated;

-- ── portfolio_rollup: RAW aggregates per VISIBLE board ────────────────────────
-- Excludes subitems (parent_id is null). "done" = item has a cell on the
-- placement's done_column_id whose optionId ∈ done_option_ids. Timeline uses
-- coalesce(end, date) across date-kind columns; overdue = not-done items whose
-- latest such date < p_today. Health/progress are derived in TS.
create or replace function public.portfolio_rollup(
  p_portfolio_id uuid,
  p_today        date
) returns table (
  board_id       uuid,
  name           text,
  total_items    bigint,
  done_items     bigint,
  timeline_start date,
  timeline_end   date,
  overdue_items  bigint
)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.portfolios where id = p_portfolio_id;
  if v_org_id is null then
    raise exception 'portfolio not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  return query
  with pb as (
    select pb.board_id, pb.done_column_id,
           coalesce(pb.done_option_ids, '[]'::jsonb) as done_option_ids
    from public.portfolio_boards pb
    where pb.portfolio_id = p_portfolio_id
      and public.can_read_board(pb.board_id)
  ),
  it as (
    select pb.board_id, i.id as item_id, pb.done_column_id, pb.done_option_ids,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id
          and cv.column_id = pb.done_column_id
          and pb.done_option_ids ? (cv.value ->> 'optionId')
      ) as is_done,
      (
        select max(coalesce((cv.value ->> 'end'), (cv.value ->> 'date'))::date)
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and (cv.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
      ) as item_end,
      (
        select min((cv.value ->> 'date')::date)
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and (cv.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
      ) as item_start
    from pb
    join public.items i on i.board_id = pb.board_id and i.parent_id is null
  )
  select
    b.id as board_id,
    b.name,
    count(it.item_id) as total_items,
    count(it.item_id) filter (where it.is_done) as done_items,
    min(it.item_start) as timeline_start,
    max(it.item_end) as timeline_end,
    count(it.item_id) filter (
      where not it.is_done and it.item_end is not null and it.item_end < p_today
    ) as overdue_items
  from pb
  join public.boards b on b.id = pb.board_id
  left join it on it.board_id = pb.board_id
  group by b.id, b.name;
end; $$;
grant execute on function public.portfolio_rollup(uuid, date) to authenticated;
```

- [ ] **Step 2: Apply to the linked project (authorized)**

Run (only with Danijel's per-session OK): `supabase db push --linked`
Expected: the new migration applies cleanly; `supabase migration list` shows it on both local and remote.

- [ ] **Step 3: Regenerate types (filter the PostHog telemetry leak)**

Run: `supabase gen types typescript --linked --schema public | grep -v '"_tag"' | prettier --parser typescript > src/types/database.types.ts`
Expected: `portfolios`, `portfolio_boards`, the two enums, and the three new functions appear in `src/types/database.types.ts`.

- [ ] **Step 4: Gate + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (no consumers yet; types compile).

```bash
git add supabase/migrations/ src/types/database.types.ts
git commit -m "feat(portfolios): schema, rls, and rollup rpc for phase 7a"
```

---

## Task 2: Zod validations

**Files:**

- Create: `src/lib/validations/portfolios.ts`
- Test: `src/lib/validations/portfolios.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";

import {
  addBoardSchema,
  createPortfolioSchema,
  doneOptionIdsSchema,
  updateMappingSchema,
  updatePlacementSchema,
} from "./portfolios";

describe("portfolios validations", () => {
  it("accepts a valid create input", () => {
    expect(
      createPortfolioSchema.safeParse({ name: "Q3 Initiatives" }).success,
    ).toBe(true);
  });
  it("rejects an empty name", () => {
    expect(createPortfolioSchema.safeParse({ name: "  " }).success).toBe(false);
  });
  it("accepts a valid add-board input with a mapping", () => {
    const ok = addBoardSchema.safeParse({
      portfolioId: "11111111-1111-1111-1111-111111111111",
      boardId: "22222222-2222-2222-2222-222222222222",
      doneColumnId: "33333333-3333-3333-3333-333333333333",
      doneOptionIds: ["opt-done"],
    });
    expect(ok.success).toBe(true);
  });
  it("allows a null done column (board with no status column)", () => {
    const ok = addBoardSchema.safeParse({
      portfolioId: "11111111-1111-1111-1111-111111111111",
      boardId: "22222222-2222-2222-2222-222222222222",
      doneColumnId: null,
      doneOptionIds: [],
    });
    expect(ok.success).toBe(true);
  });
  it("validates manual placement fields and rejects a bad priority", () => {
    expect(
      updatePlacementSchema.safeParse({
        placementId: "44444444-4444-4444-4444-444444444444",
        priority: "urgent",
      }).success,
    ).toBe(false);
    expect(
      updatePlacementSchema.safeParse({
        placementId: "44444444-4444-4444-4444-444444444444",
        priority: "high",
        budget: 50000,
        healthOverride: "at_risk",
        statusNote: "Vendor slipped a week",
      }).success,
    ).toBe(true);
  });
  it("caps done option ids", () => {
    expect(doneOptionIdsSchema.safeParse(Array(60).fill("x")).success).toBe(
      false,
    );
  });
  it("accepts a valid mapping update", () => {
    expect(
      updateMappingSchema.safeParse({
        placementId: "44444444-4444-4444-4444-444444444444",
        doneColumnId: "33333333-3333-3333-3333-333333333333",
        doneOptionIds: ["a", "b"],
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/validations/portfolios.test.ts`
Expected: FAIL — `Cannot find module './portfolios'`.

- [ ] **Step 3: Implement the schemas**

```typescript
import { z } from "zod";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);

export const prioritySchema = z.enum(["low", "medium", "high", "critical"]);
export const healthSchema = z.enum(["on_track", "at_risk", "off_track"]);
export const doneOptionIdsSchema = z.array(z.string().min(1)).max(50);

export const createPortfolioSchema = z.object({ name });
export const renamePortfolioSchema = z.object({ portfolioId: uuid, name });
export const deletePortfolioSchema = z.object({ portfolioId: uuid });

export const addBoardSchema = z.object({
  portfolioId: uuid,
  boardId: uuid,
  doneColumnId: uuid.nullable(),
  doneOptionIds: doneOptionIdsSchema,
});

export const removePlacementSchema = z.object({ placementId: uuid });

export const updatePlacementSchema = z.object({
  placementId: uuid,
  ownerUserId: uuid.nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  budget: z.number().finite().nonnegative().nullable().optional(),
  healthOverride: healthSchema.nullable().optional(),
  statusNote: z.string().trim().max(280).nullable().optional(),
});

export const updateMappingSchema = z.object({
  placementId: uuid,
  doneColumnId: uuid.nullable(),
  doneOptionIds: doneOptionIdsSchema,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/validations/portfolios.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/portfolios.ts src/lib/validations/portfolios.test.ts
git commit -m "feat(portfolios): zod schemas for portfolio inputs"
```

---

## Task 3: Rollup helpers + types (the testable core)

**Files:**

- Create: `src/lib/portfolios/types.ts`
- Create: `src/lib/portfolios/rollup.ts`
- Test: `src/lib/portfolios/rollup.test.ts`

- [ ] **Step 1: Write the types**

```typescript
// src/lib/portfolios/types.ts
export type PortfolioHealth = "on_track" | "at_risk" | "off_track";
export type PortfolioPriority = "low" | "medium" | "high" | "critical";

/** Raw per-board aggregates returned by the portfolio_rollup RPC. */
export type RollupRow = {
  boardId: string;
  name: string;
  totalItems: number;
  doneItems: number;
  timelineStart: string | null; // ISO date
  timelineEnd: string | null; // ISO date
  overdueItems: number;
};

/** A board's placement in a portfolio (manual fields + completion mapping). */
export type Placement = {
  id: string;
  boardId: string;
  position: number;
  ownerUserId: string | null;
  priority: PortfolioPriority | null;
  budget: number | null;
  healthOverride: PortfolioHealth | null;
  statusNote: string | null;
  doneColumnId: string | null;
  doneOptionIds: string[];
};

export type RowOwner = {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
};

/** A fully-merged grid row: placement + derived metrics + resolved owner. */
export type PortfolioRow = Placement & {
  name: string;
  totalItems: number;
  doneItems: number;
  progressPct: number | null; // null = no mapping or no items
  timelineStart: string | null;
  timelineEnd: string | null;
  overdueItems: number;
  autoHealth: PortfolioHealth | null;
  health: PortfolioHealth | null; // healthOverride ?? autoHealth
  owner: RowOwner | null;
};
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/portfolios/rollup.test.ts
import { describe, expect, it } from "vitest";

import { computeAutoHealth, mergeRows, progressPct } from "./rollup";
import type { Placement, RollupRow, RowOwner } from "./types";

describe("progressPct", () => {
  it("is null when there is no done-column mapping", () => {
    expect(
      progressPct({ totalItems: 10, doneItems: 3, doneColumnId: null }),
    ).toBeNull();
  });
  it("is null when there are no items", () => {
    expect(
      progressPct({ totalItems: 0, doneItems: 0, doneColumnId: "c" }),
    ).toBeNull();
  });
  it("rounds done/total to a percentage", () => {
    expect(
      progressPct({ totalItems: 8, doneItems: 3, doneColumnId: "c" }),
    ).toBe(38);
  });
});

describe("computeAutoHealth", () => {
  const today = "2026-06-21";
  it("is null when there is nothing to judge", () => {
    expect(
      computeAutoHealth({
        progressPct: null,
        timelineStart: null,
        timelineEnd: null,
        overdueItems: 0,
        today,
      }),
    ).toBeNull();
  });
  it("is off_track when past the end date and unfinished", () => {
    expect(
      computeAutoHealth({
        progressPct: 40,
        timelineStart: "2026-01-01",
        timelineEnd: "2026-06-01",
        overdueItems: 0,
        today,
      }),
    ).toBe("off_track");
  });
  it("is at_risk when behind pace", () => {
    // window 2026-06-01..2026-07-01, today=06-21 ⇒ ~66% elapsed; 20% done ⇒ behind
    expect(
      computeAutoHealth({
        progressPct: 20,
        timelineStart: "2026-06-01",
        timelineEnd: "2026-07-01",
        overdueItems: 0,
        today,
      }),
    ).toBe("at_risk");
  });
  it("is at_risk when there are overdue items even if on pace", () => {
    expect(
      computeAutoHealth({
        progressPct: 90,
        timelineStart: "2026-06-01",
        timelineEnd: "2026-07-01",
        overdueItems: 2,
        today,
      }),
    ).toBe("at_risk");
  });
  it("is on_track when ahead of pace and nothing overdue", () => {
    expect(
      computeAutoHealth({
        progressPct: 90,
        timelineStart: "2026-06-01",
        timelineEnd: "2026-07-01",
        overdueItems: 0,
        today,
      }),
    ).toBe("on_track");
  });
});

describe("mergeRows", () => {
  it("joins placements + rollups + owners and applies the health override", () => {
    const placements: Placement[] = [
      {
        id: "p1",
        boardId: "b1",
        position: 1,
        ownerUserId: "u1",
        priority: "high",
        budget: 1000,
        healthOverride: "on_track",
        statusNote: "ok",
        doneColumnId: "c1",
        doneOptionIds: ["done"],
      },
    ];
    const rollups: RollupRow[] = [
      {
        boardId: "b1",
        name: "Launch",
        totalItems: 4,
        doneItems: 1,
        timelineStart: "2026-01-01",
        timelineEnd: "2026-02-01",
        overdueItems: 1,
      },
    ];
    const owners = new Map<string, RowOwner>([
      ["u1", { userId: "u1", fullName: "Ada", avatarUrl: null }],
    ]);

    const [row] = mergeRows(placements, rollups, owners, "2026-06-21");
    expect(row.name).toBe("Launch");
    expect(row.progressPct).toBe(25);
    expect(row.autoHealth).toBe("off_track"); // past end, unfinished
    expect(row.health).toBe("on_track"); // override wins
    expect(row.owner?.fullName).toBe("Ada");
  });
  it("falls back to autoHealth when no override is set", () => {
    const placements: Placement[] = [
      {
        id: "p2",
        boardId: "b2",
        position: 2,
        ownerUserId: null,
        priority: null,
        budget: null,
        healthOverride: null,
        statusNote: null,
        doneColumnId: null,
        doneOptionIds: [],
      },
    ];
    const rollups: RollupRow[] = [
      {
        boardId: "b2",
        name: "Backlog",
        totalItems: 0,
        doneItems: 0,
        timelineStart: null,
        timelineEnd: null,
        overdueItems: 0,
      },
    ];
    const [row] = mergeRows(placements, rollups, new Map(), "2026-06-21");
    expect(row.progressPct).toBeNull();
    expect(row.health).toBeNull();
    expect(row.owner).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- src/lib/portfolios/rollup.test.ts`
Expected: FAIL — `Cannot find module './rollup'`.

- [ ] **Step 4: Implement the helpers**

```typescript
// src/lib/portfolios/rollup.ts
import type {
  Placement,
  PortfolioHealth,
  PortfolioRow,
  RollupRow,
  RowOwner,
} from "./types";

const DAY = 86_400_000;
function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / DAY;
}

/** Server "today" as an ISO date (UTC). NOTE (spec §10): align with per-user
 *  timezone work when it lands; passed explicitly so it stays testable. */
export function serverToday(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function progressPct(row: {
  totalItems: number;
  doneItems: number;
  doneColumnId: string | null;
}): number | null {
  if (row.doneColumnId == null) return null;
  if (row.totalItems === 0) return null;
  return Math.round((row.doneItems / row.totalItems) * 100);
}

export function computeAutoHealth(input: {
  progressPct: number | null;
  timelineStart: string | null;
  timelineEnd: string | null;
  overdueItems: number;
  today: string;
}): PortfolioHealth | null {
  const {
    progressPct: pct,
    timelineStart,
    timelineEnd,
    overdueItems,
    today,
  } = input;

  // Nothing to judge: no progress signal, no timeline, no overdue work.
  if (pct === null && timelineEnd === null && overdueItems === 0) return null;

  // Past the deadline and not finished.
  if (
    timelineEnd !== null &&
    today > timelineEnd &&
    (pct === null || pct < 100)
  ) {
    return "off_track";
  }

  // Behind pace: progress trails the fraction of the window elapsed.
  let behind = false;
  if (pct !== null && timelineStart !== null && timelineEnd !== null) {
    const span = daysBetween(timelineStart, timelineEnd);
    if (span > 0) {
      const elapsed =
        Math.min(Math.max(daysBetween(timelineStart, today) / span, 0), 1) *
        100;
      behind = pct < elapsed;
    }
  }
  if (behind || overdueItems > 0) return "at_risk";
  return "on_track";
}

export function mergeRows(
  placements: Placement[],
  rollups: RollupRow[],
  owners: Map<string, RowOwner>,
  today: string,
): PortfolioRow[] {
  const byBoard = new Map(rollups.map((r) => [r.boardId, r]));
  return placements
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      const r = byBoard.get(p.boardId);
      const totalItems = r?.totalItems ?? 0;
      const doneItems = r?.doneItems ?? 0;
      const timelineStart = r?.timelineStart ?? null;
      const timelineEnd = r?.timelineEnd ?? null;
      const overdueItems = r?.overdueItems ?? 0;
      const pct = progressPct({
        totalItems,
        doneItems,
        doneColumnId: p.doneColumnId,
      });
      const autoHealth = computeAutoHealth({
        progressPct: pct,
        timelineStart,
        timelineEnd,
        overdueItems,
        today,
      });
      return {
        ...p,
        name: r?.name ?? "(no access)",
        totalItems,
        doneItems,
        progressPct: pct,
        timelineStart,
        timelineEnd,
        overdueItems,
        autoHealth,
        health: p.healthOverride ?? autoHealth,
        owner: p.ownerUserId ? (owners.get(p.ownerUserId) ?? null) : null,
      };
    });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- src/lib/portfolios/rollup.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Commit**

```bash
git add src/lib/portfolios/types.ts src/lib/portfolios/rollup.ts src/lib/portfolios/rollup.test.ts
git commit -m "feat(portfolios): rollup helpers (progress, auto-health, merge)"
```

---

## Task 4: Queries (read layer)

**Files:**

- Create: `src/lib/portfolios/queries.ts`

Depends on Task 1 (RPC + types), Task 2 (none directly), Task 3 (types + `mergeRows`/`serverToday`). Mirrors `src/lib/boards/queries.ts` (`getBoardPayload`, `listOrgMembers`) and `src/lib/dashboards/queries.ts` (`getDashboardPayload`).

- [ ] **Step 1: Implement the queries**

```typescript
import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/auth/session";
import { listOrgMembers } from "@/lib/boards/queries";
import { optionSchema, type ColumnOption } from "@/lib/validations/boards";
import { mergeRows, serverToday } from "@/lib/portfolios/rollup";
import type {
  Placement,
  PortfolioRow,
  RollupRow,
  RowOwner,
} from "@/lib/portfolios/types";
import type { Tables } from "@/types/database.types";

export async function listPortfolios(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolios")
    .select("id, name")
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function getPortfolio(
  portfolioId: string,
): Promise<Tables<"portfolios"> | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .maybeSingle();
  return data ?? null;
}

function toPlacement(r: Tables<"portfolio_boards">): Placement {
  return {
    id: r.id,
    boardId: r.board_id,
    position: r.position,
    ownerUserId: r.owner_user_id,
    priority: r.priority,
    budget: r.budget === null ? null : Number(r.budget),
    healthOverride: r.health_override,
    statusNote: r.status_note,
    doneColumnId: r.done_column_id,
    doneOptionIds: Array.isArray(r.done_option_ids)
      ? (r.done_option_ids as string[])
      : [],
  };
}

export type PortfolioRowsResult = {
  portfolio: Tables<"portfolios">;
  rows: PortfolioRow[];
};

/** One-pass read for the grid: portfolio + placements + rollup + owners. */
export async function getPortfolioRows(
  portfolioId: string,
): Promise<PortfolioRowsResult | null> {
  const supabase = await createClient();

  const portfolio = await getPortfolio(portfolioId);
  if (!portfolio) return null;

  const today = serverToday(Date.now());

  const [placementsRes, rollupRes] = await Promise.all([
    supabase
      .from("portfolio_boards")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("position", { ascending: true }),
    supabase.rpc("portfolio_rollup", {
      p_portfolio_id: portfolioId,
      p_today: today,
    }),
  ]);

  const placements = (placementsRes.data ?? []).map(toPlacement);
  const rollups: RollupRow[] = (rollupRes.data ?? []).map((r) => ({
    boardId: r.board_id,
    name: r.name,
    totalItems: Number(r.total_items),
    doneItems: Number(r.done_items),
    timelineStart: r.timeline_start,
    timelineEnd: r.timeline_end,
    overdueItems: Number(r.overdue_items),
  }));

  const members = await listOrgMembers(portfolio.org_id);
  const owners = new Map<string, RowOwner>(
    members.map((m) => [
      m.userId,
      { userId: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl },
    ]),
  );

  return { portfolio, rows: mergeRows(placements, rollups, owners, today) };
}

export type StatusColumn = {
  id: string;
  name: string;
  options: ColumnOption[];
};

/** Status-kind columns of a board, for the completion-mapping picker. */
export async function getBoardStatusColumns(
  boardId: string,
): Promise<StatusColumn[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("columns")
    .select("id, name, kind, settings")
    .eq("board_id", boardId)
    .eq("kind", "status")
    .order("position", { ascending: true });
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    options:
      optionSchema
        .array()
        .safeParse((c.settings as { options?: unknown }).options ?? []).data ??
      [],
  }));
}

/** Boards the current user can add to a portfolio (RLS already filters reads). */
export async function listReadableBoards(): Promise<
  { id: string; name: string; workspaceId: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("boards")
    .select("id, name, workspace_id")
    .order("name", { ascending: true });
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    workspaceId: b.workspace_id,
  }));
}
```

- [ ] **Step 2: Gate + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add src/lib/portfolios/queries.ts
git commit -m "feat(portfolios): read layer (rows, status columns, board list)"
```

---

## Task 5: Server actions (write layer)

**Files:**

- Create: `src/lib/portfolios/actions.ts`

Mirrors `src/lib/dashboards/actions.ts` (the `ActionResult`/`fail` pattern, `.rpc()` + `revalidatePath`).

- [ ] **Step 1: Implement the actions**

```typescript
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  addBoardSchema,
  createPortfolioSchema,
  deletePortfolioSchema,
  removePlacementSchema,
  renamePortfolioSchema,
  updateMappingSchema,
  updatePlacementSchema,
} from "@/lib/validations/portfolios";
import type { Tables } from "@/types/database.types";
import type { Json } from "@/types/database.types";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

export async function createPortfolio(input: {
  name: string;
}): Promise<ActionResult<{ portfolio: Tables<"portfolios"> }>> {
  const parsed = createPortfolioSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_portfolio", {
    p_name: parsed.data.name,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not create portfolio.");

  revalidatePath("/portfolios");
  return { ok: true, data: { portfolio: data as Tables<"portfolios"> } };
}

export async function renamePortfolio(input: {
  portfolioId: string;
  name: string;
}): Promise<ActionResult<null>> {
  const parsed = renamePortfolioSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolios")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.portfolioId);
  if (error) return fail(error.message);

  revalidatePath("/portfolios");
  revalidatePath(`/portfolios/${parsed.data.portfolioId}`);
  return { ok: true, data: null };
}

export async function deletePortfolio(input: {
  portfolioId: string;
}): Promise<ActionResult<null>> {
  const parsed = deletePortfolioSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolios")
    .delete()
    .eq("id", parsed.data.portfolioId);
  if (error) return fail(error.message);

  revalidatePath("/portfolios");
  return { ok: true, data: null };
}

export async function addBoardToPortfolio(input: {
  portfolioId: string;
  boardId: string;
  doneColumnId: string | null;
  doneOptionIds: string[];
}): Promise<ActionResult<{ placement: Tables<"portfolio_boards"> }>> {
  const parsed = addBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_portfolio_board", {
    p_portfolio_id: parsed.data.portfolioId,
    p_board_id: parsed.data.boardId,
    p_done_column_id: parsed.data.doneColumnId,
    p_done_option_ids: parsed.data.doneOptionIds as unknown as Json,
  });
  if (error || !data) return fail(error?.message ?? "Could not add board.");

  revalidatePath(`/portfolios/${parsed.data.portfolioId}`);
  return { ok: true, data: { placement: data as Tables<"portfolio_boards"> } };
}

export async function removePortfolioBoard(input: {
  placementId: string;
  portfolioId: string;
}): Promise<ActionResult<null>> {
  const parsed = removePlacementSchema.safeParse({
    placementId: input.placementId,
  });
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolio_boards")
    .delete()
    .eq("id", parsed.data.placementId);
  if (error) return fail(error.message);

  revalidatePath(`/portfolios/${input.portfolioId}`);
  return { ok: true, data: null };
}

export async function updatePortfolioPlacement(input: {
  placementId: string;
  portfolioId: string;
  ownerUserId?: string | null;
  priority?: "low" | "medium" | "high" | "critical" | null;
  budget?: number | null;
  healthOverride?: "on_track" | "at_risk" | "off_track" | null;
  statusNote?: string | null;
}): Promise<ActionResult<null>> {
  const parsed = updatePlacementSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const patch: Record<string, unknown> = {};
  if ("ownerUserId" in input) patch.owner_user_id = parsed.data.ownerUserId;
  if ("priority" in input) patch.priority = parsed.data.priority;
  if ("budget" in input) patch.budget = parsed.data.budget;
  if ("healthOverride" in input)
    patch.health_override = parsed.data.healthOverride;
  if ("statusNote" in input) patch.status_note = parsed.data.statusNote;

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolio_boards")
    .update(patch)
    .eq("id", parsed.data.placementId);
  if (error) return fail(error.message);

  revalidatePath(`/portfolios/${input.portfolioId}`);
  return { ok: true, data: null };
}

export async function updatePortfolioMapping(input: {
  placementId: string;
  portfolioId: string;
  doneColumnId: string | null;
  doneOptionIds: string[];
}): Promise<ActionResult<null>> {
  const parsed = updateMappingSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolio_boards")
    .update({
      done_column_id: parsed.data.doneColumnId,
      done_option_ids: parsed.data.doneOptionIds as unknown as Json,
    })
    .eq("id", parsed.data.placementId);
  if (error) return fail(error.message);

  revalidatePath(`/portfolios/${input.portfolioId}`);
  return { ok: true, data: null };
}
```

- [ ] **Step 2: Gate + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/lib/portfolios/actions.ts
git commit -m "feat(portfolios): server actions for portfolio + placement mutations"
```

---

## Task 6: Integration test — RPC correctness + RLS

**Files:**

- Create: `src/lib/portfolios/portfolios.rls.integration.test.ts`

Models `src/lib/collaboration/attachments.rls.integration.test.ts` (service-role provisioning + `signInWithRetry`). Skips when `SUPABASE_SERVICE_ROLE_KEY` is absent (CI).

- [ ] **Step 1: Write the integration test**

```typescript
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!SERVICE_ROLE_KEY)("RLS + rollup: portfolios", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // org A: creator + a status board with 4 items (1 done, 1 overdue); org B: outsider.
  let aAnon: SupabaseClient<Database>;
  let bAnon: SupabaseClient<Database>;
  let portfolioId: string;
  let boardId: string;

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // -- provision creator in org A (create_organization RPC seeds org+membership) --
    const emailA = `pf-a-${randomUUID()}@example.com`;
    const { data: ua } = await admin.auth.admin.createUser({
      email: emailA,
      password: PASSWORD,
      email_confirm: true,
    });
    createdUserIds.push(ua.user!.id);
    aAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(aAnon, { email: emailA, password: PASSWORD });
    const { data: org } = await aAnon.rpc("create_organization", {
      p_name: `Org ${randomUUID().slice(0, 8)}`,
      p_slug: `org-${randomUUID().slice(0, 8)}`,
    });
    const orgId = (org as { id: string }).id;

    // -- a board with a status column (one option = done) + a date column --
    const { data: ws } = await aAnon
      .from("workspaces")
      .select("id")
      .eq("org_id", orgId)
      .limit(1)
      .single();
    const { data: board } = await aAnon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: "Launch",
    });
    boardId = (board as { id: string }).id;
    // (Use the board's seeded Status column + options, and a Date column, to set
    //  one item "done" and one item overdue via cell_values inserts — see the
    //  boards integration suite for the exact create_item/cell_value idiom.)

    // -- a portfolio + placement mapping the done option --
    const { data: pf } = await aAnon.rpc("create_portfolio", { p_name: "Q3" });
    portfolioId = (pf as { id: string }).id;

    // -- outsider in a different org --
    const emailB = `pf-b-${randomUUID()}@example.com`;
    const { data: ub } = await admin.auth.admin.createUser({
      email: emailB,
      password: PASSWORD,
      email_confirm: true,
    });
    createdUserIds.push(ub.user!.id);
    bAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(bAnon, { email: emailB, password: PASSWORD });
    await bAnon.rpc("create_organization", {
      p_name: `OrgB ${randomUUID().slice(0, 8)}`,
      p_slug: `orgb-${randomUUID().slice(0, 8)}`,
    });
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("the creator can add a board and read rollup rows", async () => {
    const { error: addErr } = await aAnon.rpc("add_portfolio_board", {
      p_portfolio_id: portfolioId,
      p_board_id: boardId,
      p_done_column_id: null,
      p_done_option_ids: [],
    });
    expect(addErr).toBeNull();

    const { data, error } = await aAnon.rpc("portfolio_rollup", {
      p_portfolio_id: portfolioId,
      p_today: "2026-06-21",
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    expect(Number(data![0].total_items)).toBeGreaterThanOrEqual(0);
  });

  it("a different org cannot read the portfolio or call its rollup (cross-tenant)", async () => {
    const { data: rows } = await bAnon
      .from("portfolios")
      .select("id")
      .eq("id", portfolioId);
    expect(rows ?? []).toHaveLength(0);

    const { error } = await bAnon.rpc("portfolio_rollup", {
      p_portfolio_id: portfolioId,
      p_today: "2026-06-21",
    });
    expect(error).not.toBeNull(); // not a member of this organization
  });

  it("an outsider cannot add a board to the portfolio", async () => {
    const { error } = await bAnon.rpc("add_portfolio_board", {
      p_portfolio_id: portfolioId,
      p_board_id: boardId,
      p_done_column_id: null,
      p_done_option_ids: [],
    });
    expect(error).not.toBeNull();
  });
});
```

> **Note:** the `beforeAll` board-seeding (set one item done, one overdue) is sketched — fill it in using the exact `create_item` + `cell_values` insert idiom from the boards integration suite so the rollup assertions can check concrete `done_items`/`overdue_items` counts. Confirm the `create_organization` RPC signature (`p_name`/`p_slug`) against the auth-tenancy migration when implementing.

- [ ] **Step 2: Run it (requires `.env.local` with service role)**

Run: `pnpm test -- src/lib/portfolios/portfolios.rls.integration.test.ts`
Expected: PASS (3 tests) locally; SKIPPED in CI.

- [ ] **Step 3: Commit**

```bash
git add src/lib/portfolios/portfolios.rls.integration.test.ts
git commit -m "test(portfolios): live rollup rpc + cross-tenant rls coverage"
```

---

## Task 7: UI components

**Files:**

- Create: `src/components/portfolios/HealthPill.tsx`, `ProgressBar.tsx`, `PriorityPill.tsx`
- Create: `src/components/portfolios/PortfolioGrid.tsx`
- Create: `src/components/portfolios/AddBoardDialog.tsx`
- Create: `src/components/portfolios/EditPlacementPopover.tsx`

Depends on Task 3 (types), Task 4 (queries — for status columns in the dialog), Task 5 (actions). Follow the `NewBoardDialog` idiom (`useState` open + `useTransition` + `router.refresh()`) and the `ListWidget` table/pill rendering.

- [ ] **Step 1: Render bits**

```tsx
// src/components/portfolios/HealthPill.tsx
import { cn } from "@/lib/utils";
import type { PortfolioHealth } from "@/lib/portfolios/types";

const LABEL: Record<PortfolioHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};
const TONE: Record<PortfolioHealth, string> = {
  on_track: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  at_risk: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  off_track: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export function HealthPill({
  health,
  isAuto,
}: {
  health: PortfolioHealth | null;
  isAuto: boolean;
}) {
  if (!health) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
        TONE[health],
      )}
    >
      {LABEL[health]}
      {isAuto ? (
        <span className="opacity-60" title="Auto (from pace)">
          ·auto
        </span>
      ) : null}
    </span>
  );
}
```

```tsx
// src/components/portfolios/ProgressBar.tsx
export function ProgressBar({ pct }: { pct: number | null }) {
  if (pct === null)
    return <span className="text-muted-foreground text-xs">n/a</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">{pct}%</span>
    </div>
  );
}
```

```tsx
// src/components/portfolios/PriorityPill.tsx
import type { PortfolioPriority } from "@/lib/portfolios/types";

const LABEL: Record<PortfolioPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function PriorityPill({
  priority,
}: {
  priority: PortfolioPriority | null;
}) {
  if (!priority)
    return <span className="text-muted-foreground text-xs">—</span>;
  return <span className="text-xs font-medium">{LABEL[priority]}</span>;
}
```

- [ ] **Step 2: The grid (client) — render + sort/group/filter via History API**

```tsx
// src/components/portfolios/PortfolioGrid.tsx
"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { HealthPill } from "./HealthPill";
import { ProgressBar } from "./ProgressBar";
import { PriorityPill } from "./PriorityPill";
import { AddBoardDialog } from "./AddBoardDialog";
import { EditPlacementPopover } from "./EditPlacementPopover";
import type { PortfolioRow, RowOwner } from "@/lib/portfolios/types";

type SortKey = "name" | "health" | "progress" | "priority";

const HEALTH_RANK = { off_track: 0, at_risk: 1, on_track: 2 } as const;

/** In-page sort: update the URL via the History API so the client re-renders
 *  WITHOUT re-running the server component (gotcha-09 / AGENTS.md §5). */
function setSort(key: SortKey) {
  const url = new URL(window.location.href);
  url.searchParams.set("sort", key);
  window.history.pushState(null, "", url);
}

export function PortfolioGrid({
  portfolioId,
  rows,
  members,
}: {
  portfolioId: string;
  rows: PortfolioRow[];
  members: RowOwner[];
}) {
  const params = useSearchParams();
  const sort = (params.get("sort") as SortKey) ?? "name";

  const sorted = useMemo(() => {
    const r = rows.slice();
    r.sort((a, b) => {
      switch (sort) {
        case "progress":
          return (b.progressPct ?? -1) - (a.progressPct ?? -1);
        case "health":
          return (
            HEALTH_RANK[a.health ?? "on_track"] -
            HEALTH_RANK[b.health ?? "on_track"]
          );
        case "priority":
          return (a.priority ?? "").localeCompare(b.priority ?? "");
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return r;
  }, [rows, sort]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex gap-1 text-xs">
          {(["name", "health", "progress", "priority"] as SortKey[]).map(
            (k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSort(k)}
                className={`rounded px-2 py-1 ${sort === k ? "bg-accent" : "hover:bg-accent/50"}`}
              >
                Sort: {k}
              </button>
            ),
          )}
        </div>
        <AddBoardDialog portfolioId={portfolioId} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground bg-card sticky top-0 text-left text-xs">
            <tr>
              {[
                "Board",
                "Owner",
                "Health",
                "Progress",
                "Timeline",
                "Priority",
                "Status note",
                "Budget",
              ].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id} className="hover:bg-accent/30 border-t">
                <td className="px-3 py-2">
                  <Link
                    href={`/boards/${row.boardId}`}
                    className="font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{row.owner?.fullName ?? "—"}</td>
                <td className="px-3 py-2">
                  <HealthPill
                    health={row.health}
                    isAuto={row.healthOverride === null}
                  />
                </td>
                <td className="px-3 py-2">
                  <ProgressBar pct={row.progressPct} />
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.timelineStart && row.timelineEnd
                    ? `${row.timelineStart} → ${row.timelineEnd}`
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <PriorityPill priority={row.priority} />
                </td>
                <td className="px-3 py-2 text-xs">{row.statusNote ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <EditPlacementPopover
                    portfolioId={portfolioId}
                    row={row}
                    members={members}
                  />
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="text-muted-foreground px-3 py-8 text-center text-sm"
                >
                  No boards yet. Add one to start tracking this portfolio.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add-board dialog (board picker + completion mapping)**

Copy the `NewBoardDialog` structure (`Dialog`/`DialogContent`/`useTransition`). Behaviour: a board `<select>` populated from a `listReadableBoards()` result passed in as a prop; on board choice, call a small `getBoardStatusColumns` server action wrapper to load status columns; render the column + its options as checkboxes to pick the "done" option(s); pre-select options matching `/done|complete|closed/i`; submit via `addBoardToPortfolio(...)` then `router.refresh()`.

```tsx
// src/components/portfolios/AddBoardDialog.tsx  (key wiring — full Dialog scaffold per NewBoardDialog)
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBoardToPortfolio } from "@/lib/portfolios/actions";
// ... Dialog imports per NewBoardDialog ...

export function AddBoardDialog({ portfolioId }: { portfolioId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [doneColumnId, setDoneColumnId] = useState<string | null>(null);
  const [doneOptionIds, setDoneOptionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!boardId) return;
    setError(null);
    startTransition(async () => {
      const res = await addBoardToPortfolio({
        portfolioId,
        boardId,
        doneColumnId,
        doneOptionIds,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }
  // ... Dialog/DialogContent with: board <select> (from a server-loaded list),
  //     status-column <select> + option checkboxes, error <p role="alert">, and
  //     a submit button disabled when !boardId || isPending. ...
  return null; // replace with the Dialog JSX
}
```

> Implementation note: pass the `listReadableBoards()` result and a `getBoardStatusColumns` server-action wrapper down from the page, OR fetch them inside the dialog via small `"use server"` wrappers. Keep the picker bounded (the board list is org-scoped and small in v1).

- [ ] **Step 4: Edit-placement popover (manual fields)**

A shadcn `Popover` (or `DropdownMenu`) trigged by a `⋯` button on each row. Fields: owner `<select>` (from `members`), priority `<select>`, budget `<input type=number>`, health override `<select>` (incl. "Auto"), status note `<input>`. Each change calls `updatePortfolioPlacement({ placementId: row.id, portfolioId, ...patch })` then `router.refresh()`. A "Remove from portfolio" item calls `removePortfolioBoard`. An "Edit completion mapping" item reuses the mapping UI from the add dialog via `updatePortfolioMapping`.

```tsx
// src/components/portfolios/EditPlacementPopover.tsx (key wiring)
"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updatePortfolioPlacement,
  removePortfolioBoard,
} from "@/lib/portfolios/actions";
import type { PortfolioRow, RowOwner } from "@/lib/portfolios/types";
// ... Popover imports ...

export function EditPlacementPopover({
  portfolioId,
  row,
  members,
}: {
  portfolioId: string;
  row: PortfolioRow;
  members: RowOwner[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  function patch(p: Parameters<typeof updatePortfolioPlacement>[0]) {
    startTransition(async () => {
      await updatePortfolioPlacement({
        ...p,
        placementId: row.id,
        portfolioId,
      });
      router.refresh();
    });
  }
  // ... Popover with owner/priority/budget/health/statusNote controls calling patch(),
  //     plus a Remove action calling removePortfolioBoard({ placementId: row.id, portfolioId }). ...
  return null; // replace with the Popover JSX
}
```

- [ ] **Step 5: Gate + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/components/portfolios/
git commit -m "feat(portfolios): grid, health/progress pills, add-board + edit dialogs"
```

---

## Task 8: Routes + sidebar wiring

**Files:**

- Create: `src/app/portfolios/layout.tsx`, `src/app/portfolios/page.tsx`, `src/app/portfolios/[portfolioId]/page.tsx`
- Create: `src/components/portfolios/NewPortfolioDialog.tsx`
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Layout (mirror `dashboards/layout.tsx`)**

Copy `src/app/dashboards/layout.tsx` verbatim into `src/app/portfolios/layout.tsx`, changing only the component name to `PortfoliosLayout` (it loads the same sidebar data; no portfolios list needed in the shell). Do **not** import the react-grid-layout CSS (that's dashboards-only).

- [ ] **Step 2: List page**

```tsx
// src/app/portfolios/page.tsx
import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { listPortfolios } from "@/lib/portfolios/queries";
import { NewPortfolioDialog } from "@/components/portfolios/NewPortfolioDialog";

export default async function PortfoliosIndex() {
  await requireUser();
  const portfolios = await listPortfolios();

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Portfolios</h1>
        <NewPortfolioDialog />
      </div>
      {portfolios.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No portfolios yet. Create one to roll up boards across your org.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {portfolios.map((p) => (
            <li key={p.id}>
              <Link
                href={`/portfolios/${p.id}`}
                className="hover:bg-accent/40 block px-4 py-3 text-sm font-medium"
              >
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Detail page (the grid)**

```tsx
// src/app/portfolios/[portfolioId]/page.tsx
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { getPortfolioRows } from "@/lib/portfolios/queries";
import { listOrgMembers } from "@/lib/boards/queries";
import { PortfolioGrid } from "@/components/portfolios/PortfolioGrid";

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ portfolioId: string }>;
}) {
  const { portfolioId } = await params;
  await requireUser();

  const result = await getPortfolioRows(portfolioId);
  if (!result) notFound();

  const members = await listOrgMembers(result.portfolio.org_id);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h1 className="text-base font-semibold">{result.portfolio.name}</h1>
      </div>
      <div className="min-h-0 flex-1">
        <PortfolioGrid
          portfolioId={portfolioId}
          rows={result.rows}
          members={members.map((m) => ({
            userId: m.userId,
            fullName: m.fullName,
            avatarUrl: m.avatarUrl,
          }))}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `NewPortfolioDialog`**

Copy the `NewBoardDialog` scaffold; single `name` input; submit calls `createPortfolio({ name })`, then `router.push(`/portfolios/${res.data.portfolio.id}`)`.

- [ ] **Step 5: Wire the sidebar stub**

In `src/components/sidebar.tsx`, give the Portfolios nav item an `href` and render items with an `href` as a `Link` (others stay disabled).

```tsx
// nav array — add href to Portfolios:
const nav = [
  { label: "Goals", icon: Target },
  { label: "Portfolios", icon: BarChart3, href: "/portfolios" },
  { label: "Inbox", icon: Inbox },
] as const;
```

In the expanded render branch, replace the disabled `<button>` for items that have `href` with a `Link`:

```tsx
{
  nav.map((item) =>
    "href" in item && item.href ? (
      <Link
        key={item.label}
        href={item.href}
        className="text-foreground hover:bg-accent flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors"
      >
        <item.icon className="size-4" />
        {item.label}
      </Link>
    ) : (
      <button
        key={item.label}
        type="button"
        disabled
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        <item.icon className="size-4" />
        {item.label}
      </button>
    ),
  );
}
```

Mirror the same `href ? Link : disabled button` change in the **collapsed** (icon + tooltip) branch. Ensure `Link` is imported (`import Link from "next/link"`).

- [ ] **Step 6: Gate + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS; `/portfolios` and `/portfolios/[portfolioId]` appear in the build route list.

```bash
git add src/app/portfolios/ src/components/portfolios/NewPortfolioDialog.tsx src/components/sidebar.tsx
git commit -m "feat(portfolios): /portfolios routes + sidebar nav wiring"
```

---

## Task 9: e2e + final gate

**Files:**

- Create: `e2e/portfolios.spec.ts`

Models `e2e/boards.spec.ts` (service-role confirmed user → UI login → onboarding).

- [ ] **Step 1: Write the e2e spec**

```typescript
import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasSecrets = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
const PASSWORD = "Test-Password-123!";
const unique = (p: string) =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe("Portfolios happy path", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping portfolios e2e",
  );
  let createdUserId: string | null = null;
  let email: string;

  test.beforeAll(async () => {
    email = `${unique("e2e-pf")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(`create user failed: ${error?.message}`);
    createdUserId = data.user.id;
  });

  test.afterAll(async () => {
    if (!createdUserId) return;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(createdUserId);
  });

  test("create portfolio → add board → see row → sort with no refetch", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // login + onboarding + create a board (reuse boards.spec flow)
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    const boardName = unique("Launch");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);

    // go to Portfolios via the sidebar, create one
    await page.getByRole("link", { name: "Portfolios" }).click();
    await page.waitForURL(/\/portfolios$/);
    await page.getByRole("button", { name: /new portfolio/i }).click();
    await page.getByLabel(/portfolio name/i).fill(unique("Q3"));
    await page.getByRole("button", { name: /create portfolio/i }).click();
    await page.waitForURL(/\/portfolios\//);

    // add the board to the portfolio
    await page.getByRole("button", { name: /add board/i }).click();
    await page
      .getByRole("combobox", { name: /board/i })
      .selectOption({ label: boardName });
    await page.getByRole("button", { name: /add/i }).click();
    await expect(page.getByRole("link", { name: boardName })).toBeVisible({
      timeout: 15_000,
    });

    // in-page sort must NOT trigger a full navigation (URL changes via pushState)
    await page.getByRole("button", { name: /sort: health/i }).click();
    await expect(page).toHaveURL(/sort=health/);
    await expect(page.getByRole("link", { name: boardName })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS (unit + integration suites green; build succeeds).

Run (local, with secrets): `pnpm e2e -- portfolios.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit + finish the task**

```bash
git add e2e/portfolios.spec.ts
git commit -m "test(portfolios): e2e happy path (create → add board → sort)"
```

Then merge + clean up per the working agreement:

Run: `scripts/finish-task.sh`
Expected: gate re-runs green → `task/portfolios-7a` merged into `develop`, pushed → worktree removed + branch deleted.

---

## Self-Review (completed)

**Spec coverage:** §1 hybrid model → T1 (raw rollup) + T3 (derive progress/health) + T5 (manual fields). §3 data model → T1 tables. §4 rollup RPC → T1 (`portfolio_rollup`) + T3 (auto-health/progress). §5 UI/routes → T7 + T8. §6 RLS/perms → T1 (`can_edit_portfolio` + policies) + T6 (RLS tests). §7 perf budget → T7 (History-API sort, 0-refetch) + T5 (`revalidatePath`) — covered. §8 DAG → "Execution DAG" section. §9 testing → T3/T2 (unit), T6 (integration), T9 (e2e). §10 open questions → admin predicate resolved to `has_org_role(...,['owner','admin'])` (T1); timezone via explicit `serverToday(now)`/`p_today` seam (T3/T1), flagged for the timezone slice.

**Placeholder scan:** UI Tasks 7 (AddBoardDialog/EditPlacementPopover) and 8 (NewPortfolioDialog, layout copy) intentionally reference the verbatim `NewBoardDialog` scaffold rather than re-pasting it, and give the exact action wiring + signatures — these are "copy this known in-repo component" instructions, not vague TODOs. The integration `beforeAll` seeding is explicitly marked as needing fill-in with the boards-suite idiom.

**Type consistency:** `Placement`/`RollupRow`/`PortfolioRow` (T3) are consumed unchanged by queries (T4), grid (T7), and pages (T8); action input shapes (T5) match the Zod schemas (T2); RPC names (`create_portfolio`, `add_portfolio_board`, `portfolio_rollup`, `can_edit_portfolio`) are identical across T1/T4/T5/T6.
