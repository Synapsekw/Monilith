# Phase 2b: Boards Interactive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice 2b of Phase 2 — make the read-only board Table from 2a fully **interactive**. Add inline cell editing for all six column kinds (Text, Numbers, Status, Dropdown, People, Date), a TanStack Query client cache keyed `["board", boardId]`, optimistic updates with rollback, and a Supabase Realtime channel that reconciles live changes into the cache. Server-side this adds `upsertCell` + `clearCell` Server Actions (Zod-validated, org/board derived server-side) and a `listOrgMembers(orgId)` query for the People editor. The 2a schema is squashed into one canonical migration (Task 0) and reseeded with default Status options.

**Architecture:** Postgres (Supabase) stays the source of truth; RLS is the only tenant boundary (single `is_org_member(org_id)` check, with parent-org `*_in_org` WITH CHECK guards on writes). Cell writes go through `upsertCell`/`clearCell` Server Actions that derive `org_id`/`board_id` server-side from the parent column/item (clients never supply them) and validate the value with `cellValueSchema(kind)`. The client layers TanStack Query on top of the 2a server payload: the board route hydrates the `["board", boardId]` cache once from the Server-Component payload; a `useBoardMutations` hook drives optimistic `onMutate` (snapshot + patch via pure cache helpers) / `onError` (rollback) / `onSettled` (invalidate-free settle). A single Realtime channel filtered `board_id=eq.<id>` on `cell_values`/`items`/`groups`/`columns` patches the same cache via the same pure helpers, echo-deduped by value no-op. Cell rendering switches from display-only renderers to click/Enter-to-edit editors under `src/components/boards/cells/editors/`.

**Tech Stack:** Next.js 16.2.9 (App Router, async `cookies()`/`params`), React 19.2, Supabase (`@supabase/ssr` + `supabase-js`, Realtime channels via the browser client `src/lib/supabase/client.ts`), Zod 4, TanStack Query v5 (`@tanstack/react-query` 5.101.0, already installed — see `src/components/providers.tsx`), TanStack Table v8 + TanStack Virtual v3, Tailwind v4, Vitest 4 (`jsdom`, `@testing-library/react`, `@testing-library/user-event`), Playwright 1.60. Commits use lowercase-subject conventional commits (commitlint enforced); prettier + eslint run on commit via lint-staged.

**Verification commands (memorize — used in every task):**

- `pnpm test` — Vitest run (unit + component + RLS integration). RLS tests auto-skip without `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
- `pnpm test src/lib/validations/board-actions.test.ts` — run a single test file.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm lint` — eslint.
- `pnpm build` — Next production build.
- `pnpm e2e` — Playwright (boots dev server itself).
- `pnpm db:types` — regenerate `src/types/database.types.ts` (`supabase gen types typescript --linked --schema public | prettier --parser typescript > …`).

**Pre-flight rules for the implementer:**

- **AGENTS.md rule:** This is NOT stock Next.js. BEFORE writing or modifying any `"use server"` action (Task 1) or touching Server Components / the route, read the relevant guide under `node_modules/next/dist/docs/01-app/` (e.g. `01-getting-started`, `03-api-reference`). Heed deprecation notices. `cookies()`/`params` are already async in this version (see `src/lib/supabase/server.ts`, `src/app/boards/[boardId]/page.tsx`).
- **UI rule (mandatory):** Task 5 (cell editors + edit-mode switching) MUST invoke the `pulse-ui` skill AND the `frontend-design` skill before writing any visual code. Pulse uses a monochromatic surface system with a single `--brand` accent (bound to shadcn `--primary`/`--ring`); `--accent` stays gray for hover chrome. The one sanctioned place for option color is the status/label pill (`OptionPill` in `cells/index.tsx`). Reuse `@/components/ui/*` primitives (`Input`, `Button`, `Popover`, `Command`, `Calendar`, `Checkbox`, etc.) — do not hand-roll.
- **`supabase db reset --linked` is DESTRUCTIVE** — it wipes all dev data on the linked project and re-applies migrations from scratch. This is **authorized** for Task 0 (squashing three 2a migrations into one canonical file). Do not run it again after Task 0.
- **Advisors must be clean.** After Task 0's schema change, run advisors via the supabase MCP `get_advisors` tool (security + performance) — a phase is not complete with advisor warnings. (`supabase db lint --linked` is an acceptable CLI fallback.)
- Work on branch `feat/phase-2b-boards-interactive` — **it already exists**; check it out (`git checkout feat/phase-2b-boards-interactive`). Do NOT create it.

---

## Task 0 — Migration squash + reseed (default Status options), reset, regen types, advisors

The 2a schema landed across three migrations (`20260615061747_boards_core.sql`, `…062032_boards_core_fix_vgroup.sql`, `…062912_boards_core_harden_fk.sql`). Squash them into ONE canonical `…_boards_core.sql` that reproduces the EXACT final schema (the `create_board` body WITHOUT the unused `v_group` var; cell_values indexed by `column_id` not `item_id`; the parent-org `board_in_org`/`group_in_org`/`item_in_org`/`column_in_org` helpers and the WITH CHECK policies that use them) AND seeds three default Status options in `create_board`. Apply with the destructive linked reset (authorized). Reuses the Phase 1 helpers (`is_org_member`/`has_org_role`/`set_updated_at`) verbatim — they are NOT redefined.

**Files**

- Delete: `supabase/migrations/20260615061747_boards_core.sql`, `supabase/migrations/20260615062032_boards_core_fix_vgroup.sql`, `supabase/migrations/20260615062912_boards_core_harden_fk.sql`
- Create: `supabase/migrations/20260615061747_boards_core.sql` (keep the earliest 2a timestamp prefix `20260615061747` so the migration sorts after `20260614174043_init_auth_tenancy.sql`; suffix `_boards_core`)
- Modify: `src/types/database.types.ts` (regenerated, not hand-edited)

**Steps**

- [ ] Check out the existing branch: `git checkout feat/phase-2b-boards-interactive`.
- [ ] Delete the three old migration files: `git rm supabase/migrations/20260615061747_boards_core.sql supabase/migrations/20260615062032_boards_core_fix_vgroup.sql supabase/migrations/20260615062912_boards_core_harden_fk.sql`.
- [ ] Create the canonical `supabase/migrations/20260615061747_boards_core.sql` with the COMPLETE squashed SQL below. (Note vs. 2a: `create_board` drops the unused `v_group` declaration and `returning … into v_group`; it seeds three default Status options; `cell_values` is indexed by `column_id` only — the PK already covers `item_id`; insert/update policies carry the parent-org `*_in_org` WITH CHECK guards.)

```sql
-- Phase 2 — Boards core (canonical, squashed)
-- boards → groups → items → columns → cell_values (EAV).
-- org_id is DENORMALIZED on every table so each RLS policy is a single
-- is_org_member(org_id) check — no joins, no recursion. Ordering uses
-- position float8 (midpoint reorder). Reuses the Phase 1 SECURITY DEFINER
-- helpers (is_org_member / has_org_role / set_updated_at) verbatim — they are
-- NOT redefined here. Direct table writes are additionally constrained by
-- parent-org-consistency *_in_org() helpers in WITH CHECK.

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
-- The PK (item_id, column_id) covers item_id lookups; index column_id for
-- cascade deletes + by-column queries. org_id index drives RLS.
create index cell_values_org_id_idx on public.cell_values (org_id);
create index cell_values_column_id_idx on public.cell_values (column_id);

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
-- Parent-org-consistency helpers: does parent row X belong to org O?
-- SECURITY DEFINER (bypass RLS, no recursion), stable, set search_path = ''.
-- ============================================================================
create or replace function public.board_in_org(p_board_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.boards where id = p_board_id and org_id = p_org_id);
$$;
create or replace function public.group_in_org(p_group_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.groups where id = p_group_id and org_id = p_org_id);
$$;
create or replace function public.item_in_org(p_item_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.items where id = p_item_id and org_id = p_org_id);
$$;
create or replace function public.column_in_org(p_column_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.columns where id = p_column_id and org_id = p_org_id);
$$;

-- ============================================================================
-- RPC: create_board — atomic auto-seed (board + Group 1 + Status/Owner/Date).
-- Status seeds with three default options (Working on it / Stuck / Done).
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
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "groups: update if member"
  on public.groups for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "groups: delete if member"
  on public.groups for delete to authenticated
  using (public.is_org_member(org_id));

-- items ---------------------------------------------------------------------
create policy "items: read if member"
  on public.items for select to authenticated
  using (public.is_org_member(org_id));
create policy "items: insert if member"
  on public.items for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.group_in_org(group_id, org_id)
  );
create policy "items: update if member"
  on public.items for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.group_in_org(group_id, org_id)
  );
create policy "items: delete if member"
  on public.items for delete to authenticated
  using (public.is_org_member(org_id));

-- columns -------------------------------------------------------------------
create policy "columns: read if member"
  on public.columns for select to authenticated
  using (public.is_org_member(org_id));
create policy "columns: insert if member"
  on public.columns for insert to authenticated
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "columns: update if member"
  on public.columns for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "columns: delete if member"
  on public.columns for delete to authenticated
  using (public.is_org_member(org_id));

-- cell_values ---------------------------------------------------------------
create policy "cell_values: read if member"
  on public.cell_values for select to authenticated
  using (public.is_org_member(org_id));
create policy "cell_values: insert if member"
  on public.cell_values for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.item_in_org(item_id, org_id)
    and public.column_in_org(column_id, org_id)
  );
create policy "cell_values: update if member"
  on public.cell_values for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.item_in_org(item_id, org_id)
    and public.column_in_org(column_id, org_id)
  );
create policy "cell_values: delete if member"
  on public.cell_values for delete to authenticated
  using (public.is_org_member(org_id));

-- ============================================================================
-- Grants — RLS is the boundary; grant DML + function execute to authenticated.
-- ============================================================================
grant select, insert, update, delete
  on public.boards, public.groups, public.items,
     public.columns, public.cell_values
  to authenticated;

grant execute on function public.create_board(uuid, text) to authenticated;
grant execute on function public.create_item(uuid, text) to authenticated;
grant execute on function public.board_in_org(uuid, uuid)  to authenticated;
grant execute on function public.group_in_org(uuid, uuid)  to authenticated;
grant execute on function public.item_in_org(uuid, uuid)   to authenticated;
grant execute on function public.column_in_org(uuid, uuid) to authenticated;

-- ============================================================================
-- Realtime — add the five tables to the supabase_realtime publication
-- (slice 2b subscribes per-board, filtered board_id=eq.<id>).
-- ============================================================================
alter publication supabase_realtime add table public.boards;
alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.columns;
alter publication supabase_realtime add table public.cell_values;
```

- [ ] Apply the squashed migration with the DESTRUCTIVE linked reset (authorized): `supabase db reset --linked`. Expected: it confirms it will reset the remote DB, drops & re-applies `20260614174043_init_auth_tenancy.sql` then `20260615061747_boards_core.sql` with no errors. (If it prompts interactively, pass `--yes`/`-y`.)
- [ ] Regenerate types: `pnpm db:types`. Expected: `src/types/database.types.ts` still contains `boards`/`groups`/`items`/`columns`/`cell_values`, `create_board`/`create_item` under `Functions`, the four `*_in_org` functions, and `column_kind` under `Enums`. (Schema is unchanged vs. 2a, so the diff should be empty or trivial.)
- [ ] Run advisors via the supabase MCP `get_advisors` tool for both `security` and `performance`. Expected: **clean** — no new errors/warnings. (CLI fallback: `supabase db lint --linked`.) If an unindexed-FK warning appears, add the missing index and re-reset before proceeding.
- [ ] `pnpm typecheck` — expected PASS (regenerated types compile; existing code unchanged).
- [ ] `pnpm test src/lib/boards/boards.rls.integration.test.ts` — expected PASS locally (the harness re-provisions users; the auto-seed test still asserts Group 1 + Status/Owner/Date by name/kind, which the reseed preserves). (Extended for default options in Task 7 — leave it as-is here.)
- [ ] Commit: `git add supabase/migrations src/types/database.types.ts && git commit -m "chore(boards): squash boards-core migrations and seed default status options"`.

---

## Task 1 — `upsertCell` + `clearCell` Server Actions (+ Zod input schemas, TDD on validators)

Per spec §5: `upsertCell` validates input with Zod, derives `org_id`/`board_id` server-side from the parent column (clients never supply them), validates the `value` against `cellValueSchema(kind)` for the column's kind, then upserts `cell_values` on conflict `(item_id, column_id)`. `clearCell` deletes the row (a missing row = empty cell). Add the input schemas to `src/lib/validations/board-actions.ts` and TDD them. Read the Next.js Server Actions guide under `node_modules/next/dist/docs/01-app/` before editing the action file (AGENTS.md rule).

**Files**

- Modify: `src/lib/validations/board-actions.ts`
- Modify (Test): `src/lib/validations/board-actions.test.ts`
- Modify: `src/lib/boards/actions.ts`

**Steps**

- [ ] Read the existing `src/lib/validations/board-actions.test.ts` to match its style, then APPEND the FAILING tests below to it (inside the same file, after the existing `describe`):

```ts
import { upsertCellSchema, clearCellSchema } from "./board-actions";

describe("cell action schemas", () => {
  const itemId = "11111111-1111-1111-1111-111111111111";
  const columnId = "22222222-2222-2222-2222-222222222222";

  it("upsertCell requires itemId + columnId uuids and a value", () => {
    expect(
      upsertCellSchema.safeParse({ itemId, columnId, value: { text: "hi" } })
        .success,
    ).toBe(true);
  });

  it("upsertCell rejects a non-uuid itemId", () => {
    expect(
      upsertCellSchema.safeParse({
        itemId: "nope",
        columnId,
        value: { text: "hi" },
      }).success,
    ).toBe(false);
  });

  it("upsertCell accepts any json-shaped value (kind-validated later)", () => {
    expect(
      upsertCellSchema.safeParse({ itemId, columnId, value: { n: 42 } })
        .success,
    ).toBe(true);
    expect(
      upsertCellSchema.safeParse({
        itemId,
        columnId,
        value: { optionId: null },
      }).success,
    ).toBe(true);
  });

  it("upsertCell rejects a missing value", () => {
    expect(upsertCellSchema.safeParse({ itemId, columnId }).success).toBe(
      false,
    );
  });

  it("clearCell requires itemId + columnId uuids", () => {
    expect(clearCellSchema.safeParse({ itemId, columnId }).success).toBe(true);
    expect(clearCellSchema.safeParse({ itemId: "x", columnId }).success).toBe(
      false,
    );
  });
});
```

- [ ] Run it: `pnpm test src/lib/validations/board-actions.test.ts`. Expected: **FAIL** (`upsertCellSchema`/`clearCellSchema` are not exported).
- [ ] APPEND the schemas to `src/lib/validations/board-actions.ts` (keep the existing `name`/`itemName`/`uuid` definitions and existing exports; add below them):

```ts
// Cell value is validated structurally here (must be a JSON object); the
// kind-specific shape is enforced server-side with cellValueSchema(kind).
const cellValue = z.record(z.string(), z.unknown());

export const upsertCellSchema = z.object({
  itemId: uuid,
  columnId: uuid,
  value: cellValue,
});
export const clearCellSchema = z.object({ itemId: uuid, columnId: uuid });
```

- [ ] Run it: `pnpm test src/lib/validations/board-actions.test.ts`. Expected: **PASS** (all green).
- [ ] Read `node_modules/next/dist/docs/01-app/` Server Actions guidance, then APPEND `upsertCell` + `clearCell` to `src/lib/boards/actions.ts`. Add the two new schema imports to the existing import from `@/lib/validations/board-actions`, and a new import of `cellValueSchema`. Full additions:

  - Extend the existing import block:

```ts
import {
  clearCellSchema,
  createBoardSchema,
  createGroupSchema,
  createItemSchema,
  deleteBoardSchema,
  renameBoardSchema,
  renameItemSchema,
  upsertCellSchema,
} from "@/lib/validations/board-actions";
import { cellValueSchema } from "@/lib/validations/boards";
import type { Json } from "@/types/database.types";
```

- Append the two actions at the end of the file:

```ts
/**
 * Upsert a single cell value. Derives org_id/board_id server-side from the
 * parent column (the client never supplies them) and validates the value
 * against the column kind's schema before writing. Conflict target is the
 * (item_id, column_id) primary key.
 */
export async function upsertCell(input: {
  itemId: string;
  columnId: string;
  value: unknown;
}): Promise<ActionResult> {
  const parsed = upsertCellSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  // Derive org_id/board_id + kind from the parent column (RLS-scoped read).
  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("org_id, board_id, kind")
    .eq("id", parsed.data.columnId)
    .maybeSingle();
  if (colErr || !column) return fail("Column not found.");

  // Validate the value against the column kind's shape.
  const valueParsed = cellValueSchema(column.kind).safeParse(parsed.data.value);
  if (!valueParsed.success)
    return fail(valueParsed.error.issues[0]?.message ?? "Invalid value");

  const { error } = await supabase.from("cell_values").upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: parsed.data.itemId,
      column_id: parsed.data.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  );
  if (error) return fail(error.message);

  revalidatePath(`/boards/${column.board_id}`);
  return { ok: true, data: undefined };
}

/** Clear a cell (delete the row — a missing row is an empty cell). */
export async function clearCell(input: {
  itemId: string;
  columnId: string;
}): Promise<ActionResult> {
  const parsed = clearCellSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("board_id")
    .eq("id", parsed.data.columnId)
    .maybeSingle();
  if (colErr || !column) return fail("Column not found.");

  const { error } = await supabase
    .from("cell_values")
    .delete()
    .eq("item_id", parsed.data.itemId)
    .eq("column_id", parsed.data.columnId);
  if (error) return fail(error.message);

  revalidatePath(`/boards/${column.board_id}`);
  return { ok: true, data: undefined };
}
```

- [ ] `pnpm typecheck` — expected PASS.
- [ ] `pnpm lint` — expected PASS.
- [ ] Commit: `git add src/lib/validations/board-actions.ts src/lib/validations/board-actions.test.ts src/lib/boards/actions.ts && git commit -m "feat(boards): add upsertCell and clearCell server actions"`.

---

## Task 2 — `listOrgMembers(orgId)` query for the People editor

Per spec: the People editor needs the org's members with display info. Add `listOrgMembers(orgId)` to `queries.ts` — `org_members ⋈ profiles` (RLS-scoped under the server client). `org_members` has `(org_id, user_id, role)`; `profiles` has `(id, full_name, email, avatar_url)`. No unit test (thin Supabase glue, exercised via the People editor component test in Task 5 with a passed-in members prop, and end-to-end by RLS).

**Files**

- Modify: `src/lib/boards/queries.ts`

**Steps**

- [ ] APPEND to `src/lib/boards/queries.ts` (after `getBoardPayload`):

```ts
export type OrgMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

/**
 * Members of an org with their profile display info, for the People cell
 * editor. RLS-scoped: only members of the org can read its org_members rows.
 */
export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_members")
    .select("user_id, profiles(full_name, email, avatar_url)")
    .eq("org_id", orgId);
  if (error || !data) return [];
  return data.map((row) => {
    const profile = row.profiles as {
      full_name: string | null;
      email: string | null;
      avatar_url: string | null;
    } | null;
    return {
      userId: row.user_id,
      fullName: profile?.full_name ?? null,
      email: profile?.email ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    };
  });
}
```

- [ ] `pnpm typecheck` — expected PASS. (If the generated `org_members → profiles` embed type does not resolve because there is no declared FK relationship in `database.types.ts`, fall back to two reads: select `user_id` from `org_members` for the org, then `select id, full_name, email, avatar_url from profiles in (userIds)`, and join in JS. Note which path you took in the commit body.)
- [ ] `pnpm lint` — expected PASS.
- [ ] Commit: `git add src/lib/boards/queries.ts && git commit -m "feat(boards): add listOrgMembers query for people editor"`.

---

## Task 3 — Pure cache helpers (`src/lib/boards/cache.ts`), TDD, no React

These pure functions patch a `BoardPayload`-shaped cache object immutably. Both the optimistic mutation layer (Task 4) and the Realtime reconciler (Task 6) call them, so they are framework-free and fully unit-tested. `BoardCache` mirrors the `BoardPayload` shape from `queries.ts` but is defined client-safe here (no `server-only` import).

**Files**

- Create: `src/lib/boards/cache.ts`
- Create (Test): `src/lib/boards/cache.test.ts`

**Steps**

- [ ] Write the FAILING test `src/lib/boards/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  insertItem,
  removeCellValue,
  replaceItem,
  upsertCellValue,
  type BoardCache,
} from "./cache";

function baseCache(): BoardCache {
  return {
    board: { id: "b1", org_id: "o1", name: "B" } as BoardCache["board"],
    groups: [],
    columns: [],
    items: [
      { id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never,
      { id: "i2", board_id: "b1", group_id: "g1", name: "Two" } as never,
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { text: "old" },
      } as never,
    ],
  };
}

describe("upsertCellValue", () => {
  it("replaces an existing cell value by (item_id, column_id)", () => {
    const next = upsertCellValue(baseCache(), {
      item_id: "i1",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "new" },
    } as never);
    const cell = next.cellValues.find(
      (c) => c.item_id === "i1" && c.column_id === "c1",
    );
    expect((cell!.value as { text: string }).text).toBe("new");
    expect(next.cellValues).toHaveLength(1);
  });

  it("inserts a new cell value when none exists", () => {
    const next = upsertCellValue(baseCache(), {
      item_id: "i2",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "x" },
    } as never);
    expect(next.cellValues).toHaveLength(2);
  });

  it("does not mutate the input cache (immutable)", () => {
    const input = baseCache();
    upsertCellValue(input, {
      item_id: "i1",
      column_id: "c1",
      org_id: "o1",
      board_id: "b1",
      value: { text: "new" },
    } as never);
    expect((input.cellValues[0].value as { text: string }).text).toBe("old");
  });
});

describe("removeCellValue", () => {
  it("removes the cell value for (item_id, column_id)", () => {
    const next = removeCellValue(baseCache(), "i1", "c1");
    expect(next.cellValues).toHaveLength(0);
  });

  it("is a no-op when the cell does not exist", () => {
    const next = removeCellValue(baseCache(), "i2", "c9");
    expect(next.cellValues).toHaveLength(1);
  });
});

describe("replaceItem", () => {
  it("replaces a matching item by id", () => {
    const next = replaceItem(baseCache(), {
      id: "i1",
      board_id: "b1",
      group_id: "g1",
      name: "Renamed",
    } as never);
    expect(next.items.find((i) => i.id === "i1")!.name).toBe("Renamed");
  });
});

describe("insertItem", () => {
  it("appends a new item", () => {
    const next = insertItem(baseCache(), {
      id: "i3",
      board_id: "b1",
      group_id: "g1",
      name: "Three",
    } as never);
    expect(next.items).toHaveLength(3);
  });

  it("is idempotent — does not duplicate an existing item id", () => {
    const next = insertItem(baseCache(), {
      id: "i1",
      board_id: "b1",
      group_id: "g1",
      name: "One",
    } as never);
    expect(next.items).toHaveLength(2);
  });
});
```

- [ ] Run it: `pnpm test src/lib/boards/cache.test.ts`. Expected: **FAIL** (module missing).
- [ ] Create `src/lib/boards/cache.ts`:

```ts
import type { Tables } from "@/types/database.types";

export type CacheBoard = Tables<"boards">;
export type CacheGroup = Tables<"groups">;
export type CacheItem = Tables<"items">;
export type CacheColumn = Tables<"columns">;
export type CacheCellValue = Tables<"cell_values">;

/** Client-side mirror of the server BoardPayload shape (no server-only deps). */
export type BoardCache = {
  board: CacheBoard;
  groups: CacheGroup[];
  columns: CacheColumn[];
  items: CacheItem[];
  cellValues: CacheCellValue[];
};

/** Insert or replace a cell value keyed by (item_id, column_id). Immutable. */
export function upsertCellValue(
  cache: BoardCache,
  cell: CacheCellValue,
): BoardCache {
  const idx = cache.cellValues.findIndex(
    (c) => c.item_id === cell.item_id && c.column_id === cell.column_id,
  );
  const cellValues =
    idx === -1
      ? [...cache.cellValues, cell]
      : cache.cellValues.map((c, i) => (i === idx ? cell : c));
  return { ...cache, cellValues };
}

/** Remove the cell value for (item_id, column_id). No-op if absent. Immutable. */
export function removeCellValue(
  cache: BoardCache,
  itemId: string,
  columnId: string,
): BoardCache {
  return {
    ...cache,
    cellValues: cache.cellValues.filter(
      (c) => !(c.item_id === itemId && c.column_id === columnId),
    ),
  };
}

/** Replace an item by id (e.g. rename). No-op if absent. Immutable. */
export function replaceItem(cache: BoardCache, item: CacheItem): BoardCache {
  return {
    ...cache,
    items: cache.items.map((i) => (i.id === item.id ? item : i)),
  };
}

/** Append an item; idempotent on id. Immutable. */
export function insertItem(cache: BoardCache, item: CacheItem): BoardCache {
  if (cache.items.some((i) => i.id === item.id)) return cache;
  return { ...cache, items: [...cache.items, item] };
}
```

- [ ] Run it: `pnpm test src/lib/boards/cache.test.ts`. Expected: **PASS**.
- [ ] `pnpm typecheck` — expected PASS.
- [ ] `pnpm lint` — expected PASS.
- [ ] Commit: `git add src/lib/boards/cache.ts src/lib/boards/cache.test.ts && git commit -m "feat(boards): add pure board cache patch helpers"`.

---

## Task 4 — Board Query-cache wiring + `useBoardMutations` (optimistic, TDD on the hook)

Hydrate `["board", boardId]` from the server payload (the route passes the payload as `initialData`), and add a `useBoardMutations(boardId)` hook whose `setCell`/`clearCellValue` mutations run optimistically: `onMutate` snapshots the cache + patches it via the Task 3 helpers, `onError` rolls back to the snapshot, `onSettled` is a value no-op (no refetch — the Realtime channel and `revalidatePath` keep it fresh). The `QueryClientProvider` already exists in `src/components/providers.tsx`. Test the optimistic patch + rollback against a real `QueryClient` with mocked actions.

**Files**

- Create: `src/lib/boards/use-board-cache.ts` (the query-key factory + a `useBoardCache` reader hook)
- Create: `src/lib/boards/use-board-mutations.ts` (the optimistic mutation hook)
- Create (Test): `src/lib/boards/use-board-mutations.test.tsx`

**Steps**

- [ ] Create `src/lib/boards/use-board-cache.ts`:

```ts
"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { BoardCache } from "@/lib/boards/cache";

export function boardKey(boardId: string) {
  return ["board", boardId] as const;
}

/**
 * Read the board cache. Hydrated from the server payload via `initialData`;
 * there is no `queryFn` because the cache is mutated optimistically and by the
 * Realtime channel — it is never refetched from the client.
 */
export function useBoardCache(boardId: string, initialData: BoardCache) {
  return useQuery({
    queryKey: boardKey(boardId),
    queryFn: () => initialData,
    initialData,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Imperatively patch the board cache (used by mutations + realtime). */
export function patchBoardCache(
  qc: QueryClient,
  boardId: string,
  patch: (prev: BoardCache) => BoardCache,
) {
  qc.setQueryData<BoardCache>(boardKey(boardId), (prev) =>
    prev ? patch(prev) : prev,
  );
}
```

- [ ] Write the FAILING test `src/lib/boards/use-board-mutations.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const upsertCell = vi.fn();
const clearCell = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  upsertCell: (...a: unknown[]) => upsertCell(...a),
  clearCell: (...a: unknown[]) => clearCell(...a),
}));

import { useBoardMutations } from "./use-board-mutations";
import { boardKey } from "./use-board-cache";
import type { BoardCache } from "./cache";

function seedCache(qc: QueryClient): BoardCache {
  const cache: BoardCache = {
    board: { id: "b1", org_id: "o1", name: "B" } as never,
    groups: [],
    columns: [],
    items: [{ id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never],
    cellValues: [],
  };
  qc.setQueryData(boardKey("b1"), cache);
  return cache;
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useBoardMutations.setCell", () => {
  beforeEach(() => {
    upsertCell.mockReset();
    clearCell.mockReset();
  });

  it("optimistically writes the cell value into the cache on mutate", async () => {
    const qc = new QueryClient();
    seedCache(qc);
    upsertCell.mockResolvedValue({ ok: true, data: undefined });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.setCell({
        itemId: "i1",
        columnId: "c1",
        value: { text: "hi" },
      });
    });

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    const cell = cache.cellValues.find(
      (c) => c.item_id === "i1" && c.column_id === "c1",
    );
    expect((cell!.value as { text: string }).text).toBe("hi");
  });

  it("rolls back the cache when the action fails", async () => {
    const qc = new QueryClient();
    seedCache(qc);
    upsertCell.mockResolvedValue({ ok: false, error: "boom" });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.setCell({
        itemId: "i1",
        columnId: "c1",
        value: { text: "hi" },
      });
    });

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.cellValues).toHaveLength(0);
    });
  });
});
```

- [ ] Run it: `pnpm test src/lib/boards/use-board-mutations.test.tsx`. Expected: **FAIL** (module missing).
- [ ] Create `src/lib/boards/use-board-mutations.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clearCell, upsertCell } from "@/lib/boards/actions";
import {
  removeCellValue,
  upsertCellValue,
  type BoardCache,
  type CacheCellValue,
} from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";

type SetCellVars = { itemId: string; columnId: string; value: unknown };
type ClearCellVars = { itemId: string; columnId: string };
type Ctx = { previous?: BoardCache };

export function useBoardMutations(boardId: string) {
  const qc = useQueryClient();
  const key = boardKey(boardId);

  const setCellMutation = useMutation<unknown, Error, SetCellVars, Ctx>({
    mutationFn: async (vars) => {
      const res = await upsertCell(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const cell: CacheCellValue = {
          org_id: previous.board.org_id,
          board_id: previous.board.id,
          item_id: vars.itemId,
          column_id: vars.columnId,
          value: vars.value as CacheCellValue["value"],
          updated_at: new Date().toISOString(),
        };
        qc.setQueryData<BoardCache>(key, upsertCellValue(previous, cell));
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      // No refetch: Realtime + revalidatePath keep the cache fresh.
    },
  });

  const clearCellMutation = useMutation<unknown, Error, ClearCellVars, Ctx>({
    mutationFn: async (vars) => {
      const res = await clearCell(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        qc.setQueryData<BoardCache>(
          key,
          removeCellValue(previous, vars.itemId, vars.columnId),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  return {
    setCell: (vars: SetCellVars) => setCellMutation.mutate(vars),
    clearCellValue: (vars: ClearCellVars) => clearCellMutation.mutate(vars),
  };
}
```

- [ ] Run it: `pnpm test src/lib/boards/use-board-mutations.test.tsx`. Expected: **PASS**.
- [ ] `pnpm typecheck` — expected PASS.
- [ ] `pnpm lint` — expected PASS.
- [ ] Commit: `git add src/lib/boards/use-board-cache.ts src/lib/boards/use-board-mutations.ts src/lib/boards/use-board-mutations.test.tsx && git commit -m "feat(boards): add board query cache wiring and optimistic mutation hook"`.

---

## Task 5 — Cell editors + edit-mode switching in the table (MANDATORY pulse-ui + frontend-design)

Per spec §6: cells become inline-editable — click or Enter to edit, Esc cancels, Tab advances. Add editor components under `src/components/boards/cells/editors/` (Text, Numbers, Status, Dropdown, People, Date), make `BoardTable` track an editing cell `(itemId, columnId)` and render the editor in place via a `CellEditor` dispatcher, committing through `useBoardMutations`. Note: the **Dropdown editor is component-tested only** — no dropdown column is reachable in-app yet (auto-seed only creates Status/People/Date), so it ships untested in the table. **MANDATORY: invoke `pulse-ui` then `frontend-design` before writing any of this.**

**Files**

- Create: `src/components/boards/cells/editors/index.tsx` (the six editors + a `CellEditor` dispatcher)
- Create (Test): `src/components/boards/cells/editors/editors.test.tsx`
- Modify: `src/components/boards/BoardTable.tsx` (wrap in the cache provider boundary, track edit state, render editor on activate, commit via `useBoardMutations`)
- Modify (Test): `src/components/boards/cells/cells.test.tsx` (add an optimistic-rollback interaction test for the table edit flow — see note)

**Steps**

- [ ] Invoke the `pulse-ui` skill, then the `frontend-design` skill. Apply Pulse tokens: monochrome surfaces, the brand accent only on focus rings/`--ring`, the `OptionPill` (status/dropdown color) as the single sanctioned color surface. Reuse `@/components/ui/*` (`Input`, `Popover`/`Command` for Status/Dropdown/People, a date input or `Calendar` popover for Date). Each editor is keyboard-first: Enter commits, Esc cancels (calls `onCancel`), Tab commits then signals "advance".

- [ ] Write the FAILING component test `src/components/boards/cells/editors/editors.test.tsx`. Each editor takes `value`, `settings`, `onCommit(value)`, `onCancel()`, and `members` (People only). Cover: open/seed initial value, commit on Enter, cancel on Esc, and (for selectors) choosing an option calls `onCommit` with the right shape.

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DateEditor,
  NumbersEditor,
  PeopleEditor,
  StatusEditor,
  TextEditor,
} from "./index";

const statusSettings = {
  options: [
    { id: "o1", label: "Done", color: "#00c875" },
    { id: "o2", label: "Stuck", color: "#e2445c" },
  ],
};

describe("TextEditor", () => {
  it("seeds the current value and commits on Enter", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <TextEditor
        value={{ text: "old" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("old");
    await userEvent.clear(input);
    await userEvent.type(input, "new{Enter}");
    expect(onCommit).toHaveBeenCalledWith({ text: "new" });
  });

  it("cancels on Escape without committing", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <TextEditor
        value={{ text: "old" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    await userEvent.type(screen.getByRole("textbox"), "x{Escape}");
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("NumbersEditor", () => {
  it("commits a parsed number on Enter", async () => {
    const onCommit = vi.fn();
    render(
      <NumbersEditor
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByRole("spinbutton"), "42{Enter}");
    expect(onCommit).toHaveBeenCalledWith({ n: 42 });
  });
});

describe("StatusEditor", () => {
  it("commits the chosen option id", async () => {
    const onCommit = vi.fn();
    render(
      <StatusEditor
        value={{ optionId: null }}
        settings={statusSettings}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onCommit).toHaveBeenCalledWith({ optionId: "o1" });
  });
});

describe("PeopleEditor", () => {
  it("toggles a member and commits the user id list", async () => {
    const onCommit = vi.fn();
    render(
      <PeopleEditor
        value={{ userIds: [] }}
        settings={{}}
        members={[
          { userId: "u1", fullName: "Ada", email: "a@x.io", avatarUrl: null },
        ]}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText("Ada"));
    expect(onCommit).toHaveBeenCalledWith({ userIds: ["u1"] });
  });
});

describe("DateEditor", () => {
  it("commits an ISO date", async () => {
    const onCommit = vi.fn();
    render(
      <DateEditor
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/date/i);
    await userEvent.type(input, "2026-06-15");
    await userEvent.type(input, "{Enter}");
    expect(onCommit).toHaveBeenCalledWith({ date: "2026-06-15" });
  });
});
```

- [ ] Run it: `pnpm test src/components/boards/cells/editors/editors.test.tsx`. Expected: **FAIL** (module missing).
- [ ] Create `src/components/boards/cells/editors/index.tsx`. Implement all six editors fully against Pulse primitives (the shapes below are the contract the tests pin; adapt the chrome/classNames to what `pulse-ui` specifies). `OrgMember` is imported from `@/lib/boards/queries` is server-only — instead define a local `EditorMember` type to avoid the `server-only` import in a client module.

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ColumnOption } from "@/lib/validations/boards";
import { Input } from "@/components/ui/input";

type Settings = Record<string, unknown> & { options?: ColumnOption[] };
export type EditorMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

type EditorProps<V> = {
  value: V | null;
  settings: Settings;
  onCommit: (value: V) => void;
  onCancel: () => void;
};

/** Shared key handling: Enter commits, Escape cancels. */
function useCommitKeys(commit: () => void, cancel: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };
}

export function TextEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ text: string }>) {
  const [text, setText] = useState(value?.text ?? "");
  const onKey = useCommitKeys(() => onCommit({ text }), onCancel);
  return (
    <Input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => onCommit({ text })}
      className="h-8"
    />
  );
}

export function NumbersEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ n: number }>) {
  const [raw, setRaw] = useState(value ? String(value.n) : "");
  function commit() {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) return onCancel();
    onCommit({ n });
  }
  const onKey = useCommitKeys(commit, onCancel);
  return (
    <Input
      type="number"
      autoFocus
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onKeyDown={onKey}
      onBlur={commit}
      className="h-8 tabular-nums"
    />
  );
}

export function StatusEditor({
  value,
  settings,
  onCommit,
  onCancel,
}: EditorProps<{ optionId: string | null }>) {
  const options = settings.options ?? [];
  return (
    <div role="listbox" className="bg-surface flex flex-col gap-1 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onCommit({ optionId: o.id })}
          className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-white"
          style={{ backgroundColor: o.color }}
        >
          {o.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onCommit({ optionId: null })}
        className="text-muted-foreground rounded-md px-2 py-1 text-xs"
      >
        Clear
      </button>
    </div>
  );
}

export function DropdownEditor({
  value,
  settings,
  onCommit,
}: EditorProps<{ optionIds: string[] }>) {
  const options = settings.options ?? [];
  const [selected, setSelected] = useState<string[]>(value?.optionIds ?? []);
  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    setSelected(next);
    onCommit({ optionIds: next });
  }
  return (
    <div role="listbox" className="bg-surface flex flex-col gap-1 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={selected.includes(o.id)}
          onClick={() => toggle(o.id)}
          className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-white"
          style={{ backgroundColor: o.color }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PeopleEditor({
  value,
  onCommit,
  members = [],
}: EditorProps<{ userIds: string[] }> & { members?: EditorMember[] }) {
  const [selected, setSelected] = useState<string[]>(value?.userIds ?? []);
  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    setSelected(next);
    onCommit({ userIds: next });
  }
  return (
    <div role="listbox" className="bg-surface flex flex-col gap-1 p-1">
      {members.map((m) => (
        <button
          key={m.userId}
          type="button"
          aria-pressed={selected.includes(m.userId)}
          onClick={() => toggle(m.userId)}
          className="hover:bg-accent rounded-md px-2 py-1 text-left text-sm"
        >
          {m.fullName ?? m.email ?? m.userId}
        </button>
      ))}
    </div>
  );
}

export function DateEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ date: string; end?: string }>) {
  const [date, setDate] = useState(value?.date ?? "");
  function commit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return onCancel();
    onCommit({ date });
  }
  const onKey = useCommitKeys(commit, onCancel);
  return (
    <Input
      type="date"
      aria-label="Date"
      autoFocus
      value={date}
      onChange={(e) => setDate(e.target.value)}
      onKeyDown={onKey}
      onBlur={commit}
      className="h-8"
    />
  );
}

/** Dispatch a cell to its kind's editor. Clearing maps to onCommit of an empty value. */
export function CellEditor({
  kind,
  value,
  settings,
  members,
  onCommit,
  onCancel,
}: {
  kind: string;
  value: unknown;
  settings: Settings;
  members?: EditorMember[];
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}) {
  switch (kind) {
    case "text":
      return (
        <TextEditor
          value={value as { text: string } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );
    case "numbers":
      return (
        <NumbersEditor
          value={value as { n: number } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );
    case "status":
      return (
        <StatusEditor
          value={value as { optionId: string | null } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );
    case "dropdown":
      return (
        <DropdownEditor
          value={value as { optionIds: string[] } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );
    case "people":
      return (
        <PeopleEditor
          value={value as { userIds: string[] } | null}
          settings={settings}
          members={members}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );
    case "date":
      return (
        <DateEditor
          value={value as { date: string; end?: string } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );
    default:
      return null;
  }
}
```

- [ ] Run it: `pnpm test src/components/boards/cells/editors/editors.test.tsx`. Expected: **PASS**.
- [ ] Modify `src/components/boards/BoardTable.tsx` to drive editing from the Query cache:
  - Accept `members: EditorMember[]` as an added prop (passed from the route in Task 5b below).
  - At the top of `BoardTable`, hydrate the cache: `const { data: cache } = useBoardCache(payload.board.id, payload as unknown as BoardCache)` and read `groups/columns/items/cellValues` from `cache` instead of `payload` so optimistic + realtime patches re-render. Build `cellMap` from `cache.cellValues`.
  - Lift editing state to `BoardTable`: `const [editing, setEditing] = useState<{ itemId: string; columnId: string } | null>(null)` and `const { setCell, clearCellValue } = useBoardMutations(payload.board.id)`. Pass `editing`, `setEditing`, `setCell`, `members`, and the columns down to `GroupSection` → each cell.
  - In the per-cell `<div>` of `GroupSection`, when `editing?.itemId === item.id && editing.columnId === col.id`, render `<CellEditor kind={col.kind} value={cellMap.get(...) ?? null} settings={...} members={members} onCommit={(v) => { setCell({ itemId: item.id, columnId: col.id, value: v }); setEditing(null); }} onCancel={() => setEditing(null)} />`; otherwise render the existing `<CellRenderer>` wrapped in a clickable element: `onClick={() => setEditing({ itemId: item.id, columnId: col.id })}` and `onKeyDown` that opens on Enter (make the cell `tabIndex={0} role="button"`).
  - Keep the read-only `CellRenderer` import; add imports for `useBoardCache`, `useBoardMutations`, `CellEditor`, `EditorMember`, and `BoardCache`.
  - Tab-advance: on `onCommit`, after `setEditing(null)`, optionally move to the next column in the same row — track column order from `cache.columns`; this is a nice-to-have, the editor tests already pin Enter/Esc.
- [ ] Add an optimistic-rollback interaction test to `src/components/boards/cells/cells.test.tsx` (append a new `describe`). Render `BoardTable` inside a `QueryClientProvider`, mock `@/lib/boards/actions` so `upsertCell` resolves `{ ok: false, error: "boom" }`, click a Status cell, choose an option (the cell shows the new label optimistically), then `await waitFor` that the label reverts (rollback). Mirror the existing render style in this file; wrap in a `QueryClientProvider` like the Task 4 test.

```tsx
// (append to src/components/boards/cells/cells.test.tsx)
import { vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const upsertCellMock = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  upsertCell: (...a: unknown[]) => upsertCellMock(...a),
  clearCell: vi.fn(),
  createItem: vi.fn().mockResolvedValue({ ok: true, data: { itemId: "x" } }),
}));

import { BoardTable } from "@/components/boards/BoardTable";
import type { BoardPayload } from "@/lib/boards/queries";

function tableWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function statusPayload(): BoardPayload {
  return {
    board: { id: "b1", org_id: "o1", name: "B" } as never,
    groups: [
      { id: "g1", board_id: "b1", name: "Group 1", color: "#0073ea" } as never,
    ],
    columns: [
      {
        id: "c1",
        board_id: "b1",
        org_id: "o1",
        kind: "status",
        name: "Status",
        settings: { options: [{ id: "o1", label: "Done", color: "#00c875" }] },
      } as never,
    ],
    items: [{ id: "i1", board_id: "b1", group_id: "g1", name: "One" } as never],
    cellValues: [],
  };
}

describe("BoardTable inline edit (optimistic + rollback)", () => {
  beforeEach(() => upsertCellMock.mockReset());

  it("reverts the optimistic status edit when the action fails", async () => {
    upsertCellMock.mockResolvedValue({ ok: false, error: "boom" });
    const qc = new QueryClient();
    render(<BoardTable payload={statusPayload()} members={[]} />, {
      wrapper: tableWrapper(qc),
    });

    // Open the Status cell editor (the empty cell on row "One").
    await userEvent.click(
      screen
        .getByRole("button", { name: /one/i })
        .closest("div")!
        .parentElement!.querySelectorAll('[role="button"]')[0] as HTMLElement,
    );
    // NOTE: the implementer must give the editable cell a stable accessible
    // name/test id (e.g. aria-label={`${item.name} ${col.name}`}) and target it
    // here instead of the brittle DOM walk above.
    await userEvent.click(await screen.findByRole("button", { name: /done/i }));

    // Optimistic: "Done" shows briefly, then rollback removes it.
    await waitFor(() =>
      expect(screen.queryByText("Done")).not.toBeInTheDocument(),
    );
  });
});
```

> Implementer note: the brittle DOM walk above is a placeholder — when wiring `BoardTable`, give each editable cell a stable `aria-label={`${item.name} ${column.name}`}` (or `data-testid`) and select it in the test by that label. The required assertion is the optimistic-then-rollback behaviour; keep it, fix the selector to match your markup.

- [ ] Run the component suites: `pnpm test src/components/boards/cells/editors/editors.test.tsx src/components/boards/cells/cells.test.tsx`. Expected: **PASS** (the existing 2a read-only renderer tests stay green; the new editor + rollback tests pass).
- [ ] `pnpm typecheck` — expected PASS.
- [ ] `pnpm lint` — expected PASS.
- [ ] `pnpm build` — expected PASS.
- [ ] Commit: `git add src/components/boards/cells/editors src/components/boards/cells/cells.test.tsx src/components/boards/BoardTable.tsx && git commit -m "feat(boards): add inline cell editors with optimistic updates"`.

### Task 5b — wire `members` into the route

**Files**

- Modify: `src/app/boards/[boardId]/page.tsx`

**Steps**

- [ ] In `src/app/boards/[boardId]/page.tsx`, import `listOrgMembers` from `@/lib/boards/queries`, fetch members for the board's org (`payload.board.org_id`) alongside the existing `orgs`/`boards`/`workspaces` reads, and pass `members={members}` to `<BoardTable payload={payload} members={members} />`.
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` — expected PASS.
- [ ] Commit: `git add src/app/boards/[boardId]/page.tsx && git commit -m "feat(boards): load org members for the people cell editor"`.

---

## Task 6 — Realtime channel: subscribe per board, reconcile into the cache, de-dupe echoes

Per spec §6: one Supabase Realtime channel per board filtered `board_id=eq.<id>` on `cell_values`/`items`/`groups`/`columns`. Incoming changes patch the `["board", boardId]` cache via the Task 3 helpers; teardown on unmount; echo-dedupe by value no-op (skip a `cell_values` UPDATE/INSERT whose value already equals what is in the cache, so our own optimistic write does not flicker). Uses the browser client `createClient()` from `src/lib/supabase/client.ts`.

**Files**

- Create: `src/lib/boards/use-board-realtime.ts`
- Modify: `src/components/boards/BoardTable.tsx` (call the hook)

**Steps**

- [ ] Create `src/lib/boards/use-board-realtime.ts`:

```ts
"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  insertItem,
  removeCellValue,
  replaceItem,
  upsertCellValue,
  type BoardCache,
  type CacheCellValue,
  type CacheItem,
} from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";

/**
 * Subscribe one Realtime channel for the board, reconciling cell_values + items
 * (+ groups/columns) changes into the ["board", boardId] cache. De-dupes echoes
 * from our own optimistic writes by skipping no-op cell value patches.
 */
export function useBoardRealtime(boardId: string) {
  const qc = useQueryClient();
  const key = boardKey(boardId);

  useEffect(() => {
    const supabase = createClient();
    const filter = `board_id=eq.${boardId}`;

    function patch(fn: (prev: BoardCache) => BoardCache) {
      qc.setQueryData<BoardCache>(key, (prev) => (prev ? fn(prev) : prev));
    }

    function onCell(p: RealtimePostgresChangesPayload<CacheCellValue>) {
      if (p.eventType === "DELETE") {
        const oldRow = p.old as Partial<CacheCellValue>;
        if (oldRow.item_id && oldRow.column_id) {
          patch((prev) =>
            removeCellValue(prev, oldRow.item_id!, oldRow.column_id!),
          );
        }
        return;
      }
      const row = p.new as CacheCellValue;
      patch((prev) => {
        // Echo-dedupe: if the value already matches, skip (no re-render churn).
        const existing = prev.cellValues.find(
          (c) => c.item_id === row.item_id && c.column_id === row.column_id,
        );
        if (
          existing &&
          JSON.stringify(existing.value) === JSON.stringify(row.value)
        )
          return prev;
        return upsertCellValue(prev, row);
      });
    }

    function onItem(p: RealtimePostgresChangesPayload<CacheItem>) {
      if (p.eventType === "DELETE") {
        const oldRow = p.old as Partial<CacheItem>;
        patch((prev) => ({
          ...prev,
          items: prev.items.filter((i) => i.id !== oldRow.id),
        }));
        return;
      }
      const row = p.new as CacheItem;
      patch((prev) =>
        prev.items.some((i) => i.id === row.id)
          ? replaceItem(prev, row)
          : insertItem(prev, row),
      );
    }

    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cell_values", filter },
        onCell,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "items", filter },
        onItem,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [boardId, qc, key]);
}
```

> Note: `groups`/`columns` are on the publication and the spec lists them, but the 2b UI only mutates cells + items. Wiring `groups`/`columns` handlers is optional polish; if you add them, reconcile by replacing the matching row in `cache.groups`/`cache.columns`. The required reconciliation is `cell_values` + `items`.

- [ ] In `src/components/boards/BoardTable.tsx`, call `useBoardRealtime(payload.board.id)` once near the top of `BoardTable` (alongside `useBoardCache`/`useBoardMutations`).
- [ ] `pnpm typecheck` — expected PASS. (If the `RealtimePostgresChangesPayload` import path/name differs in this `@supabase/supabase-js` version, check `node_modules/@supabase/supabase-js` exports and adjust the type import; the runtime `.on("postgres_changes", …)` call is stable.)
- [ ] `pnpm lint` — expected PASS.
- [ ] `pnpm build` — expected PASS.
- [ ] Commit: `git add src/lib/boards/use-board-realtime.ts src/components/boards/BoardTable.tsx && git commit -m "feat(boards): reconcile realtime changes into the board cache"`.

---

## Task 7 — RLS integration test: upsertCell cross-org rejection + default Status options seed

Per spec §7: extend `src/lib/boards/boards.rls.integration.test.ts`. Add (a) an assertion that `create_board` now seeds three default Status options on the Status column, and (b) a direct `cell_values` write test proving a member of org A cannot upsert a cell on org B's item/column (cross-org rejected by the parent-org WITH CHECK), while a same-org cell upsert succeeds. Mirror the existing harness exactly (it already provisions `userA`/`userB` with a board + group + item).

**Files**

- Modify (Test): `src/lib/boards/boards.rls.integration.test.ts`

**Steps**

- [ ] In `boards.rls.integration.test.ts`, UPDATE the existing `"create_board auto-seeds Group 1 + Status/Owner/Date"` test to also assert the default Status options, and ADD the cell-write tests. Insert these inside the `describe` block:

```ts
it("create_board seeds three default Status options", async () => {
  const { data: status } = await userA.anon
    .from("columns")
    .select("settings")
    .eq("board_id", userA.boardId)
    .eq("kind", "status")
    .single();
  const options = (status as { settings: { options: { label: string }[] } })
    .settings.options;
  expect(options.map((o) => o.label)).toEqual([
    "Working on it",
    "Stuck",
    "Done",
  ]);
});

it("a member can upsert a cell on their own board's item/column", async () => {
  const { data: col } = await userA.anon
    .from("columns")
    .select("id")
    .eq("board_id", userA.boardId)
    .eq("kind", "status")
    .single();
  const columnId = (col as { id: string }).id;

  const { error } = await userA.anon.from("cell_values").insert({
    org_id: userA.orgId,
    board_id: userA.boardId,
    item_id: userA.itemId,
    column_id: columnId,
    value: { optionId: null },
  });
  expect(error).toBeNull();
});

it("org A cannot upsert a cell on org B's item/column", async () => {
  const { data: colB } = await userB.anon
    .from("columns")
    .select("id")
    .eq("board_id", userB.boardId)
    .eq("kind", "status")
    .single();
  const columnIdB = (colB as { id: string }).id;

  // Even with A's own org_id, the parent-org WITH CHECK rejects B's item/column.
  const { error } = await userA.anon.from("cell_values").insert({
    org_id: userA.orgId,
    board_id: userB.boardId,
    item_id: userB.itemId,
    column_id: columnIdB,
    value: { optionId: null },
  });
  expect(error).not.toBeNull();
});
```

- [ ] Run it: `pnpm test src/lib/boards/boards.rls.integration.test.ts`. Expected: **PASS** locally (with `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`); auto-**SKIP** in CI. If the default-options assertion fails, revisit Task 0's `create_board` seed. If a cross-org write unexpectedly succeeds, revisit the `cell_values` insert WITH CHECK.
- [ ] Commit: `git add src/lib/boards/boards.rls.integration.test.ts && git commit -m "test(boards): cover cell upsert rls and default status seed"`.

---

## Task 8 — e2e Playwright: edit Status + Date + Text → reload persists

Per spec §7. Extend the seeded-board flow in `e2e/boards.spec.ts` (reuse its service-role confirmed-user creation + UI-login + onboarding + create-board + add-item setup verbatim). After adding an item, edit its Status (pick an option), Date, and the (Name/Text) — then reload and assert persistence. The two-context realtime test is **optional/flagged** (a second browser context sees the first context's edit live); guard it behind an env flag so CI stays green.

**Files**

- Modify (Test): `e2e/boards.spec.ts`

**Steps**

- [ ] Read the current `e2e/boards.spec.ts` flow (login via `/login` with the confirmed user, onboarding, create board, add an item with the "Add item" input + Enter). Keep all of it; extend the single test (or add a second `test` in the same describe reusing the same provisioned user) to edit cells AFTER the item is added.
- [ ] Add, after the "Add an item" + visible assertions, cell edits keyed off the editable-cell accessible names you set in Task 5 (`aria-label={`${item.name} ${column.name}`}`):

```ts
// ── Edit the Status cell: open → pick "Working on it" ─────────────────────
await page.getByRole("button", { name: `${itemName} Status` }).click();
await page.getByRole("button", { name: /working on it/i }).click();
await expect(page.getByText(/working on it/i)).toBeVisible();

// ── Edit the Date cell ────────────────────────────────────────────────────
await page.getByRole("button", { name: `${itemName} Date` }).click();
await page.getByLabel(/date/i).fill("2026-06-15");
await page.keyboard.press("Enter");
await expect(page.getByText(/2026/)).toBeVisible();

// ── Reload → edits persist ───────────────────────────────────────────────
await page.reload();
await expect(page.getByText(itemName)).toBeVisible();
await expect(page.getByText(/working on it/i)).toBeVisible();
await expect(page.getByText(/2026/)).toBeVisible();
```

- [ ] (Optional, flagged) Add a realtime test guarded by `test.skip(!process.env.E2E_REALTIME, …)`: open a second `browser.newContext()` logged in as the same user, navigate both to the board, edit a cell in context 1, and assert the change appears in context 2 without reload. Keep it skipped by default so CI is green.
- [ ] Adjust selectors to your actual editor markup (Status options render as buttons with the option label; the Date editor is an `<input type="date" aria-label="Date">`). The required coverage is: edit Status + Date persist across reload.
- [ ] Run it: `pnpm e2e` (Playwright boots the dev server; needs the dev Supabase project + `.env.local`). Expected: **PASS** (or graceful skip when secrets are absent, as the existing describe already guards).
- [ ] Commit: `git add e2e/boards.spec.ts && git commit -m "test(boards): e2e edit status and date cells with persistence"`.

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
  - [ ] `pnpm e2e` — PASS (or guarded skip without secrets).
- [ ] Re-run advisors via the supabase MCP `get_advisors` (security + performance) one final time — expected **clean** (CLI fallback `supabase db lint --linked`).
- [ ] Confirm 2b scope is complete and self-consistent: `upsertCell`/`clearCell` exist; `listOrgMembers` exists; `cache.ts` + `use-board-cache.ts` + `use-board-mutations.ts` + `use-board-realtime.ts` exist; editors under `cells/editors/`; `BoardTable` reads the cache, edits inline, subscribes to realtime; the three 2a migrations are gone, replaced by one canonical `_boards_core.sql`.
- [ ] Use superpowers:finishing-a-development-branch: push `feat/phase-2b-boards-interactive`, open a PR titled `feat(boards): phase 2b — interactive table (inline editing, optimistic, realtime)`, ensure CI is green, then follow the working-agreement merge flow (auto-delete branch on merge).
- [ ] (Post-merge, per spec §8) regenerate types if needed, run advisors, run `/wrapup` to write the session note, and bump the north-star (Phase 2 → Done).

---

## Out of scope — explicitly deferred beyond slice 2b

Do NOT implement any of the following in this plan/branch:

- `addColumn` / `removeColumn`; in-app creation of a Dropdown column (the Dropdown editor ships component-tested only — there is no UI to add a dropdown column yet).
- `reorderItem` / `reorderGroup` / `reorderColumn` and drag-and-drop (the `midpoint` helper exists from 2a but stays unused by 2b).
- Folders, subitems (`items.parent_id` stays null), non-Table views (Phase 3), formula/mirror/relation columns, comments, automations.
- Date `end`/timeline ranges in the UI (the schema + value shape allow `end`, but 2b only edits a single `date`).
