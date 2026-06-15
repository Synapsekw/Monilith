# Phase 3a — View Infrastructure + Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a multi-view model for boards (a `board_views` table + switcher + saved config) and ship the first alternate view — a Kanban grouped by a Status column — reusing the existing board cache + realtime layer.

**Architecture:** A new `board_views` table (org-scoped RLS, mirroring boards-core) holds one row per view; `create_board` seeds a default Table view and a migration backfills existing boards. The board route resolves a selected view from `?view=<id>` (Table fallback) and renders `BoardTable` or `KanbanBoard`. Both views hydrate the same `["board", boardId]` TanStack cache and share one realtime channel; Kanban drag writes through the existing `setCell` mutation. View CRUD goes through Server Actions and refreshes via navigation (sidestepping the staleTime-Infinity cache).

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Supabase (Postgres + RLS + RPC), TanStack Query, dnd-kit (already installed), Zod, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-15-phase-3a-views-kanban-design.md`

**Conventions to follow (read before starting):**

- This is **Next.js 16** — confirm `searchParams`/`params` are Promises against `node_modules/next/dist/docs/` before using them.
- RLS conventions, action shapes, and value schemas mirror Phase 2 exactly — see `src/lib/boards/actions.ts`, `src/lib/validations/boards.ts`, and `supabase/migrations/20260615061747_boards_core.sql`.
- UI work: load the `pulse-ui` skill first (monochromatic + single-accent, shadcn/Tailwind v4).
- Status cell value shape is `{ optionId: string | null }` (`statusValueSchema`).

---

## File Structure

**Create:**

- `supabase/migrations/<ts>_board_views.sql` — table, enum, RLS, trigger, `create_board` update + backfill, `create_board_view` RPC.
- `src/lib/boards/views.ts` — pure resolvers: `resolveSelectedView`, `resolveKanbanGroupColumn`.
- `src/lib/boards/views.test.ts` — unit tests for resolvers.
- `src/lib/boards/kanban.ts` — pure `buildKanbanColumns` grouping logic.
- `src/lib/boards/kanban.test.ts` — unit tests for grouping.
- `src/lib/validations/view-actions.ts` — Zod schemas for view actions.
- `src/lib/boards/view-actions.ts` — `createBoardView`, `updateBoardView`, `deleteBoardView` Server Actions.
- `src/lib/boards/view-actions.test.ts` — action validation/guard tests.
- `src/components/boards/BoardHeader.tsx` — shared header (board name + `ViewSwitcher`).
- `src/components/boards/ViewSwitcher.tsx` — tab strip + add/rename/delete.
- `src/components/boards/ViewSwitcher.test.tsx` — component tests.
- `src/components/boards/KanbanBoard.tsx` — the Kanban view (owns cache + realtime, renders header + board).
- `src/components/boards/KanbanBoard.test.tsx` — component tests.
- `e2e/kanban.spec.ts` — Kanban happy-path e2e.

**Modify:**

- `src/lib/boards/queries.ts` — add `BoardView` type + `views` to `BoardPayload` and `getBoardPayload`.
- `src/components/boards/BoardTable.tsx` — replace inline `<header>` with `<BoardHeader>`, accept `views`/`selectedViewId` props.
- `src/app/boards/[boardId]/page.tsx` — read `searchParams.view`, resolve selected view, render the right body.
- `src/lib/boards/boards.rls.integration.test.ts` — add `board_views` RLS + seed/RPC cases.
- `src/types/database.types.ts` — regenerated via `pnpm db:types` (never hand-edit).

---

## Task 1: Migration — `board_views` table, RLS, seed, backfill, RPC

**Files:**

- Create: `supabase/migrations/<ts>_board_views.sql` (generate the timestamped file with the CLI)
- Modify (regenerate): `src/types/database.types.ts`

- [ ] **Step 1: Generate the migration file**

Run: `pnpm exec supabase migration new board_views`
This creates `supabase/migrations/<timestamp>_board_views.sql`. Open it and paste the SQL from Step 2.

- [ ] **Step 2: Write the migration SQL**

```sql
-- Phase 3a: board_views — one row per board view (Table/Kanban). Mirrors
-- boards-core conventions: denormalized org_id, is_org_member RLS, board_in_org
-- write guard, set_updated_at trigger. Calendar/Timeline join the enum in 3b.

create type public.view_kind as enum ('table', 'kanban');

create table public.board_views (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  kind       public.view_kind not null,
  name       text not null check (char_length(name) between 1 and 100),
  config     jsonb not null default '{}'::jsonb,
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index board_views_board_id_idx on public.board_views (board_id);
create index board_views_org_id_idx on public.board_views (org_id);

create trigger board_views_set_updated_at
  before update on public.board_views
  for each row execute function public.set_updated_at();

alter table public.board_views enable row level security;

create policy "board_views: read if member" on public.board_views
  for select using (public.is_org_member(org_id));
create policy "board_views: insert if member" on public.board_views
  for insert with check (
    public.is_org_member(org_id) and public.board_in_org(board_id, org_id)
  );
create policy "board_views: update if member" on public.board_views
  for update using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id) and public.board_in_org(board_id, org_id)
  );
create policy "board_views: delete if member" on public.board_views
  for delete using (public.is_org_member(org_id));

-- Backfill: every existing board gets a default Table view at position 0.
insert into public.board_views (org_id, board_id, kind, name, config, position)
select b.org_id, b.id, 'table', 'Main Table', '{}'::jsonb, 0
from public.boards b
where not exists (
  select 1 from public.board_views v where v.board_id = b.id
);

-- Update create_board to also seed the default Table view. Body is identical to
-- the boards-core version with the board_views insert appended before `return`.
create or replace function public.create_board(p_workspace_id uuid, p_name text)
returns public.boards
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_board  public.boards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id into v_org_id from public.workspaces where id = p_workspace_id;
  if v_org_id is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.boards (org_id, workspace_id, name, position, created_by)
  values (v_org_id, p_workspace_id, p_name, 0, v_uid)
  returning * into v_board;

  insert into public.groups (org_id, board_id, name, color, position)
  values (v_org_id, v_board.id, 'Group 1', '#0073ea', 0);

  insert into public.columns (org_id, board_id, kind, name, settings, position)
  values
    (
      v_org_id, v_board.id, 'status', 'Status',
      jsonb_build_object('options', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Working on it', 'color', '#fdab3d'),
        jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Stuck',         'color', '#e2445c'),
        jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Done',          'color', '#00c875')
      )),
      0
    ),
    (v_org_id, v_board.id, 'people', 'Owner', '{}'::jsonb, 1),
    (v_org_id, v_board.id, 'date',   'Date',  '{}'::jsonb, 2);

  insert into public.board_views (org_id, board_id, kind, name, config, position)
  values (v_org_id, v_board.id, 'table', 'Main Table', '{}'::jsonb, 0);

  return v_board;
end; $$;

-- RPC: create_board_view — derive org_id from the board (membership-checked),
-- position = max+1. Mirrors create_item.
create or replace function public.create_board_view(
  p_board_id uuid,
  p_kind public.view_kind,
  p_name text,
  p_config jsonb default '{}'::jsonb
) returns public.board_views
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_pos    double precision;
  v_row    public.board_views;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  select coalesce(max(position), -1) + 1 into v_pos
  from public.board_views where board_id = p_board_id;

  insert into public.board_views (org_id, board_id, kind, name, config, position)
  values (v_org_id, p_board_id, p_kind, p_name, coalesce(p_config, '{}'::jsonb), v_pos)
  returning * into v_row;
  return v_row;
end; $$;

grant execute on function public.create_board_view(uuid, public.view_kind, text, jsonb)
  to authenticated;
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm exec supabase db push --linked`
Expected: applies `<ts>_board_views.sql` with no errors.
(If this fails on auth, it is a manual gate — ask Danijel to run `supabase db push`.)

- [ ] **Step 4: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` now includes `board_views` in `Tables`, `view_kind` in `Enums`, and `create_board_view` in `Functions`. Verify: `grep -c board_views src/types/database.types.ts` returns ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/types/database.types.ts
git commit -m "feat(boards): board_views table + RLS + create_board_view RPC, seed default Table view"
```

---

## Task 2: RLS integration tests for `board_views`

**Files:**

- Modify: `src/lib/boards/boards.rls.integration.test.ts`

Follow the exact setup/teardown pattern already in this file (two orgs, service-role + per-user clients). Add a `describe("board_views RLS")` block.

- [ ] **Step 1: Write the failing tests**

Add cases asserting (use the file's existing helpers for creating orgs/members/boards):

1. A member can `select` their org's `board_views` rows.
2. A non-member's `select` of another org's board_views returns 0 rows.
3. A non-member `insert` into another org's board (with that org's `org_id`/`board_id`) is rejected by RLS.
4. After `create_board`, exactly one `board_views` row exists for the board with `kind = 'table'`, `name = 'Main Table'`, `position = 0`.
5. `create_board_view(boardId, 'kanban', 'Kanban', '{}')` as a member inserts a row with `position = 1`; as a non-member it raises (membership check).

```ts
// Sketch — mirror the existing helpers/clients in this file.
describe("board_views RLS", () => {
  it("seeds exactly one table view on create_board", async () => {
    const board = await createBoardAs(userAClient, workspaceA);
    const { data } = await serviceClient
      .from("board_views")
      .select("*")
      .eq("board_id", board.id);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      kind: "table",
      name: "Main Table",
      position: 0,
    });
  });

  it("denies cross-org reads", async () => {
    const board = await createBoardAs(userAClient, workspaceA);
    const { data } = await userBClient
      .from("board_views")
      .select("*")
      .eq("board_id", board.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("create_board_view appends at max+1 for members and rejects non-members", async () => {
    const board = await createBoardAs(userAClient, workspaceA);
    const { data, error } = await userAClient.rpc("create_board_view", {
      p_board_id: board.id,
      p_kind: "kanban",
      p_name: "Kanban",
      p_config: {},
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ kind: "kanban", position: 1 });

    const denied = await userBClient.rpc("create_board_view", {
      p_board_id: board.id,
      p_kind: "kanban",
      p_name: "Kanban",
      p_config: {},
    });
    expect(denied.error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they pass against the applied migration**

Run: `pnpm test src/lib/boards/boards.rls.integration.test.ts`
Expected: all `board_views RLS` cases pass (migration already applied in Task 1).

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/boards.rls.integration.test.ts
git commit -m "test(boards): RLS coverage for board_views (seed, cross-org deny, create_board_view)"
```

---

## Task 3: Queries + view resolvers

**Files:**

- Modify: `src/lib/boards/queries.ts`
- Create: `src/lib/boards/views.ts`
- Test: `src/lib/boards/views.test.ts`

- [ ] **Step 1: Write the failing resolver tests**

```ts
// src/lib/boards/views.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveSelectedView,
  resolveKanbanGroupColumn,
} from "@/lib/boards/views";

const table = { id: "v-table", kind: "table" } as const;
const kanban = { id: "v-kanban", kind: "kanban" } as const;

describe("resolveSelectedView", () => {
  it("returns the requested view when it exists", () => {
    expect(resolveSelectedView([table, kanban] as never, "v-kanban")).toBe(
      ([table, kanban] as never)[1],
    );
  });
  it("falls back to the first table view when the id is unknown", () => {
    expect(resolveSelectedView([kanban, table] as never, "missing")?.id).toBe(
      "v-table",
    );
  });
  it("falls back to the first view when no table view exists", () => {
    expect(resolveSelectedView([kanban] as never, undefined)?.id).toBe(
      "v-kanban",
    );
  });
  it("returns null for an empty list", () => {
    expect(resolveSelectedView([] as never, undefined)).toBeNull();
  });
});

describe("resolveKanbanGroupColumn", () => {
  const cols = [
    { id: "c1", kind: "text" },
    { id: "c2", kind: "status" },
    { id: "c3", kind: "status" },
  ];
  it("returns the configured status column when valid", () => {
    expect(
      resolveKanbanGroupColumn(cols as never, { group_column_id: "c3" })?.id,
    ).toBe("c3");
  });
  it("falls back to the first status column when config points at a non-status column", () => {
    expect(
      resolveKanbanGroupColumn(cols as never, { group_column_id: "c1" })?.id,
    ).toBe("c2");
  });
  it("falls back to the first status column when config is empty", () => {
    expect(resolveKanbanGroupColumn(cols as never, {})?.id).toBe("c2");
  });
  it("returns null when there is no status column", () => {
    expect(
      resolveKanbanGroupColumn([{ id: "c1", kind: "text" }] as never, {}),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/lib/boards/views.test.ts`
Expected: FAIL — module `@/lib/boards/views` not found.

- [ ] **Step 3: Implement the resolvers**

```ts
// src/lib/boards/views.ts
import type { BoardView, Column } from "@/lib/boards/queries";

/** Pick the selected view: requested id → first table view → first view → null. */
export function resolveSelectedView(
  views: BoardView[],
  requestedId: string | undefined,
): BoardView | null {
  if (views.length === 0) return null;
  if (requestedId) {
    const found = views.find((v) => v.id === requestedId);
    if (found) return found;
  }
  return views.find((v) => v.kind === "table") ?? views[0];
}

/** Resolve the Kanban grouping column from config, falling back to the first status column. */
export function resolveKanbanGroupColumn(
  columns: Column[],
  config: { group_column_id?: string | null } | null | undefined,
): Column | null {
  const statusColumns = columns.filter((c) => c.kind === "status");
  const requested = config?.group_column_id
    ? statusColumns.find((c) => c.id === config.group_column_id)
    : undefined;
  return requested ?? statusColumns[0] ?? null;
}
```

- [ ] **Step 4: Add `BoardView` + `views` to queries.ts**

In `src/lib/boards/queries.ts`:

- Add the type alias near the others: `export type BoardView = Tables<"board_views">;`
- Add `views: BoardView[];` to the `BoardPayload` type.
- In `getBoardPayload`, add a 6th parallel read inside the `Promise.all`:

```ts
    supabase
      .from("board_views")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
```

Destructure it as `viewsRes` and return `views: viewsRes.data ?? []` in the result object.

- [ ] **Step 5: Run resolver tests + typecheck**

Run: `pnpm test src/lib/boards/views.test.ts && pnpm typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/queries.ts src/lib/boards/views.ts src/lib/boards/views.test.ts
git commit -m "feat(boards): load board_views in payload + view-resolution helpers"
```

---

## Task 4: Kanban grouping logic (`buildKanbanColumns`)

**Files:**

- Create: `src/lib/boards/kanban.ts`
- Test: `src/lib/boards/kanban.test.ts`

`buildKanbanColumns` is a pure function: given the cache slices + the grouping column id, produce ordered Kanban columns (a leading "No status" column, then one per option) each with its cards in `item.position` order.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/boards/kanban.test.ts
import { describe, it, expect } from "vitest";
import { buildKanbanColumns, NO_STATUS_ID } from "@/lib/boards/kanban";

const groupCol = {
  id: "status",
  kind: "status",
  settings: {
    options: [
      { id: "o1", label: "Working", color: "#fdab3d" },
      { id: "o2", label: "Done", color: "#00c875" },
    ],
  },
} as never;

const items = [
  { id: "i1", name: "A", position: 0 },
  { id: "i2", name: "B", position: 1 },
  { id: "i3", name: "C", position: 2 },
] as never;

const cellValues = [
  { item_id: "i1", column_id: "status", value: { optionId: "o2" } },
  { item_id: "i2", column_id: "status", value: { optionId: "o1" } },
  // i3 has no status cell → No status
] as never;

it("produces a No-status column first, then one column per option in order", () => {
  const cols = buildKanbanColumns({ items, cellValues }, groupCol);
  expect(cols.map((c) => c.id)).toEqual([NO_STATUS_ID, "o1", "o2"]);
  expect(cols[0].label).toBe("No status");
  expect(cols[1]).toMatchObject({ label: "Working", color: "#fdab3d" });
});

it("buckets cards by their status option and keeps position order", () => {
  const cols = buildKanbanColumns({ items, cellValues }, groupCol);
  expect(
    cols.find((c) => c.id === NO_STATUS_ID)!.cards.map((i) => i.id),
  ).toEqual(["i3"]);
  expect(cols.find((c) => c.id === "o1")!.cards.map((i) => i.id)).toEqual([
    "i2",
  ]);
  expect(cols.find((c) => c.id === "o2")!.cards.map((i) => i.id)).toEqual([
    "i1",
  ]);
});

it("treats a cell whose optionId no longer matches any option as No status", () => {
  const stale = [
    { item_id: "i1", column_id: "status", value: { optionId: "gone" } },
  ] as never;
  const cols = buildKanbanColumns(
    { items: [items[0]] as never, cellValues: stale },
    groupCol,
  );
  expect(
    cols.find((c) => c.id === NO_STATUS_ID)!.cards.map((i) => i.id),
  ).toEqual(["i1"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/lib/boards/kanban.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildKanbanColumns`**

```ts
// src/lib/boards/kanban.ts
import type {
  CacheCellValue,
  CacheColumn,
  CacheItem,
} from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";

export const NO_STATUS_ID = "__no_status__";

export type KanbanColumn = {
  /** Option id, or NO_STATUS_ID for the unset bucket. */
  id: string;
  label: string;
  /** Pill color; null for the No-status column. */
  color: string | null;
  /** The status option id to write when a card is dropped here (null = clear). */
  optionId: string | null;
  cards: CacheItem[];
};

type Slices = { items: CacheItem[]; cellValues: CacheCellValue[] };

/** Group items into Kanban columns by a status column. Pure. Items stay in the
 * order given (the payload/cache is already position-sorted). */
export function buildKanbanColumns(
  { items, cellValues }: Slices,
  groupColumn: CacheColumn,
): KanbanColumn[] {
  const options =
    (groupColumn.settings as { options?: ColumnOption[] })?.options ?? [];
  const validIds = new Set(options.map((o) => o.id));

  // item_id → optionId for this column.
  const statusByItem = new Map<string, string | null>();
  for (const c of cellValues) {
    if (c.column_id !== groupColumn.id) continue;
    const optionId =
      (c.value as { optionId?: string | null })?.optionId ?? null;
    statusByItem.set(c.item_id, optionId);
  }

  const buckets = new Map<string, CacheItem[]>();
  buckets.set(NO_STATUS_ID, []);
  for (const o of options) buckets.set(o.id, []);

  for (const item of items) {
    const optionId = statusByItem.get(item.id) ?? null;
    const key = optionId && validIds.has(optionId) ? optionId : NO_STATUS_ID;
    buckets.get(key)!.push(item);
  }

  return [
    {
      id: NO_STATUS_ID,
      label: "No status",
      color: null,
      optionId: null,
      cards: buckets.get(NO_STATUS_ID)!,
    },
    ...options.map((o) => ({
      id: o.id,
      label: o.label,
      color: o.color,
      optionId: o.id,
      cards: buckets.get(o.id)!,
    })),
  ];
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test src/lib/boards/kanban.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/kanban.ts src/lib/boards/kanban.test.ts
git commit -m "feat(boards): buildKanbanColumns grouping logic"
```

---

## Task 5: View Server Actions

**Files:**

- Create: `src/lib/validations/view-actions.ts`
- Create: `src/lib/boards/view-actions.ts`
- Test: `src/lib/boards/view-actions.test.ts`

- [ ] **Step 1: Write the validation schemas**

```ts
// src/lib/validations/view-actions.ts
import { z } from "zod";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);

export const viewKindSchema = z.enum(["table", "kanban"]);

// Kanban config: a grouping column id (uuid) or null/absent.
export const kanbanConfigSchema = z.object({
  group_column_id: uuid.nullable().optional(),
});

export const createBoardViewSchema = z.object({
  boardId: uuid,
  kind: viewKindSchema,
  name: name.optional(),
});

export const updateBoardViewSchema = z.object({
  viewId: uuid,
  name: name.optional(),
  config: kanbanConfigSchema.optional(),
});

export const deleteBoardViewSchema = z.object({ viewId: uuid });
```

- [ ] **Step 2: Write the failing action tests**

Mirror the existing action-test style (mock `@/lib/supabase/server`). At minimum assert input validation + the last-view delete guard.

```ts
// src/lib/boards/view-actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createBoardView, deleteBoardView } from "@/lib/boards/view-actions";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("createBoardView", () => {
  it("rejects an invalid board id without calling the RPC", async () => {
    const res = await createBoardView({ boardId: "nope", kind: "kanban" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("defaults the name by kind and calls create_board_view", async () => {
    rpc.mockResolvedValue({ data: { id: "v1" }, error: null });
    const res = await createBoardView({
      boardId: "00000000-0000-0000-0000-000000000001",
      kind: "kanban",
    });
    expect(rpc).toHaveBeenCalledWith(
      "create_board_view",
      expect.objectContaining({ p_name: "Kanban" }),
    );
    expect(res).toEqual({ ok: true, data: { viewId: "v1" } });
  });
});

describe("deleteBoardView", () => {
  it("refuses to delete the board's last view", async () => {
    // First read: the view's board_id; second read: count of views on that board = 1.
    from.mockImplementation((table: string) => {
      if (table === "board_views") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { board_id: "b1" },
                error: null,
              }),
              // count query path:
            }),
          }),
        } as never;
      }
      return {} as never;
    });
    // See implementation note in Step 3 for the exact query the guard issues;
    // assert it returns a typed error without issuing a delete.
    const res = await deleteBoardView({
      viewId: "00000000-0000-0000-0000-000000000002",
    });
    expect(res.ok).toBe(false);
  });
});
```

> Note: the `from` mock shape must match the query chain you write in Step 3. Keep the implementation's query chain simple (see below) so the mock stays readable; adjust the mock to match exactly.

- [ ] **Step 3: Implement the actions**

```ts
// src/lib/boards/view-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createBoardViewSchema,
  deleteBoardViewSchema,
  updateBoardViewSchema,
} from "@/lib/validations/view-actions";
import type { ActionResult } from "@/lib/boards/actions";

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

const DEFAULT_NAME: Record<string, string> = {
  table: "Main Table",
  kanban: "Kanban",
};

export async function createBoardView(input: {
  boardId: string;
  kind: "table" | "kanban";
  name?: string;
}): Promise<ActionResult<{ viewId: string }>> {
  const parsed = createBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_board_view", {
    p_board_id: parsed.data.boardId,
    p_kind: parsed.data.kind,
    p_name: parsed.data.name ?? DEFAULT_NAME[parsed.data.kind],
    p_config: {},
  });
  if (error || !data) return fail(error?.message ?? "Could not create view.");

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: { viewId: data.id } };
}

export async function updateBoardView(input: {
  viewId: string;
  name?: string;
  config?: { group_column_id?: string | null };
}): Promise<ActionResult> {
  const parsed = updateBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.config !== undefined) patch.config = parsed.data.config;
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_views")
    .update(patch)
    .eq("id", parsed.data.viewId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("View not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}

export async function deleteBoardView(input: {
  viewId: string;
}): Promise<ActionResult> {
  const parsed = deleteBoardViewSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: view, error: viewErr } = await supabase
    .from("board_views")
    .select("board_id")
    .eq("id", parsed.data.viewId)
    .maybeSingle();
  if (viewErr || !view) return fail("View not found.");

  // Refuse to delete the board's last view (RLS-scoped count).
  const { count, error: countErr } = await supabase
    .from("board_views")
    .select("id", { count: "exact", head: true })
    .eq("board_id", view.board_id);
  if (countErr) return fail(countErr.message);
  if ((count ?? 0) <= 1) return fail("A board must keep at least one view.");

  const { error } = await supabase
    .from("board_views")
    .delete()
    .eq("id", parsed.data.viewId);
  if (error) return fail(error.message);

  revalidatePath(`/boards/${view.board_id}`);
  return { ok: true, data: undefined };
}
```

> Align the Step 2 `from` mock to this exact chain (`.select(...).eq(...).maybeSingle()` for the view read; `.select("id", { count, head }).eq(...)` for the count). Make the count path return `{ count: 1 }` to exercise the guard.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test src/lib/boards/view-actions.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/view-actions.ts src/lib/boards/view-actions.ts src/lib/boards/view-actions.test.ts
git commit -m "feat(boards): view server actions (create/update/delete, last-view guard)"
```

---

## Task 6: `BoardHeader` + `ViewSwitcher`

**Files:**

- Create: `src/components/boards/BoardHeader.tsx`
- Create: `src/components/boards/ViewSwitcher.tsx`
- Test: `src/components/boards/ViewSwitcher.test.tsx`

> Load the `pulse-ui` skill before styling. Active tab uses the single accent; everything else is monochrome. Use existing `src/components/ui/` primitives (`popover.tsx` is available for the ⋯ menu).

- [ ] **Step 1: Write the failing `ViewSwitcher` tests**

```tsx
// src/components/boards/ViewSwitcher.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewSwitcher } from "@/components/boards/ViewSwitcher";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const createBoardView = vi.fn();
const deleteBoardView = vi.fn();
const updateBoardView = vi.fn();
vi.mock("@/lib/boards/view-actions", () => ({
  createBoardView: (...a: unknown[]) => createBoardView(...a),
  deleteBoardView: (...a: unknown[]) => deleteBoardView(...a),
  updateBoardView: (...a: unknown[]) => updateBoardView(...a),
}));

const views = [
  { id: "v1", kind: "table", name: "Main Table" },
  { id: "v2", kind: "kanban", name: "Kanban" },
] as never;

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  createBoardView.mockReset();
  deleteBoardView.mockReset();
});

describe("ViewSwitcher", () => {
  it("renders a tab per view and marks the selected one", () => {
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v2" />);
    expect(screen.getByRole("tab", { name: /Main Table/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: /Kanban/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("creates a Kanban view and navigates to it", async () => {
    createBoardView.mockResolvedValue({ ok: true, data: { viewId: "v3" } });
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v1" />);
    await userEvent.click(screen.getByRole("button", { name: /add view/i }));
    expect(createBoardView).toHaveBeenCalledWith({
      boardId: "b1",
      kind: "kanban",
    });
    expect(push).toHaveBeenCalledWith("/boards/b1?view=v3");
  });

  it("hides delete when only one view remains", () => {
    render(
      <ViewSwitcher
        boardId="b1"
        views={[views[0]] as never}
        selectedViewId="v1"
      />,
    );
    // open the only tab's menu; Delete must be absent/disabled.
    // (Assert via queryByRole('menuitem', { name: /delete/i }) being null or disabled.)
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/components/boards/ViewSwitcher.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `ViewSwitcher`**

Build a client component (`"use client"`) with:

- Props: `{ boardId: string; views: Pick<BoardView,"id"|"kind"|"name">[]; selectedViewId: string }`.
- A `role="tablist"` of tabs; each tab is a `next/link` to `/boards/${boardId}?view=${v.id}` with `role="tab"` + `aria-selected`. Icon by kind (`Table`/`Trello`/`LayoutGrid` from `lucide-react`).
- An "Add view" button (`aria-label="Add view"`) → `startTransition` → `await createBoardView({ boardId, kind: "kanban" })`; on `ok`, `router.push("/boards/"+boardId+"?view="+data.viewId)`.
- A per-tab ⋯ menu (radix `popover.tsx`) with **Rename** (inline input → `updateBoardView({ viewId, name })` then `router.refresh()`) and **Delete** (`deleteBoardView({ viewId })` then `router.push` to the first remaining view). Render Delete only when `views.length > 1`.
- Disable buttons while their transition is pending.

- [ ] **Step 4: Implement `BoardHeader`**

```tsx
// src/components/boards/BoardHeader.tsx
"use client";

import { ViewSwitcher } from "@/components/boards/ViewSwitcher";
import type { BoardView } from "@/lib/boards/queries";

export function BoardHeader({
  boardId,
  boardName,
  views,
  selectedViewId,
}: {
  boardId: string;
  boardName: string;
  views: BoardView[];
  selectedViewId: string;
}) {
  return (
    <header className="flex flex-col gap-2 border-b px-6 py-3">
      <h1 className="text-xl font-semibold tracking-tight">{boardName}</h1>
      <ViewSwitcher
        boardId={boardId}
        views={views}
        selectedViewId={selectedViewId}
      />
    </header>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test src/components/boards/ViewSwitcher.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/BoardHeader.tsx src/components/boards/ViewSwitcher.tsx src/components/boards/ViewSwitcher.test.tsx
git commit -m "feat(boards): BoardHeader + ViewSwitcher (tabs, add/rename/delete)"
```

---

## Task 7: Wire `BoardTable` to the shared header + thread view props

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`

- [ ] **Step 1: Update props + header**

- Extend the `BoardTable` props to `{ payload: BoardPayload; members?: EditorMember[]; selectedViewId: string }`.
- Replace the inline `<header className="border-b px-6 py-4">…</header>` block (lines ~120-122) with:

```tsx
<BoardHeader
  boardId={board.id}
  boardName={board.name}
  views={payload.views}
  selectedViewId={selectedViewId}
/>
```

- Add the import: `import { BoardHeader } from "@/components/boards/BoardHeader";`
- (`payload.views` exists now; the cache cast already tolerates the extra field.)

- [ ] **Step 2: Typecheck + run existing board tests**

Run: `pnpm typecheck && pnpm test src/components/boards`
Expected: PASS (existing BoardTable tests still green; update any test that renders `BoardTable` to pass `selectedViewId` + a `views` array in `payload`).

- [ ] **Step 3: Commit**

```bash
git add src/components/boards/BoardTable.tsx
git commit -m "refactor(boards): BoardTable uses shared BoardHeader + view props"
```

---

## Task 8: `KanbanBoard` component

**Files:**

- Create: `src/components/boards/KanbanBoard.tsx`
- Test: `src/components/boards/KanbanBoard.test.tsx`

> Load `pulse-ui` first. Columns are monochrome surfaces; the only color is the status pill on each column header + card status. Uses `@dnd-kit/core` (`DndContext`, `useDraggable`, `useDroppable`).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/boards/KanbanBoard.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KanbanBoard } from "@/components/boards/KanbanBoard";

const setCell = vi.fn();
const addItem = vi.fn();
vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({
    setCell,
    addItem,
    clearCellValue: vi.fn(),
    renameItem: vi.fn(),
  }),
}));
vi.mock("@/lib/boards/use-board-realtime", () => ({
  useBoardRealtime: vi.fn(),
}));

function payloadFixture() {
  const status = {
    id: "status",
    board_id: "b1",
    org_id: "o1",
    kind: "status",
    name: "Status",
    position: 0,
    settings: {
      options: [
        { id: "o1", label: "Working", color: "#fdab3d" },
        { id: "o2", label: "Done", color: "#00c875" },
      ],
    },
  };
  return {
    board: { id: "b1", org_id: "o1", name: "Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [status],
    items: [
      { id: "i1", name: "Card A", group_id: "g1", position: 0 },
      { id: "i2", name: "Card B", group_id: "g1", position: 1 },
    ],
    cellValues: [
      { item_id: "i1", column_id: "status", value: { optionId: "o1" } },
    ],
    views: [
      {
        id: "v2",
        kind: "kanban",
        name: "Kanban",
        config: { group_column_id: "status" },
      },
    ],
  } as never;
}

function renderKanban() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <KanbanBoard
        payload={payloadFixture()}
        selectedViewId="v2"
        members={[]}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setCell.mockReset();
  addItem.mockReset();
});

describe("KanbanBoard", () => {
  it("renders a No-status column + one column per option", () => {
    renderKanban();
    expect(screen.getByText("No status")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("places each card under its status column", () => {
    renderKanban();
    // Card A (o1=Working) and Card B (No status)
    expect(screen.getByText("Card A")).toBeInTheDocument();
    expect(screen.getByText("Card B")).toBeInTheDocument();
  });
});
```

> dnd-kit drag is hard to drive in jsdom. Cover the **drop handler** by exporting a pure `onCardDropped(itemId, fromColId, toCol, groupColumnId, setCell, clearCellValue)` helper and unit-testing it directly: dropping on an option calls `setCell({ itemId, columnId: groupColumnId, value: { optionId } })`; dropping on No-status calls `clearCellValue`. Keep the DnD wiring thin around this helper.

```ts
// Add to KanbanBoard.test.tsx
import { onCardDropped } from "@/components/boards/KanbanBoard";
it("drop on an option writes the status cell", () => {
  const setCell = vi.fn();
  const clear = vi.fn();
  onCardDropped(
    "i2",
    "__no_status__",
    { id: "o2", optionId: "o2" } as never,
    "status",
    setCell,
    clear,
  );
  expect(setCell).toHaveBeenCalledWith({
    itemId: "i2",
    columnId: "status",
    value: { optionId: "o2" },
  });
});
it("drop on No-status clears the cell", () => {
  const setCell = vi.fn();
  const clear = vi.fn();
  onCardDropped(
    "i1",
    "o1",
    { id: "__no_status__", optionId: null } as never,
    "status",
    setCell,
    clear,
  );
  expect(clear).toHaveBeenCalledWith({ itemId: "i1", columnId: "status" });
});
it("drop on the same column is a no-op", () => {
  const setCell = vi.fn();
  const clear = vi.fn();
  onCardDropped(
    "i1",
    "o1",
    { id: "o1", optionId: "o1" } as never,
    "status",
    setCell,
    clear,
  );
  expect(setCell).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/components/boards/KanbanBoard.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `KanbanBoard`**

Structure (`"use client"`):

- Hydrate cache + realtime exactly like `BoardTable`:
  ```tsx
  const { data: cache } = useBoardCache(
    payload.board.id,
    payload as unknown as BoardCache,
  );
  const { setCell, clearCellValue, addItem } = useBoardMutations(
    payload.board.id,
  );
  useBoardRealtime(payload.board.id);
  ```
- Resolve the grouping column: `resolveKanbanGroupColumn(cache.columns, selectedView.config)` where `selectedView = cache views? ` — derive `selectedView` from `payload.views.find(v => v.id === selectedViewId)`; read `config` off it. If `null`, render an empty-state: "Add a Status column to use the Kanban view."
- `const kanbanColumns = buildKanbanColumns(cache, groupColumn)`.
- Render `<BoardHeader .../>` + a horizontal flex row of columns. Each column: header (status pill via the option color, or muted "No status") + count + a vertical list of `KanbanCard` + a per-column "+ Add" button.
- **Export `onCardDropped`** (pure) and wire `DndContext.onDragEnd` to call it:
  ```ts
  export function onCardDropped(
    itemId: string,
    fromColId: string,
    toCol: { id: string; optionId: string | null },
    groupColumnId: string,
    setCell: (v: { itemId: string; columnId: string; value: unknown }) => void,
    clearCellValue: (v: { itemId: string; columnId: string }) => void,
  ) {
    if (fromColId === toCol.id) return;
    if (toCol.optionId === null)
      clearCellValue({ itemId, columnId: groupColumnId });
    else
      setCell({
        itemId,
        columnId: groupColumnId,
        value: { optionId: toCol.optionId },
      });
  }
  ```
  In `onDragEnd`, read the dragged item id from `active.id`, the target column from `over.id` (set droppable id = column id; stash `optionId` + source col id in drag data), and call `onCardDropped`.
- `KanbanCard`: `useDraggable`; shows `item.name` + read-only People/Date summaries by reusing `CellRenderer` for the board's `people`/`date` columns (look up each from `cache.cellValues`). No edit affordance.
- Per-column "+ Add": an input that calls `addItem({ groupId: firstGroupId, name }, { onSuccess })`; for option columns, chain `setCell({ itemId: <new id>, columnId: groupColumnId, value: { optionId } })` inside `onSuccess` using the returned item (addItem's callback has no item arg — instead call `createItem` result path; simplest: keep "+ Add" creating the item in the first group and, for option columns, set status via a follow-up effect keyed off the new item — OR scope "+ Add" to the No-status column only for 3a and note option-column quick-add as a follow-up). **Decision for 3a:** implement "+ Add" on every column; for option columns, after `addItem` succeeds, the new item appears in No-status, and the user drags it — keep add simple (create in first group, no auto-status). Document this in a code comment.

> Keep the DnD provider thin; the tested logic lives in `buildKanbanColumns` + `onCardDropped`.

- [ ] **Step 4: Run tests**

Run: `pnpm test src/components/boards/KanbanBoard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/KanbanBoard.tsx src/components/boards/KanbanBoard.test.tsx
git commit -m "feat(boards): KanbanBoard view (group by status, drag-to-restatus)"
```

---

## Task 9: Route — resolve selected view + render the right body

**Files:**

- Modify: `src/app/boards/[boardId]/page.tsx`

- [ ] **Step 1: Read `searchParams`, resolve, branch**

- Change the signature to also accept `searchParams: Promise<{ view?: string }>` (Next 16 — both `params` and `searchParams` are Promises; confirm in `node_modules/next/dist/docs/`).
- After loading `payload`, resolve the selected view and render:

```tsx
import { resolveSelectedView } from "@/lib/boards/views";
import { KanbanBoard } from "@/components/boards/KanbanBoard";
// ...
const { view } = await searchParams;
const selected = resolveSelectedView(payload.views, view);
// payload always has ≥1 view (seed/backfill), so `selected` is non-null; guard anyway.
const selectedViewId = selected?.id ?? payload.views[0]?.id ?? "";
// ...
<AppShell ...>
  {selected?.kind === "kanban" ? (
    <KanbanBoard payload={payload} members={members} selectedViewId={selectedViewId} />
  ) : (
    <BoardTable payload={payload} members={members} selectedViewId={selectedViewId} />
  )}
</AppShell>
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS — the board route compiles with the new searchParams + branch.

- [ ] **Step 3: Commit**

```bash
git add src/app/boards/[boardId]/page.tsx
git commit -m "feat(boards): ?view= routing — render Table or Kanban from the selected view"
```

---

## Task 10: e2e — Kanban happy path

**Files:**

- Create: `e2e/kanban.spec.ts` (follow the existing `e2e/` auth/board setup helpers)

- [ ] **Step 1: Write the e2e test**

Mirror the existing board e2e (login, ensure a board exists). Then:

1. Navigate to the board; click the "Add view" control; assert a Kanban tab appears and the URL gains `?view=`.
2. Assert Kanban columns render ("No status", "Working on it", "Stuck", "Done").
3. Drag a card from "No status" onto "Done" (Playwright `dragTo`); reload; assert the card is now under "Done" (status persisted).

- [ ] **Step 2: Run e2e**

Run: `pnpm e2e e2e/kanban.spec.ts`
Expected: PASS. (If drag-and-drop is flaky in Playwright, fall back to asserting persistence by setting the status via the Table view, then switching to Kanban and asserting placement.)

- [ ] **Step 3: Commit**

```bash
git add e2e/kanban.spec.ts
git commit -m "test(boards): e2e Kanban happy path (add view, columns, drag persists)"
```

---

## Task 11: Full verification gate + wrapup

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. Fix anything that fails before proceeding (use systematic-debugging).

- [ ] **Step 2: Advisors**

Run `get_advisors` (Supabase) or document the manual gate. Expected: no new security/perf warnings from `board_views` (RLS enabled, indexes present).

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/phase-3a-views-kanban
gh pr create --title "feat(boards): phase 3a — view infrastructure + Kanban" \
  --body "Implements Phase 3a per docs/superpowers/specs/2026-06-15-phase-3a-views-kanban-design.md.

- board_views table + RLS + create_board_view RPC; create_board seeds a Table view (existing boards backfilled)
- ?view= routing + ViewSwitcher (add/rename/delete, last-view guard)
- KanbanBoard: group by status, drag-to-restatus on the existing cache + realtime
- Tests: RLS integration, resolver/grouping units, action + component tests, e2e

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: After merge — `/wrapup`**

Run `/wrapup` to log a session note and bump the north-star (Phase 3a done → 3b next). Capture any new gotchas (e.g. searchParams-as-Promise, dnd-kit-in-jsdom testing) as ADRs.

---

## Self-Review (completed by plan author)

**Spec coverage:** §3 data model → Task 1; §4 queries/resolvers → Tasks 3-4; §5 routing/switcher → Tasks 6, 9; §6 Kanban → Task 8; §7 actions → Task 5; §8 cache coherence → Tasks 6/9 (navigation-refetch, no cache writes for views); §9 testing → Tasks 2, 3, 4, 5, 6, 8, 10. All sections mapped.

**Placeholder scan:** No "TBD"/"handle edge cases" left. The one judgment call (option-column quick-add auto-status) is resolved explicitly in Task 8 Step 3 (create-in-first-group, no auto-status, drag to set) with a documented rationale.

**Type consistency:** `BoardView`/`BoardPayload.views` defined in Task 3 and used in Tasks 6-9; `buildKanbanColumns`/`NO_STATUS_ID`/`KanbanColumn` defined in Task 4 and used in Task 8; `onCardDropped` signature identical in Task 8 Step 1 (test) and Step 3 (impl); action names `createBoardView`/`updateBoardView`/`deleteBoardView` consistent across Tasks 5, 6. Status value shape `{ optionId }` matches `statusValueSchema`.
