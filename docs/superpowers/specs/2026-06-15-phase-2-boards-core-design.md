---
type: spec
status: approved
date: 2026-06-15
tags: [project/monolith, spec, phase-2]
related:
  ["[[00-north-star]]", "[[2026-06-14-pulse-design]]", "[[platform-roadmap]]"]
---

# Monolith — Phase 2: Boards Core — Design Spec

> Derived from the master spec ([[2026-06-14-pulse-design]] §4.1, §5, §7) and the Phase 2
> brainstorm (2026-06-15). Builds directly on the Phase 1 auth/tenancy schema and RLS helpers.

## 1. Goal & scope

Deliver the **Boards core**: the `workspace → board → group → item` hierarchy with a
configurable column system (EAV cell values), a virtualized **Table view** with inline
editing for six column kinds, optimistic updates, and Supabase Realtime sync.

**In scope:** boards, groups, items, columns, cell_values; RLS; auto-seeded boards; Table
view; inline editing (Text / Status / People / Date / Numbers / Dropdown); optimistic
updates; realtime.

**Out of scope (deferred):** folders (no Phase-2 UI), subitems (Phase 6 — but `items.parent_id`
is provisioned now), non-Table views (Phase 3), formula/mirror/relation columns, comments,
automations.

### Slicing

Phase 2 ships as **two vertical slices**, each an independently shippable branch + PR with
green CI:

- **Slice 2a — data layer + read-only Table.** Migration (tables + RLS + RPCs + realtime
  publication) → regen types → advisor-lint; Zod validators; server-side queries + mutation
  Server Actions; sidebar Boards nav wired live; Table view rendering groups/items/cells
  **read-only**. Branch `feat/phase-2a-boards-core`.
- **Slice 2b — interactive Table.** Inline cell editing for all six kinds; TanStack Query
  client cache + optimistic updates; Supabase Realtime reconciliation. Branch
  `feat/phase-2b-boards-interactive`.

## 2. Data model

New tables, all with `org_id` **denormalized** (spec rule — RLS is a single
`is_org_member(org_id)` check, no joins). All carry `created_at`/`updated_at` with the
existing `set_updated_at` trigger. Ordering uses `position float8` (midpoint reorder).

### `boards`

`id uuid pk · org_id → organizations · workspace_id → workspaces · name text (1..100) ·
description text null · position float8 · created_by → auth.users · created_at · updated_at`

### `groups`

Monday's colored row-bands within a board.
`id · org_id · board_id → boards · name text · color text · position float8 · created_at · updated_at`

### `items`

`id · org_id · board_id → boards · group_id → groups · parent_id uuid null → items ·
name text · position float8 · created_at · updated_at`

- `name` is the **built-in primary/title column** — a first-class field on `items`, NOT in
  the EAV. The six configurable kinds live in `columns` / `cell_values`.
- `parent_id` stays **null in Phase 2** (flat items per group); Phase 6 subitems reuse it
  with no migration churn.

### `columns`

`id · org_id · board_id → boards · kind column_kind · name text · settings jsonb not null
default '{}' · position float8 · created_at · updated_at`

- `column_kind` enum: `text, status, people, date, numbers, dropdown`.
- `settings` jsonb, per-kind, Zod-validated at the write boundary:
  - `status` → `{ options: [{ id, label, color }] }`
  - `dropdown` → `{ options: [{ id, label, color }] }`
  - `numbers` → `{ unit?: string, precision?: number }`
  - `text` / `people` / `date` → `{}`

### `cell_values` (EAV)

`org_id · board_id · item_id → items · column_id → columns · value jsonb not null ·
updated_at · primary key (item_id, column_id)`

- A **missing row = empty cell** (no pre-fill on item create).
- `value` jsonb is per-kind and Zod-validated:
  - `text` → `{ text: string }`
  - `status` / single-select → `{ optionId: string | null }`
  - `dropdown` (multi) → `{ optionIds: string[] }`
  - `people` → `{ userIds: string[] }`
  - `date` → `{ date: string, end?: string }` (ISO dates; `end` reserved for timelines)
  - `numbers` → `{ n: number }`

### Ordering

`position float8` on boards/groups/items/columns. Reorder = midpoint between neighbours
(no bulk row rewrites). A shared helper computes the new position; renormalize a group's
positions only if a gap collapses (negligible at this scale). _(LexoRank text ranks were
considered and rejected as more machinery than Phase 2 needs.)_

### Indexes

`boards(workspace_id)`, `groups(board_id)`, `items(board_id)`, `items(group_id)`,
`columns(board_id)`, `cell_values(item_id)`, plus `org_id` indexes where they drive RLS.

## 3. Row Level Security

`enable row level security` + default-deny on all five tables. Policies reuse the Phase-1
SECURITY DEFINER helpers verbatim (`is_org_member`, `has_org_role`):

- **select / insert / update / delete** gated on `is_org_member(org_id)`.
- `with check` on insert/update pins `org_id` to a real membership — a client cannot forge
  cross-org rows.
- **Board delete** restricted to `has_org_role(org_id, [owner, admin])`; group / item /
  column / cell delete = any member (matches the `workspaces` precedent).
- `grant select, insert, update, delete … to authenticated` (RLS is the boundary).

## 4. RPCs (SECURITY DEFINER, mirroring `create_organization`)

- **`create_board(p_workspace_id uuid, p_name text) → boards`** — auto-seed. Atomically:
  derive `org_id` from the workspace (membership-checked), insert the board, a default group
  `'Group 1'`, and three starter columns (`Status`, `Owner` = people, `Date`). Returns the board.
- **`create_item(p_group_id uuid, p_name text) → items`** — derive `org_id`/`board_id`
  server-side, set `position` = max+1 within the group, insert. Returns the item.
- Everything else (rename, cell upsert, reorder, add/remove column/group, delete) is a plain
  RLS-protected table write — no RPC needed.

After the migration: `generate_typescript_types` → `src/types/database.types.ts`, then
`get_advisors` (must be clean — no phase complete with advisor warnings).

## 5. Data-access layer (`src/lib/boards/`)

- **`queries.ts`** — server-side typed reads. One batched fetch for a board's full payload
  (groups, columns, items, cell_values) to avoid N+1; plus a board-list query for the sidebar.
- **`actions.ts`** — Server Actions for mutations: `createBoard`, `renameBoard`,
  `deleteBoard`, `createGroup`, `createItem`, `renameItem`, `upsertCell`, `addColumn`,
  `removeColumn`, `reorderItem` / `reorderGroup` / `reorderColumn`. Each validates input with
  Zod before touching Supabase; atomic creates call the RPCs, the rest are direct writes.
- **`src/lib/validations/boards.ts`** — Zod schemas for every column kind's `settings` and
  `value` shape, shared by actions (server) and cell renderers (client).
- **Client cache (2b):** TanStack Query holds the board payload keyed by `boardId`. Slice 2a
  renders straight from the server payload; 2b layers Query on top for optimism + realtime.

## 6. UI

Built with the `pulse-ui` + `frontend-design` skills (mandatory for any visual work).

### Routing & surfaces

- **`/boards/[boardId]`** — Server Component loads the batched board payload, renders inside
  the existing `AppShell`.
- **Sidebar "Boards"** (currently a disabled stub in `app-shell.tsx`) becomes live: lists the
  org's boards per workspace, a **+ New board** action, and an empty state.
- **`/`** keeps the onboarding redirect when the user has no org; with an org it routes to the
  first board, or a "no boards yet" prompt when none exist.

### Components (`src/components/boards/`)

- **`BoardTable`** — TanStack Table + `@tanstack/react-virtual` row virtualization (smooth
  10k-item boards per spec). Groups render as collapsible colored bands; the **Name** primary
  column is pinned-left and always present.
- **Cell renderers**, one per kind: `TextCell, StatusCell, PeopleCell, DateCell, NumberCell,
DropdownCell`. **2a** = display-only; **2b** = inline-editable (click/Enter to edit, Esc to
  cancel, Tab to next cell).
- `AddItemRow`, `AddColumnButton`, group headers, board header.

### Optimistic updates + realtime (2b)

- **Optimistic:** mutations run through TanStack Query `onMutate` → snapshot + patch the
  cached payload → rollback on error → settle on success. Cell edits feel instant.
- **Realtime:** one Supabase Realtime channel per board on `items` + `cell_values` (+
  `groups` / `columns`); incoming changes reconcile into the Query cache, de-duped against
  our own optimistic writes to avoid echo flicker. The migration adds these tables to the
  `supabase_realtime` publication.

## 7. Testing (mandatory — `pnpm typecheck`/`lint`/`test`/`build` all green)

- **Unit:** Zod validators for every column kind's `settings` + `value` shapes; the
  position/reorder midpoint helper; cell-value encode/decode.
- **RLS integration** (extends `src/lib/supabase/rls.integration.test.ts`): a member of org A
  cannot read or write org B's boards / groups / items / columns / cells; board delete denied
  for a non-admin; cross-org `org_id` forgery on insert is rejected.
- **Component:** each cell renderer displays its value kind; 2b adds inline-edit interaction
  tests (edit / commit / cancel) and an optimistic-update test with simulated failure →
  rollback.
- **e2e (Playwright):** create board → auto-seed visible (Group 1 + Status/Owner/Date) → add
  item → (2b) edit a Status + a Date cell → reload shows persistence.

## 8. Execution

`writing-plans` produces the implementation plan; execution runs **slice 2a first**, driven
by **subagents** (one per coherent task: migration+types, validations, data-access, Table UI,
tests) each returning a concise result, to conserve main-thread context. Branch
`feat/phase-2a-boards-core` → PR → green CI → merge; then slice 2b on its own branch.

After the phase: regenerate types, run advisors, write the session note (`/wrapup`), bump the
north-star (Phase 2 → Done).
