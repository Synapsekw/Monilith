# Phase 2a: Boards Core (Data Layer + Read-Only Table) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice 2a of Phase 2 — the persistent `boards → groups → items → columns → cell_values` data model (with RLS, auto-seeding RPCs, and the Realtime publication), typed server-side reads, Zod-validated mutation Server Actions, a live "Boards" sidebar nav, and a **read-only** virtualized Table view at `/boards/[boardId]`. Cell editing, optimistic updates, and Realtime reconciliation are explicitly **deferred to slice 2b**.

**Architecture:** Postgres (Supabase) is the source of truth. RLS is the only tenant boundary — every new table carries a **denormalized `org_id`** so each policy is a single `is_org_member(org_id)` check (no joins). Atomic multi-row creates (`create_board` auto-seed, `create_item` position derivation) run as `SECURITY DEFINER` RPCs mirroring Phase 1's `create_organization`. Server Components load a board's full payload in one batched read (`src/lib/boards/queries.ts`); mutations are Zod-validated Server Actions (`src/lib/boards/actions.ts`). The Table renders straight from the server payload in 2a (no client cache yet); TanStack Query + optimism + Realtime layer on in 2b. Per-kind cell shapes (`settings` + `value` jsonb) are validated by shared Zod schemas (`src/lib/validations/boards.ts`).

**Tech Stack:** Next.js 16.2.9 (App Router, async `cookies()`), React 19.2, Supabase (`@supabase/ssr` + `supabase-js`), Zod 4, TanStack Table v8 + TanStack Virtual v3 (both **already installed** — see Task 0), Tailwind v4, Vitest 4 (`jsdom`, `@testing-library/react`), Playwright 1.60. Commits use lowercase-subject conventional commits (commitlint enforced); prettier + eslint run on commit via lint-staged.

**Verification commands (memorize — used in every task):**

- `pnpm test` — Vitest run (unit + component + RLS integration). RLS tests auto-skip without `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
- `pnpm test src/lib/validations/boards.test.ts` — run a single test file.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm lint` — eslint.
- `pnpm build` — Next production build.
- `pnpm e2e` — Playwright (boots dev server itself).

**Pre-flight rules for the implementer:**

- **AGENTS.md rule:** This is NOT stock Next.js. BEFORE writing the route / Server Component (Task 5) and any `"use server"` action (Tasks 3–4), read the relevant guide under `node_modules/next/dist/docs/01-app/` (e.g. `01-getting-started`, `03-api-reference`). Heed deprecation notices. `cookies()` is already async in this version (see `src/lib/supabase/server.ts`).
- **UI rule (mandatory):** Tasks 5–7 (sidebar, route, Table, cell renderers) MUST invoke the `pulse-ui` skill AND the `frontend-design` skill before writing any visual code. Monolith uses a monochromatic surface system with a single `--brand` accent (bound to shadcn `--primary`/`--ring`); `--accent` stays gray for hover chrome. Existing primitives live in `src/components/ui/` (`button`, `card`, `input`, `label`, `dialog`, `dropdown-menu`, etc.) — reuse them, do not hand-roll.
- **Supabase CLI is linked** (`supabase/config.toml`, project_id `pulse`). Apply the migration with `supabase db push`. Regenerate types via the supabase MCP `generate_typescript_types` tool (preferred) or `supabase gen types typescript --linked`. Run advisors via the MCP `get_advisors` tool after every schema change — **a phase is not complete with advisor warnings.**
- Work on branch `feat/phase-2a-boards-core` (cut it in Task 0).

---

## Task 0 — Branch, dependency check, scaffolding dirs

**Files**

- Modify: (git branch only)

**Steps**

- [ ] Create and switch to the working branch: `git checkout -b feat/phase-2a-boards-core`.
- [ ] Confirm the three TanStack deps are present (they ARE, per `package.json`): run `pnpm ls @tanstack/react-table @tanstack/react-virtual @tanstack/react-query`. Expected: `@tanstack/react-table 8.21.3`, `@tanstack/react-virtual 3.14.2`, `@tanstack/react-query 5.101.0`. **No `pnpm add` is needed** — skip installing. (If, contrary to expectation, any is missing, run `pnpm add @tanstack/react-table @tanstack/react-virtual` and commit `chore(boards): add tanstack table + virtual deps` before proceeding.)
- [ ] Create the new source directories so later tasks have a home: `mkdir -p src/lib/boards src/components/boards`.
- [ ] No commit yet (empty dirs are not tracked); the first commit lands in Task 1.

---

## Task 1 — Migration: tables + indexes + RLS + RPCs + Realtime publication, then regen types + advisors

This is the SQL foundation. Mirror `supabase/migrations/20260614174043_init_auth_tenancy.sql` exactly: `set search_path = ''` on every function, `SECURITY DEFINER` helpers, default-deny RLS, `create_organization`-style RPCs, explicit grants. **Reuse `is_org_member` / `has_org_role` — do NOT redefine them.**

**Files**

- Create: `supabase/migrations/20260615120000_boards_core.sql` (use the real current UTC timestamp as the prefix when you create it; the suffix must be `_boards_core`)
- Modify: `src/types/database.types.ts` (regenerated, not hand-edited)

**Steps**

- [ ] Write the migration file `supabase/migrations/<timestamp>_boards_core.sql` with the COMPLETE SQL below:

```sql
-- Phase 2a — Boards core
-- boards → groups → items → columns → cell_values (EAV).
-- org_id is DENORMALIZED on every table so each RLS policy is a single
-- is_org_member(org_id) check — no joins, no recursion. Ordering uses
-- position float8 (midpoint reorder). Reuses the Phase 1 SECURITY DEFINER
-- helpers (is_org_member / has_org_role) verbatim — they are NOT redefined here.

-- ============================================================================
-- Enums
-- ============================================================================
create type public.column_kind as enum (
  'text', 'status', 'people', 'date', 'numbers', 'dropdown'
);

-- ============================================================================
-- Tables
-- ============================================================================

-- boards: top-level container under a workspace.
create table public.boards (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 100),
  description  text,
  position     double precision not null default 0,
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index boards_workspace_id_idx on public.boards (workspace_id);
create index boards_org_id_idx on public.boards (org_id);

-- groups: Monday-style colored row-bands within a board.
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  color      text not null default '#0073ea',
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index groups_board_id_idx on public.groups (board_id);
create index groups_org_id_idx on public.groups (org_id);

-- items: a row in a group. `name` is the built-in primary/title column.
-- parent_id stays null in Phase 2 (flat); Phase 6 subitems reuse it.
create table public.items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  parent_id  uuid references public.items (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 255),
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_board_id_idx on public.items (board_id);
create index items_group_id_idx on public.items (group_id);
create index items_org_id_idx on public.items (org_id);

-- columns: configurable column definitions (the six EAV kinds).
create table public.columns (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  kind       public.column_kind not null,
  name       text not null check (char_length(name) between 1 and 100),
  settings   jsonb not null default '{}'::jsonb,
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index columns_board_id_idx on public.columns (board_id);
create index columns_org_id_idx on public.columns (org_id);

-- cell_values: EAV. A missing row = empty cell. PK (item_id, column_id).
create table public.cell_values (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  column_id  uuid not null references public.columns (id) on delete cascade,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (item_id, column_id)
);
create index cell_values_item_id_idx on public.cell_values (item_id);
create index cell_values_org_id_idx on public.cell_values (org_id);

-- ============================================================================
-- Triggers — keep updated_at fresh (reuses Phase 1 public.set_updated_at).
-- ============================================================================
create trigger boards_set_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();
create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();
create trigger columns_set_updated_at
  before update on public.columns
  for each row execute function public.set_updated_at();
create trigger cell_values_set_updated_at
  before update on public.cell_values
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RPC: create_board — atomic auto-seed (board + Group 1 + Status/Owner/Date).
-- Derives org_id from the workspace (membership-checked). Mirrors
-- create_organization (SECURITY DEFINER, set search_path = '').
-- ============================================================================
create or replace function public.create_board(p_workspace_id uuid, p_name text)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_board  public.boards;
  v_group  public.groups;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Derive org_id from the workspace and enforce membership.
  select org_id into v_org_id
  from public.workspaces
  where id = p_workspace_id;

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
  values (v_org_id, v_board.id, 'Group 1', '#0073ea', 0)
  returning * into v_group;

  insert into public.columns (org_id, board_id, kind, name, settings, position)
  values
    (v_org_id, v_board.id, 'status', 'Status', '{"options": []}'::jsonb, 0),
    (v_org_id, v_board.id, 'people', 'Owner',  '{}'::jsonb,              1),
    (v_org_id, v_board.id, 'date',   'Date',   '{}'::jsonb,              2);

  return v_board;
end;
$$;

-- ============================================================================
-- RPC: create_item — derive org_id/board_id from the group, position = max+1.
-- ============================================================================
create or replace function public.create_item(p_group_id uuid, p_name text)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org_id   uuid;
  v_board_id uuid;
  v_pos      double precision;
  v_item     public.items;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id, board_id into v_org_id, v_board_id
  from public.groups
  where id = p_group_id;

  if v_org_id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  select coalesce(max(position), 0) + 1 into v_pos
  from public.items
  where group_id = p_group_id;

  insert into public.items (org_id, board_id, group_id, name, position)
  values (v_org_id, v_board_id, p_group_id, p_name, v_pos)
  returning * into v_item;

  return v_item;
end;
$$;

-- ============================================================================
-- Row Level Security — enable + default-deny on all five tables.
-- ============================================================================
alter table public.boards      enable row level security;
alter table public.groups      enable row level security;
alter table public.items       enable row level security;
alter table public.columns     enable row level security;
alter table public.cell_values enable row level security;

-- boards --------------------------------------------------------------------
create policy "boards: read if member"
  on public.boards for select to authenticated
  using (public.is_org_member(org_id));
create policy "boards: insert if member"
  on public.boards for insert to authenticated
  with check (public.is_org_member(org_id) and created_by = (select auth.uid()));
create policy "boards: update if member"
  on public.boards for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "boards: delete if owner/admin"
  on public.boards for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- groups --------------------------------------------------------------------
create policy "groups: read if member"
  on public.groups for select to authenticated
  using (public.is_org_member(org_id));
create policy "groups: insert if member"
  on public.groups for insert to authenticated
  with check (public.is_org_member(org_id));
create policy "groups: update if member"
  on public.groups for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "groups: delete if member"
  on public.groups for delete to authenticated
  using (public.is_org_member(org_id));

-- items ---------------------------------------------------------------------
create policy "items: read if member"
  on public.items for select to authenticated
  using (public.is_org_member(org_id));
create policy "items: insert if member"
  on public.items for insert to authenticated
  with check (public.is_org_member(org_id));
create policy "items: update if member"
  on public.items for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "items: delete if member"
  on public.items for delete to authenticated
  using (public.is_org_member(org_id));

-- columns -------------------------------------------------------------------
create policy "columns: read if member"
  on public.columns for select to authenticated
  using (public.is_org_member(org_id));
create policy "columns: insert if member"
  on public.columns for insert to authenticated
  with check (public.is_org_member(org_id));
create policy "columns: update if member"
  on public.columns for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "columns: delete if member"
  on public.columns for delete to authenticated
  using (public.is_org_member(org_id));

-- cell_values ---------------------------------------------------------------
create policy "cell_values: read if member"
  on public.cell_values for select to authenticated
  using (public.is_org_member(org_id));
create policy "cell_values: insert if member"
  on public.cell_values for insert to authenticated
  with check (public.is_org_member(org_id));
create policy "cell_values: update if member"
  on public.cell_values for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "cell_values: delete if member"
  on public.cell_values for delete to authenticated
  using (public.is_org_member(org_id));

-- ============================================================================
-- Grants — RLS is the boundary; grant DML + RPC execute to authenticated.
-- ============================================================================
grant select, insert, update, delete
  on public.boards, public.groups, public.items,
     public.columns, public.cell_values
  to authenticated;

grant execute on function public.create_board(uuid, text) to authenticated;
grant execute on function public.create_item(uuid, text) to authenticated;

-- ============================================================================
-- Realtime — add the five tables to the supabase_realtime publication
-- (slice 2b subscribes; provisioning now keeps the migration history clean).
-- ============================================================================
alter publication supabase_realtime add table public.boards;
alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.columns;
alter publication supabase_realtime add table public.cell_values;
```

- [ ] Apply the migration to the linked project: `supabase db push`. Expected: it lists the new migration and applies it without error.
- [ ] Regenerate types into `src/types/database.types.ts`. Preferred: call the supabase MCP `generate_typescript_types` tool and write its output to that file. CLI fallback: `supabase gen types typescript --linked > src/types/database.types.ts`. Expected: the file now contains `boards`, `groups`, `items`, `columns`, `cell_values` row/insert/update types, `create_board`/`create_item` under `Functions`, and a `column_kind` entry under `Enums`.
- [ ] Run advisors via the supabase MCP `get_advisors` tool for both `security` and `performance` lint types. Expected: **clean** (no errors/warnings introduced by this migration). If any unindexed-FK or RLS-init-plan warnings appear for the new tables, add the missing index / wrap helper calls in `(select ...)` (already done) and re-push before proceeding.
- [ ] `pnpm typecheck` — expected PASS (the regenerated types compile; nothing references the new tables yet).
- [ ] Commit: `git add supabase/migrations src/types/database.types.ts && git commit -m "feat(boards): add boards core schema, rls, rpcs, realtime"`.

---

## Task 2 — Zod validators for column `settings` + `value` shapes (TDD) + midpoint position helper

Per spec §2: each `column_kind` has a `settings` shape AND a cell `value` shape. These schemas are shared by server actions (2a) and cell renderers (2b). Also add the `midpoint` reorder helper (spec §2 "Ordering") with its unit test — it is part of the §7 unit-test list even though 2a has no reorder action yet (2b consumes it).

**Files**

- Create: `src/lib/validations/boards.ts`
- Create (Test): `src/lib/validations/boards.test.ts`
- Create: `src/lib/boards/position.ts`
- Create (Test): `src/lib/boards/position.test.ts`

**Steps**

- [ ] Write the FAILING test file `src/lib/validations/boards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  cellValueSchema,
  columnSettingsSchema,
  dateValueSchema,
  dropdownSettingsSchema,
  dropdownValueSchema,
  numbersSettingsSchema,
  numbersValueSchema,
  peopleValueSchema,
  statusSettingsSchema,
  statusValueSchema,
  textValueSchema,
} from "./boards";

describe("column settings schemas", () => {
  it("status settings accepts an options array", () => {
    const r = statusSettingsSchema.safeParse({
      options: [{ id: "1", label: "Done", color: "#00c875" }],
    });
    expect(r.success).toBe(true);
  });

  it("status settings defaults options to []", () => {
    const r = statusSettingsSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.options).toEqual([]);
  });

  it("status settings rejects an option missing a label", () => {
    const r = statusSettingsSchema.safeParse({
      options: [{ id: "1", color: "#fff" }],
    });
    expect(r.success).toBe(false);
  });

  it("dropdown settings mirrors status settings", () => {
    const r = dropdownSettingsSchema.safeParse({
      options: [{ id: "a", label: "A", color: "#000" }],
    });
    expect(r.success).toBe(true);
  });

  it("numbers settings accepts optional unit + precision", () => {
    expect(numbersSettingsSchema.safeParse({}).success).toBe(true);
    expect(
      numbersSettingsSchema.safeParse({ unit: "$", precision: 2 }).success,
    ).toBe(true);
  });

  it("numbers settings rejects a non-integer precision", () => {
    expect(numbersSettingsSchema.safeParse({ precision: 1.5 }).success).toBe(
      false,
    );
  });

  it("columnSettingsSchema dispatches by kind", () => {
    expect(columnSettingsSchema("text").safeParse({}).success).toBe(true);
    expect(columnSettingsSchema("people").safeParse({}).success).toBe(true);
    expect(columnSettingsSchema("date").safeParse({}).success).toBe(true);
    expect(
      columnSettingsSchema("status").safeParse({ options: [] }).success,
    ).toBe(true);
  });
});

describe("cell value schemas", () => {
  it("text value requires a string", () => {
    expect(textValueSchema.safeParse({ text: "hi" }).success).toBe(true);
    expect(textValueSchema.safeParse({ text: 3 }).success).toBe(false);
  });

  it("status value accepts an optionId or null", () => {
    expect(statusValueSchema.safeParse({ optionId: "x" }).success).toBe(true);
    expect(statusValueSchema.safeParse({ optionId: null }).success).toBe(true);
  });

  it("dropdown value is an array of option ids", () => {
    expect(
      dropdownValueSchema.safeParse({ optionIds: ["a", "b"] }).success,
    ).toBe(true);
    expect(dropdownValueSchema.safeParse({ optionIds: "a" }).success).toBe(
      false,
    );
  });

  it("people value is an array of user ids", () => {
    expect(peopleValueSchema.safeParse({ userIds: ["u1"] }).success).toBe(true);
  });

  it("date value requires an ISO date and allows an optional end", () => {
    expect(dateValueSchema.safeParse({ date: "2026-06-15" }).success).toBe(
      true,
    );
    expect(
      dateValueSchema.safeParse({ date: "2026-06-15", end: "2026-06-20" })
        .success,
    ).toBe(true);
    expect(dateValueSchema.safeParse({ date: "not-a-date" }).success).toBe(
      false,
    );
  });

  it("numbers value requires a finite number", () => {
    expect(numbersValueSchema.safeParse({ n: 42 }).success).toBe(true);
    expect(numbersValueSchema.safeParse({ n: "42" }).success).toBe(false);
  });

  it("cellValueSchema dispatches by kind", () => {
    expect(cellValueSchema("text").safeParse({ text: "x" }).success).toBe(true);
    expect(cellValueSchema("numbers").safeParse({ n: 1 }).success).toBe(true);
    expect(cellValueSchema("date").safeParse({ text: "x" }).success).toBe(
      false,
    );
  });
});
```

- [ ] Run it: `pnpm test src/lib/validations/boards.test.ts`. Expected: **FAIL** (module `./boards` does not exist).
- [ ] Create `src/lib/validations/boards.ts` with the COMPLETE implementation:

```ts
import { z } from "zod";
import type { Database } from "@/types/database.types";

export type ColumnKind = Database["public"]["Enums"]["column_kind"];

// --- shared option shape (status + dropdown) ---
export const optionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
});
export type ColumnOption = z.infer<typeof optionSchema>;

// --- per-kind settings ---
export const emptySettingsSchema = z.object({}).strict();
export const statusSettingsSchema = z.object({
  options: z.array(optionSchema).default([]),
});
export const dropdownSettingsSchema = statusSettingsSchema;
export const numbersSettingsSchema = z.object({
  unit: z.string().optional(),
  precision: z.number().int().min(0).max(10).optional(),
});

export function columnSettingsSchema(kind: ColumnKind) {
  switch (kind) {
    case "status":
      return statusSettingsSchema;
    case "dropdown":
      return dropdownSettingsSchema;
    case "numbers":
      return numbersSettingsSchema;
    case "text":
    case "people":
    case "date":
      return emptySettingsSchema;
  }
}

// --- per-kind cell values ---
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date");

export const textValueSchema = z.object({ text: z.string() });
export const statusValueSchema = z.object({
  optionId: z.string().nullable(),
});
export const dropdownValueSchema = z.object({
  optionIds: z.array(z.string()),
});
export const peopleValueSchema = z.object({
  userIds: z.array(z.string()),
});
export const dateValueSchema = z.object({
  date: isoDate,
  end: isoDate.optional(),
});
export const numbersValueSchema = z.object({
  n: z.number().finite(),
});

export function cellValueSchema(kind: ColumnKind) {
  switch (kind) {
    case "text":
      return textValueSchema;
    case "status":
      return statusValueSchema;
    case "dropdown":
      return dropdownValueSchema;
    case "people":
      return peopleValueSchema;
    case "date":
      return dateValueSchema;
    case "numbers":
      return numbersValueSchema;
  }
}
```

- [ ] Run it: `pnpm test src/lib/validations/boards.test.ts`. Expected: **PASS** (all green).
- [ ] Write the FAILING test `src/lib/boards/position.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { midpoint } from "./position";

describe("midpoint", () => {
  it("returns max+1 when appending to the end (no next)", () => {
    expect(midpoint(4, null)).toBe(5);
  });

  it("returns half when prepending to the start (no prev)", () => {
    expect(midpoint(null, 2)).toBe(1);
  });

  it("returns the average of two neighbours", () => {
    expect(midpoint(2, 4)).toBe(3);
  });

  it("returns 0 for the very first position (no neighbours)", () => {
    expect(midpoint(null, null)).toBe(0);
  });

  it("handles fractional neighbours", () => {
    expect(midpoint(1, 1.5)).toBe(1.25);
  });
});
```

- [ ] Run it: `pnpm test src/lib/boards/position.test.ts`. Expected: **FAIL** (module missing).
- [ ] Create `src/lib/boards/position.ts`:

```ts
/**
 * Compute a float8 position between two neighbours for midpoint reordering.
 * - prev=null,next=null → 0 (first row)
 * - prev=null,next set  → next/2 (prepend)
 * - prev set, next=null → prev+1 (append)
 * - both set            → (prev+next)/2 (insert between)
 */
export function midpoint(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 0;
  if (prev === null) return next! / 2;
  if (next === null) return prev + 1;
  return (prev + next) / 2;
}
```

- [ ] Run it: `pnpm test src/lib/boards/position.test.ts`. Expected: **PASS**.
- [ ] `pnpm typecheck` — expected PASS.
- [ ] Commit: `git add src/lib/validations/boards.ts src/lib/validations/boards.test.ts src/lib/boards/position.ts src/lib/boards/position.test.ts && git commit -m "feat(boards): add column settings/value zod schemas and position helper"`.

---

## Task 3 — Data-access reads (`queries.ts`): batched board payload + sidebar board list

Per spec §5: one batched fetch for a board's full payload (no N+1) plus a board-list query for the sidebar. These run in Server Components under the RLS-scoped server client (`src/lib/supabase/server.ts`). Read the Next.js docs note in AGENTS.md before writing server code.

**Files**

- Create: `src/lib/boards/queries.ts`

**Steps**

- [ ] Create `src/lib/boards/queries.ts` with the COMPLETE implementation:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type Board = Tables<"boards">;
export type Group = Tables<"groups">;
export type Item = Tables<"items">;
export type Column = Tables<"columns">;
export type CellValue = Tables<"cell_values">;

export type BoardPayload = {
  board: Board;
  groups: Group[];
  columns: Column[];
  items: Item[];
  cellValues: CellValue[];
};

export type BoardListEntry = Pick<
  Board,
  "id" | "name" | "workspace_id" | "position"
>;

/** All boards visible to the current user (RLS-scoped), for the sidebar. */
export async function listBoards(): Promise<BoardListEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, workspace_id, position")
    .order("position", { ascending: true });
  if (error) return [];
  return data ?? [];
}

/**
 * Batched read of a board's full payload. Returns null when the board is not
 * visible (RLS) or does not exist. Five parallel RLS-scoped reads — no joins,
 * no N+1.
 */
export async function getBoardPayload(
  boardId: string,
): Promise<BoardPayload | null> {
  const supabase = await createClient();

  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("*")
    .eq("id", boardId)
    .maybeSingle();
  if (boardErr || !board) return null;

  const [groupsRes, columnsRes, itemsRes, cellsRes] = await Promise.all([
    supabase
      .from("groups")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
    supabase
      .from("columns")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
    supabase
      .from("items")
      .select("*")
      .eq("board_id", boardId)
      .order("position", { ascending: true }),
    supabase.from("cell_values").select("*").eq("board_id", boardId),
  ]);

  return {
    board,
    groups: groupsRes.data ?? [],
    columns: columnsRes.data ?? [],
    items: itemsRes.data ?? [],
    cellValues: cellsRes.data ?? [],
  };
}
```

- [ ] `pnpm typecheck` — expected PASS (types resolve against the regenerated `database.types.ts`).
- [ ] `pnpm lint` — expected PASS.
- [ ] Commit: `git add src/lib/boards/queries.ts && git commit -m "feat(boards): add batched board payload and sidebar board-list queries"`.

> Note: `queries.ts` has no unit test — it is thin Supabase glue, exercised by the RLS integration suite (Task 8) and the e2e flow (Task 9). Do not mock Supabase here.

---

## Task 4 — Mutation Server Actions (`actions.ts`): create/rename/delete (NO cell editing)

Per spec §5 and the slice-2a scope: `createBoard`, `renameBoard`, `deleteBoard`, `createGroup`, `createItem`, `renameItem`. **Out of scope for 2a (do NOT implement here):** `upsertCell`, `addColumn`, `removeColumn`, `reorderItem`/`reorderGroup`/`reorderColumn` — those are slice 2b. Mirror `src/app/onboarding/actions.ts` (`"use server"`, `createClient()`, `getUser()`, Zod parse, return a typed result; atomic creates call RPCs). Use `revalidatePath` to refresh the Server-Component reads after a mutation.

**Files**

- Create: `src/lib/validations/board-actions.ts`
- Create (Test): `src/lib/validations/board-actions.test.ts`
- Create: `src/lib/boards/actions.ts`

**Steps**

- [ ] Write the FAILING test `src/lib/validations/board-actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createBoardSchema,
  createGroupSchema,
  createItemSchema,
  deleteBoardSchema,
  renameBoardSchema,
  renameItemSchema,
} from "./board-actions";

const uuid = "11111111-1111-1111-1111-111111111111";

describe("board action schemas", () => {
  it("createBoard requires a workspaceId uuid and a 1..100 name", () => {
    expect(
      createBoardSchema.safeParse({ workspaceId: uuid, name: "My Board" })
        .success,
    ).toBe(true);
    expect(
      createBoardSchema.safeParse({ workspaceId: "nope", name: "X" }).success,
    ).toBe(false);
    expect(
      createBoardSchema.safeParse({ workspaceId: uuid, name: "" }).success,
    ).toBe(false);
    expect(
      createBoardSchema.safeParse({ workspaceId: uuid, name: "a".repeat(101) })
        .success,
    ).toBe(false);
  });

  it("createBoard trims the name", () => {
    const r = createBoardSchema.safeParse({
      workspaceId: uuid,
      name: "  Hi  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Hi");
  });

  it("renameBoard requires a boardId and a name", () => {
    expect(
      renameBoardSchema.safeParse({ boardId: uuid, name: "New" }).success,
    ).toBe(true);
    expect(
      renameBoardSchema.safeParse({ boardId: uuid, name: "" }).success,
    ).toBe(false);
  });

  it("deleteBoard requires a boardId uuid", () => {
    expect(deleteBoardSchema.safeParse({ boardId: uuid }).success).toBe(true);
    expect(deleteBoardSchema.safeParse({ boardId: "x" }).success).toBe(false);
  });

  it("createGroup requires a boardId and a name", () => {
    expect(
      createGroupSchema.safeParse({ boardId: uuid, name: "Group 2" }).success,
    ).toBe(true);
  });

  it("createItem requires a groupId and a name", () => {
    expect(
      createItemSchema.safeParse({ groupId: uuid, name: "Task" }).success,
    ).toBe(true);
  });

  it("renameItem requires an itemId and a name", () => {
    expect(
      renameItemSchema.safeParse({ itemId: uuid, name: "Renamed" }).success,
    ).toBe(true);
  });
});
```

- [ ] Run it: `pnpm test src/lib/validations/board-actions.test.ts`. Expected: **FAIL** (module missing).
- [ ] Create `src/lib/validations/board-actions.ts`:

```ts
import { z } from "zod";

const name = z.string().trim().min(1).max(100);
const itemName = z.string().trim().min(1).max(255);
const uuid = z.string().uuid();

export const createBoardSchema = z.object({ workspaceId: uuid, name });
export const renameBoardSchema = z.object({ boardId: uuid, name });
export const deleteBoardSchema = z.object({ boardId: uuid });
export const createGroupSchema = z.object({ boardId: uuid, name });
export const createItemSchema = z.object({ groupId: uuid, name: itemName });
export const renameItemSchema = z.object({ itemId: uuid, name: itemName });
```

- [ ] Run it: `pnpm test src/lib/validations/board-actions.test.ts`. Expected: **PASS**.
- [ ] Read the Next.js Server Actions guide under `node_modules/next/dist/docs/01-app/` before writing the action file (AGENTS.md rule).
- [ ] Create `src/lib/boards/actions.ts` with the COMPLETE implementation:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { midpoint } from "@/lib/boards/position";
import {
  createBoardSchema,
  createGroupSchema,
  createItemSchema,
  deleteBoardSchema,
  renameBoardSchema,
  renameItemSchema,
} from "@/lib/validations/board-actions";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

/** Create a board with auto-seeded Group 1 + Status/Owner/Date via RPC. */
export async function createBoard(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = createBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_board", {
    p_workspace_id: parsed.data.workspaceId,
    p_name: parsed.data.name,
  });
  if (error || !data) return fail(error?.message ?? "Could not create board.");

  revalidatePath("/", "layout");
  return { ok: true, data: { boardId: data.id } };
}

export async function renameBoard(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);

  revalidatePath(`/boards/${parsed.data.boardId}`);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function deleteBoard(input: {
  boardId: string;
}): Promise<ActionResult> {
  const parsed = deleteBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("boards")
    .delete()
    .eq("id", parsed.data.boardId);
  if (error) return fail(error.message);

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function createGroup(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult<{ groupId: string }>> {
  const parsed = createGroupSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  // org_id is denormalized — read it from the board, then derive a position.
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", parsed.data.boardId)
    .maybeSingle();
  if (boardErr || !board) return fail("Board not found.");

  const { data: last } = await supabase
    .from("groups")
    .select("position")
    .eq("board_id", parsed.data.boardId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("groups")
    .insert({
      org_id: board.org_id,
      board_id: parsed.data.boardId,
      name: parsed.data.name,
      position: midpoint(last?.position ?? null, null),
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not create group.");

  revalidatePath(`/boards/${parsed.data.boardId}`);
  return { ok: true, data: { groupId: data.id } };
}

/** Create an item via RPC (server derives org_id/board_id and position). */
export async function createItem(input: {
  groupId: string;
  name: string;
}): Promise<ActionResult<{ itemId: string }>> {
  const parsed = createItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_item", {
    p_group_id: parsed.data.groupId,
    p_name: parsed.data.name,
  });
  if (error || !data) return fail(error?.message ?? "Could not create item.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: { itemId: data.id } };
}

export async function renameItem(input: {
  itemId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = renameItemSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.itemId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (data) revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}
```

- [ ] `pnpm typecheck` — expected PASS.
- [ ] `pnpm lint` — expected PASS.
- [ ] Commit: `git add src/lib/validations/board-actions.ts src/lib/validations/board-actions.test.ts src/lib/boards/actions.ts && git commit -m "feat(boards): add create/rename/delete server actions for boards"`.

> Explicitly OUT OF SCOPE here — slice 2b: `upsertCell`, `addColumn`, `removeColumn`, `reorderItem`/`reorderGroup`/`reorderColumn`. Do not add them.

---

## Task 5 — Live sidebar "Boards" nav + `/boards/[boardId]` route (Server Component)

Per spec §6: wire the disabled "Boards" stub in `app-shell.tsx` to a live list with **+ New board** and an empty state, and add the route. **MANDATORY: invoke `pulse-ui` + `frontend-design` skills before writing any of this.** Read the Next.js App-Router routing/Server-Component guide under `node_modules/next/dist/docs/01-app/` first (AGENTS.md).

**Files**

- Create: `src/components/boards/BoardsNav.tsx` (client — list + new-board dialog)
- Create: `src/app/boards/[boardId]/page.tsx` (Server Component)
- Modify: `src/components/app-shell.tsx` (replace the disabled "Boards" button + accept a `boards` prop)
- Modify: `src/app/page.tsx` (route to first board, or a "no boards" prompt)

**Steps**

- [ ] Invoke the `pulse-ui` skill, then the `frontend-design` skill. Note Monolith's tokens: monochrome surfaces, single `--brand` accent on `--primary`/`--ring`, `--accent` reserved for gray hover chrome. Reuse `@/components/ui/*` primitives (`Button`, `Dialog`, `Input`, `Label`).
- [ ] Create `src/components/boards/BoardsNav.tsx` (client component): renders the org's boards as links to `/boards/[id]`, a **+ New board** button that opens a `Dialog` with an org-name-style form calling the `createBoard` action then `router.push` to the new board, and an empty-state line ("No boards yet") when the list is empty. Use `useRouter` from `next/navigation`, `useTransition` for pending state, and the `BoardListEntry` type from `@/lib/boards/queries`. Mirror the disabled-button styling already in `app-shell.tsx` for the list rows (active row uses `bg-accent text-foreground`). The new-board dialog needs a `workspaceId` — accept the workspaces list as a prop and default to the first workspace.

  Suggested shape (implement fully against the live primitives — adapt class names to what `pulse-ui` specifies):

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, Plus } from "lucide-react";
import { createBoard } from "@/lib/boards/actions";
import type { BoardListEntry } from "@/lib/boards/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BoardsNav({
  boards,
  workspaces,
  activeBoardId,
}: {
  boards: BoardListEntry[];
  workspaces: { id: string; name: string }[];
  activeBoardId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const workspaceId = workspaces[0]?.id;

  function submit() {
    if (!workspaceId) return;
    setError(null);
    startTransition(async () => {
      const res = await createBoard({ workspaceId, name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/boards/${res.data.boardId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-0.5 px-2 py-2">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-muted-foreground flex items-center gap-2.5 text-sm">
          <FolderKanban className="size-4" />
          Boards
        </span>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="New board"
              className="size-6"
            >
              <Plus className="size-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New board</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="board-name">Board name</Label>
                <Input
                  id="board-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sprint backlog"
                />
              </div>
              {error ? (
                <p role="alert" className="text-destructive text-xs">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={isPending || !name.trim()}>
                  {isPending ? "Creating…" : "Create board"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {boards.length === 0 ? (
        <p className="text-muted-foreground px-3 py-1 text-xs">No boards yet</p>
      ) : (
        boards.map((b) => (
          <Link
            key={b.id}
            href={`/boards/${b.id}`}
            className={`truncate rounded-md px-3 py-1.5 text-sm transition-colors ${
              b.id === activeBoardId
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {b.name}
          </Link>
        ))
      )}
    </div>
  );
}
```

- [ ] Modify `src/components/app-shell.tsx`: add `boards?: BoardListEntry[]` and `activeBoardId?: string` to `AppShellProps`; remove the hardcoded `"Boards"` entry from the static `nav` array (keep Dashboards/Goals/Portfolios/Inbox as disabled stubs); render `<BoardsNav boards={boards ?? []} workspaces={workspaces ?? []} activeBoardId={activeBoardId} />` above the remaining disabled nav block. Import `BoardsNav` and `BoardListEntry`.
- [ ] Create `src/app/boards/[boardId]/page.tsx` (Server Component). Note Next 16: `params` is a Promise — `await` it.

```tsx
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BoardTable } from "@/components/boards/BoardTable";
import { getBoardPayload, listBoards } from "@/lib/boards/queries";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const user = await requireUser();

  const payload = await getBoardPayload(boardId);
  if (!payload) notFound();

  const [orgs, boards] = await Promise.all([getUserOrgs(), listBoards()]);
  const supabase = await createClient();
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name");

  return (
    <AppShell
      user={{
        email: user.email,
        full_name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : null,
      }}
      org={{ name: orgs[0]?.name ?? "Pulse" }}
      workspaces={workspaces ?? []}
      boards={boards}
      activeBoardId={boardId}
    >
      <BoardTable payload={payload} />
    </AppShell>
  );
}
```

- [ ] Modify `src/app/page.tsx`: after resolving `orgs`, fetch `listBoards()`; if there is at least one board, `redirect(\`/boards/${boards[0].id}\`)`; otherwise render the existing welcome shell but pass `boards={[]}`and the workspaces so the sidebar shows the **+ New board** affordance and the empty state. (Keep the existing`redirect("/onboarding")`when`orgs.length === 0`.)
- [ ] `pnpm typecheck` — expected PASS. (`BoardTable` is created in Task 6; if doing strict task-ordering, stub it as a no-op component first, then flesh it out in Task 6. Simpler: implement Task 6 before wiring `page.tsx`'s import — but committing this task requires `BoardTable` to exist, so create a minimal placeholder `src/components/boards/BoardTable.tsx` exporting `export function BoardTable() { return null; }` here and replace it fully in Task 6.)
- [ ] `pnpm lint` — expected PASS.
- [ ] `pnpm build` — expected PASS (route compiles).
- [ ] Commit: `git add src/components/app-shell.tsx src/components/boards/BoardsNav.tsx src/app/boards src/app/page.tsx src/components/boards/BoardTable.tsx && git commit -m "feat(boards): wire live boards sidebar nav and board route"`.

---

## Task 6 — `BoardTable` (read-only) + cell renderers (TDD on renderers)

Per spec §6: TanStack Table + `@tanstack/react-virtual` row virtualization; groups as collapsible colored bands; pinned-left **Name** primary column; configurable columns. **All READ-ONLY in 2a.** Cell renderers (`TextCell`/`StatusCell`/`PeopleCell`/`DateCell`/`NumberCell`/`DropdownCell`) are display-only. **MANDATORY: invoke `pulse-ui` + `frontend-design` skills first.** Component tests use Vitest + `@testing-library/react` (mirror `onboarding-form.test.tsx`).

**Files**

- Create: `src/components/boards/cells/index.tsx` (the six renderers + a `CellRenderer` dispatcher)
- Create (Test): `src/components/boards/cells/cells.test.tsx`
- Create: `src/components/boards/BoardTable.tsx` (replaces the Task 5 placeholder)

**Steps**

- [ ] Invoke `pulse-ui` then `frontend-design`. Apply Monolith tokens to the table chrome (monochrome surfaces, group bands tinted by `group.color`, brand accent only for emphasis).
- [ ] Write the FAILING component test `src/components/boards/cells/cells.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DateCell,
  DropdownCell,
  NumberCell,
  PeopleCell,
  StatusCell,
  TextCell,
} from "./index";

const statusSettings = {
  options: [{ id: "o1", label: "Done", color: "#00c875" }],
};

describe("cell renderers (read-only, 2a)", () => {
  it("TextCell shows the text value", () => {
    render(<TextCell value={{ text: "Hello" }} settings={{}} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("TextCell renders an empty cell when value is null", () => {
    const { container } = render(<TextCell value={null} settings={{}} />);
    expect(container.textContent).toBe("");
  });

  it("StatusCell shows the matching option label", () => {
    render(<StatusCell value={{ optionId: "o1" }} settings={statusSettings} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("StatusCell shows nothing for a null optionId", () => {
    const { container } = render(
      <StatusCell value={{ optionId: null }} settings={statusSettings} />,
    );
    expect(container.textContent).toBe("");
  });

  it("DropdownCell shows all selected option labels", () => {
    render(
      <DropdownCell value={{ optionIds: ["o1"] }} settings={statusSettings} />,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("PeopleCell shows the count of assignees", () => {
    render(<PeopleCell value={{ userIds: ["u1", "u2"] }} settings={{}} />);
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("DateCell shows the formatted date", () => {
    render(<DateCell value={{ date: "2026-06-15" }} settings={{}} />);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("NumberCell shows the number with its unit", () => {
    render(<NumberCell value={{ n: 42 }} settings={{ unit: "$" }} />);
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("renderers do not expose editing affordances in 2a", () => {
    render(<TextCell value={{ text: "x" }} settings={{}} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
```

- [ ] Run it: `pnpm test src/components/boards/cells/cells.test.tsx`. Expected: **FAIL** (module missing).
- [ ] Create `src/components/boards/cells/index.tsx` with the COMPLETE read-only renderers. Each takes `value` (the kind's value object or `null`) and `settings` (the kind's settings object), returns display-only JSX, NO inputs/click-to-edit (that is 2b). Use `pulse-ui` styling for badges/pills.

```tsx
import type { ColumnOption } from "@/lib/validations/boards";

type Settings = Record<string, unknown> & { options?: ColumnOption[] };

export function TextCell({
  value,
}: {
  value: { text: string } | null;
  settings: Settings;
}) {
  return <span className="truncate text-sm">{value?.text ?? ""}</span>;
}

function optionById(settings: Settings, id: string | null) {
  if (!id) return undefined;
  return settings.options?.find((o) => o.id === id);
}

export function StatusCell({
  value,
  settings,
}: {
  value: { optionId: string | null } | null;
  settings: Settings;
}) {
  const opt = optionById(settings, value?.optionId ?? null);
  if (!opt) return <span className="text-sm" />;
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: opt.color }}
    >
      {opt.label}
    </span>
  );
}

export function DropdownCell({
  value,
  settings,
}: {
  value: { optionIds: string[] } | null;
  settings: Settings;
}) {
  const opts = (value?.optionIds ?? [])
    .map((id) => optionById(settings, id))
    .filter((o): o is ColumnOption => Boolean(o));
  return (
    <span className="flex flex-wrap gap-1">
      {opts.map((o) => (
        <span
          key={o.id}
          className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: o.color }}
        >
          {o.label}
        </span>
      ))}
    </span>
  );
}

export function PeopleCell({
  value,
}: {
  value: { userIds: string[] } | null;
  settings: Settings;
}) {
  const count = value?.userIds.length ?? 0;
  if (count === 0) return <span className="text-sm" />;
  return (
    <span className="text-muted-foreground text-sm">
      {count} {count === 1 ? "person" : "people"}
    </span>
  );
}

export function DateCell({
  value,
}: {
  value: { date: string; end?: string } | null;
  settings: Settings;
}) {
  if (!value?.date) return <span className="text-sm" />;
  const formatted = new Date(value.date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return <span className="text-sm">{formatted}</span>;
}

export function NumberCell({
  value,
  settings,
}: {
  value: { n: number } | null;
  settings: Settings & { unit?: string; precision?: number };
}) {
  if (value == null) return <span className="text-sm" />;
  const n =
    typeof settings.precision === "number"
      ? value.n.toFixed(settings.precision)
      : String(value.n);
  return (
    <span className="text-sm tabular-nums">
      {n}
      {settings.unit ? ` ${settings.unit}` : ""}
    </span>
  );
}

/** Dispatch a cell to its kind's renderer. */
export function CellRenderer({
  kind,
  value,
  settings,
}: {
  kind: string;
  value: unknown;
  settings: Settings;
}) {
  switch (kind) {
    case "text":
      return (
        <TextCell
          value={value as { text: string } | null}
          settings={settings}
        />
      );
    case "status":
      return (
        <StatusCell
          value={value as { optionId: string | null } | null}
          settings={settings}
        />
      );
    case "dropdown":
      return (
        <DropdownCell
          value={value as { optionIds: string[] } | null}
          settings={settings}
        />
      );
    case "people":
      return (
        <PeopleCell
          value={value as { userIds: string[] } | null}
          settings={settings}
        />
      );
    case "date":
      return (
        <DateCell
          value={value as { date: string; end?: string } | null}
          settings={settings}
        />
      );
    case "numbers":
      return (
        <NumberCell value={value as { n: number } | null} settings={settings} />
      );
    default:
      return null;
  }
}
```

- [ ] Run it: `pnpm test src/components/boards/cells/cells.test.tsx`. Expected: **PASS**.
- [ ] Replace the Task 5 placeholder `src/components/boards/BoardTable.tsx` with the full read-only table (client component). It receives `payload: BoardPayload`, builds a `cellValues` lookup keyed by `${item_id}:${column_id}`, groups items by `group_id`, renders each group as a colored band header + its rows, a pinned-left **Name** column (`item.name`) and one column per `columns` entry rendered via `<CellRenderer>`. Use `@tanstack/react-table` (`useReactTable`, `getCoreRowModel`) for column/header modeling and `@tanstack/react-virtual` (`useVirtualizer`) for row virtualization over a scroll container ref. Group bands tint with `group.color`. Add an **+ Add item** row per group calling the `createItem` action + `router.refresh()`, and a board header showing `payload.board.name`. Everything is display-only otherwise (no cell editing).

  Implementation notes for the worker (apply `pulse-ui` styling throughout):
  - Build `const cellMap = new Map(payload.cellValues.map((c) => [\`${c.item_id}:${c.column_id}\`, c.value]))`.
  - Flatten rows into a single virtualized list of `{ type: "group-header" | "item", ... }` OR virtualize per-group; per-group is simpler. Virtualize the items list with `useVirtualizer({ count, getScrollElement, estimateSize: () => 40, overscan: 10 })`.
  - Pinned Name column: a sticky-left `<div>`/`<td>` with `sticky left-0 bg-surface z-10`.
  - Column header labels come from `column.name`; cell lookup: `cellMap.get(\`${item.id}:${column.id}\`) ?? null`.
  - `"use client"` at top (it has interactivity via the add-item action + virtualization refs).

- [ ] `pnpm typecheck` — expected PASS.
- [ ] `pnpm lint` — expected PASS.
- [ ] `pnpm build` — expected PASS.
- [ ] Commit: `git add src/components/boards/cells src/components/boards/BoardTable.tsx && git commit -m "feat(boards): add read-only board table and cell renderers"`.

> Explicitly OUT OF SCOPE here — slice 2b: inline cell editing (click/Enter/Esc/Tab), `upsertCell` wiring, TanStack Query client cache, optimistic updates, Realtime reconciliation. All cells stay display-only.

---

## Task 7 — RLS integration tests (extend the Phase 1 suite)

Per spec §7: a member of org A cannot read or write org B's boards/groups/items/columns/cells; board delete denied for a non-admin; cross-org `org_id` forgery on insert is rejected. Mirror `src/lib/supabase/rls.integration.test.ts` exactly (same provisioning harness, `describe.skipIf(!SERVICE_ROLE_KEY)`, anon clients per user).

**Files**

- Create (Test): `src/lib/boards/boards.rls.integration.test.ts`

**Steps**

- [ ] Create `src/lib/boards/boards.rls.integration.test.ts` mirroring the Phase 1 harness. Reuse the same `provisionUser` pattern (createUser → signIn → `create_organization` → workspace insert). Then per user call the `create_board` RPC to seed a board (auto-seeds Group 1 + 3 columns), and `create_item` for an item. Assertions:

```ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type TestUser = {
  id: string;
  orgId: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  itemId: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!SERVICE_ROLE_KEY)("RLS: boards tenant isolation", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];
  let userA: TestUser;
  let userB: TestUser;

  async function provisionUser(label: string): Promise<TestUser> {
    const email = `rls-boards-${randomUUID()}@example.com`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
    expect(createErr, `createUser(${label})`).toBeNull();
    const id = created.user!.id;
    createdUserIds.push(id);

    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await anon.auth.signInWithPassword({ email, password: PASSWORD });

    const { data: org } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `rls-b-${label}-${randomUUID().slice(0, 8)}`,
    });
    const orgId = (org as { id: string }).id;

    const { data: ws } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
      .select("id")
      .single();
    const workspaceId = (ws as { id: string }).id;

    const { data: board, error: boardErr } = await anon.rpc("create_board", {
      p_workspace_id: workspaceId,
      p_name: `Board ${label}`,
    });
    expect(boardErr, `create_board(${label})`).toBeNull();
    const boardId = (board as { id: string }).id;

    const { data: group } = await anon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .single();
    const groupId = (group as { id: string }).id;

    const { data: item } = await anon.rpc("create_item", {
      p_group_id: groupId,
      p_name: `Item ${label}`,
    });
    const itemId = (item as { id: string }).id;

    return { id, orgId, workspaceId, boardId, groupId, itemId, anon };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    userA = await provisionUser("a");
    userB = await provisionUser("b");
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("create_board auto-seeds Group 1 + Status/Owner/Date", async () => {
    const { data: groups } = await userA.anon
      .from("groups")
      .select("name")
      .eq("board_id", userA.boardId);
    expect(groups).toEqual([{ name: "Group 1" }]);

    const { data: cols } = await userA.anon
      .from("columns")
      .select("name, kind")
      .eq("board_id", userA.boardId)
      .order("position");
    expect(cols).toEqual([
      { name: "Status", kind: "status" },
      { name: "Owner", kind: "people" },
      { name: "Date", kind: "date" },
    ]);
  });

  it("org A cannot read org B's boards/groups/items/columns", async () => {
    for (const table of ["boards", "groups", "items", "columns"] as const) {
      const col = table === "boards" ? "id" : "board_id";
      const { data } = await userA.anon
        .from(table)
        .select("*")
        .eq(col, userB.boardId);
      expect(data, `read ${table}`).toEqual([]);
    }
  });

  it("org A cannot read org B's cell_values", async () => {
    const { data } = await userA.anon
      .from("cell_values")
      .select("*")
      .eq("board_id", userB.boardId);
    expect(data).toEqual([]);
  });

  it("org A cannot rename org B's board (update affects 0 rows)", async () => {
    const { error } = await userA.anon
      .from("boards")
      .update({ name: "hacked" })
      .eq("id", userB.boardId);
    expect(error).toBeNull(); // RLS hides the row → 0 rows updated, no error
    const { data } = await userB.anon
      .from("boards")
      .select("name")
      .eq("id", userB.boardId)
      .single();
    expect((data as { name: string }).name).toBe("Board b");
  });

  it("cross-org org_id forgery on insert is rejected", async () => {
    const { error } = await userA.anon.from("groups").insert({
      org_id: userB.orgId, // forge B's org
      board_id: userA.boardId,
      name: "forged",
    });
    expect(error).not.toBeNull(); // with check (is_org_member(org_id)) fails
  });

  it("create_item via RPC cannot target another org's group", async () => {
    const { error } = await userA.anon.rpc("create_item", {
      p_group_id: userB.groupId,
      p_name: "intruder",
    });
    expect(error).not.toBeNull();
  });

  it("board delete is denied for a non-admin member", async () => {
    // Add a plain 'member' of org A, then try to delete A's board.
    const memberEmail = `rls-member-${randomUUID()}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      email: memberEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    const memberId = created.user!.id;
    createdUserIds.push(memberId);
    await admin
      .from("org_members")
      .insert({ org_id: userA.orgId, user_id: memberId, role: "member" });

    const memberAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await memberAnon.auth.signInWithPassword({
      email: memberEmail,
      password: PASSWORD,
    });

    await memberAnon.from("boards").delete().eq("id", userA.boardId);
    // The board must still exist (delete policy requires owner/admin).
    const { data: still } = await userA.anon
      .from("boards")
      .select("id")
      .eq("id", userA.boardId);
    expect(still).toHaveLength(1);
  });
});
```

- [ ] Run it: `pnpm test src/lib/boards/boards.rls.integration.test.ts`. Expected: **PASS** locally (with `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`); auto-**SKIP** in CI where the secret is absent. If it fails on a policy assertion, revisit Task 1's RLS — do not weaken the test.
- [ ] Commit: `git add src/lib/boards/boards.rls.integration.test.ts && git commit -m "test(boards): add rls integration tests for boards tenant isolation"`.

---

## Task 8 — e2e Playwright: create board → auto-seed → add item → reload persists

Per spec §7. Mirror `e2e/home.spec.ts` style. This flow needs an authenticated session. The existing e2e suite only covers unauthenticated routes, so add a small auth helper that signs up/logs in a fresh user via the UI (or seeds one) before driving the boards flow. Keep it self-contained.

**Files**

- Create (Test): `e2e/boards.spec.ts`

**Steps**

- [ ] Inspect the existing auth UI flow (`/signup`, `/login`, `/onboarding`) to script a real session: a test helper that signs up a unique user, completes onboarding (org + workspace), landing on `/` with no boards. Confirm selectors against `src/components/onboarding/onboarding-form.tsx` (labels: "Organization name", "Workspace name", button "Create organization") and the signup form (labels: "Full name", "Email", "Password", button "Create account").
- [ ] Create `e2e/boards.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test("create board → auto-seed → add item → reload persists", async ({
  page,
}) => {
  const email = `${unique("e2e")}@example.com`;
  const password = "Test-Password-123!";

  // Sign up.
  await page.goto("/signup");
  await page.getByLabel(/full name/i).fill("E2E Tester");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();

  // Onboarding (new users have no org).
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel(/organization name/i).fill(unique("Org"));
  await page.getByLabel(/workspace name/i).fill("Engineering");
  await page.getByRole("button", { name: /create organization/i }).click();

  // Land on / with no boards — the sidebar shows the empty state + New board.
  await page.waitForURL("/");
  await expect(page.getByText(/no boards yet/i)).toBeVisible();

  // Create a board.
  const boardName = unique("Sprint");
  await page.getByRole("button", { name: /new board/i }).click();
  await page.getByLabel(/board name/i).fill(boardName);
  await page.getByRole("button", { name: /create board/i }).click();

  // Routed to /boards/[id]; auto-seed visible: Group 1 + Status/Owner/Date.
  await page.waitForURL(/\/boards\//);
  await expect(page.getByText("Group 1")).toBeVisible();
  await expect(page.getByText("Status")).toBeVisible();
  await expect(page.getByText("Owner")).toBeVisible();
  await expect(page.getByText("Date")).toBeVisible();

  // Add an item.
  const itemName = unique("Task");
  await page.getByRole("button", { name: /add item/i }).click();
  await page.getByPlaceholder(/item name/i).fill(itemName);
  await page.keyboard.press("Enter");
  await expect(page.getByText(itemName)).toBeVisible();

  // Reload → persistence.
  await page.reload();
  await expect(page.getByText(itemName)).toBeVisible();
  await expect(page.getByText("Group 1")).toBeVisible();
});
```

- [ ] Adjust selectors to the actual `BoardTable` add-item affordance you built in Task 6 (e.g. if "Add item" inserts an inline input with a placeholder, match that placeholder; if it commits on blur instead of Enter, adapt). The assertions on Group 1 / Status / Owner / Date and on item persistence after reload are the required spec coverage — keep them.
- [ ] Run it: `pnpm e2e` (Playwright boots the dev server). Expected: **PASS**. Requires the dev Supabase project reachable and `.env.local` present. If email-confirmation is enforced on signup, either disable it for the dev project or seed the session via the service role in a `test.beforeAll` (note this in the commit body).
- [ ] Commit: `git add e2e/boards.spec.ts && git commit -m "test(boards): add e2e for board create, auto-seed, add item, persistence"`.

---

## Task 9 — Full green gate + finish the branch

**Files**

- Modify: (none — verification + integration only)

**Steps**

- [ ] Run the full suite in order and confirm each is green:
  - [ ] `pnpm typecheck` — PASS.
  - [ ] `pnpm lint` — PASS.
  - [ ] `pnpm test` — PASS (unit + component green; RLS integration green locally / skipped in CI).
  - [ ] `pnpm build` — PASS.
  - [ ] `pnpm e2e` — PASS.
- [ ] Re-run advisors via the supabase MCP `get_advisors` (security + performance) one final time — expected **clean**.
- [ ] Confirm slice-2b items are absent from this branch (no `upsertCell`, no `addColumn`/`removeColumn`, no reorder actions, no inline cell editing, no TanStack Query provider, no Realtime channel) — they belong to `feat/phase-2b-boards-interactive`.
- [ ] Use superpowers:finishing-a-development-branch: push `feat/phase-2a-boards-core`, open a PR titled `feat(boards): phase 2a — boards core data layer + read-only table`, ensure CI is green, then follow the working-agreement merge flow (auto-delete branch on merge).
- [ ] (Post-merge, per spec §8) regenerate types if needed, run advisors, run `/wrapup` to write the session note, and bump the north-star toward Phase 2.

---

## Out of scope — explicitly deferred to slice 2b

Do NOT implement any of the following in this plan/branch:

- Inline cell editing for any kind (click/Enter to edit, Esc cancel, Tab next).
- `upsertCell` Server Action and the `cellValueSchema`-validated write path.
- `addColumn` / `removeColumn`; `reorderItem` / `reorderGroup` / `reorderColumn` (the `midpoint` helper is provisioned now but unused by 2a actions).
- TanStack Query client cache + optimistic updates (`onMutate` snapshot/patch/rollback).
- Supabase Realtime channel subscription + reconciliation/de-dup (the publication is provisioned in Task 1, but nothing subscribes in 2a).
- Folders, subitems (`items.parent_id` stays null), non-Table views, formula/mirror/relation columns, comments, automations.
