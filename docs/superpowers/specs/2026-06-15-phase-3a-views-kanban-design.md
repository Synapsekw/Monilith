---
type: spec
status: approved
phase: 3a
date: 2026-06-15
tags: [spec, phase-3, views, kanban]
related:
  - "[[2026-06-14-pulse-design]]"
  - "[[2026-06-15-phase-2b-boards-interactive-design]]"
  - "[[2026-06-15-gotcha-05-board-cache-coherence]]"
---

# Phase 3a — View Infrastructure + Kanban

## 1. Goal & scope

Introduce the **multi-view** model for boards and ship the first alternate view, **Kanban**.
This is the first slice of Phase 3 (Views). It establishes the view-switcher infrastructure
and saved per-view config that Calendar and Timeline/Gantt (Phase 3b) will reuse.

**In scope**

- `board_views` table + RLS + `create_board_view` RPC; `create_board` seeds a default Table view.
- View switcher (tab strip) in the board header; `?view=<viewId>` routing with Table-view fallback.
- Server Actions: `createBoardView`, `updateBoardView`, `deleteBoardView`.
- Kanban view: group by a Status column, "No status" column, drag-to-restatus, per-column add,
  grouping-column picker — all on the existing `["board", boardId]` cache + realtime.

**Explicitly out of scope (deferred)**

- Calendar, Timeline/Gantt, item dependencies → **Phase 3b**.
- Manual reorder of cards _within_ a Kanban column (cards follow `item.position`).
- Live multi-user sync of the _view list_ (view CRUD refetches via navigation; cards are realtime).
- Dropdown as a grouping field (works for free once in-app Dropdown columns exist).
- Swimlanes, WIP limits, column collapse, card inline-edit (full edit stays in Table; the item
  detail panel is Phase 4).

## 2. Reused foundation (Phase 2)

- `getBoardPayload(boardId)` → `{ board, groups, columns, items, cellValues }` (parallel RLS reads).
- Client board cache keyed `["board", boardId]` with pure patch helpers (`src/lib/boards/cache.ts`),
  `staleTime: Infinity`.
- `useBoardMutations` (`setCell`/`clearCell`/`addItem`/`renameItem`) — optimistic writes.
- One Supabase realtime channel reconciling into the same cache (echo-deduped).
- Status column shape: `settings.options = [{ id, label, color }]` (seeded by `create_board`).
- RLS conventions: denormalized `org_id`, `is_org_member(org_id)` read, `+ board_in_org(board_id,
org_id)` on writes, `has_org_role(...)` for privileged ops, `set_updated_at` trigger, parent-org
  helper fns (`board_in_org`, etc.), SECURITY-DEFINER RPCs with `set search_path = ''`.

## 3. Data model — `board_views`

New migration `supabase/migrations/<ts>_board_views.sql`:

```sql
create type public.view_kind as enum ('table', 'kanban'); -- calendar/timeline added in 3b

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

create policy "board_views: read if member"   on public.board_views for select
  using (public.is_org_member(org_id));
create policy "board_views: insert if member" on public.board_views for insert
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "board_views: update if member" on public.board_views for update
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "board_views: delete if member" on public.board_views for delete
  using (public.is_org_member(org_id));
```

**`config` shape by kind**

- `table`: `{}` (column order/width/sort deferred to a later slice).
- `kanban`: `{ "group_column_id": "<uuid>" }`. Missing/null/stale → resolve to the board's first
  Status column at render time (never hard-fail).

**Seeding & backfill**

- Update `create_board` RPC: after seeding columns, insert a default view
  `(org_id, board_id, 'table', 'Main Table', '{}', 0)`.
- Backfill in the same migration: insert a `'table'` / `'Main Table'` / position 0 view for every
  existing board that has no view yet (idempotent `insert ... select ... where not exists`).

**`create_board_view` RPC** (mirrors `create_item`):

```sql
create or replace function public.create_board_view(
  p_board_id uuid, p_kind public.view_kind, p_name text, p_config jsonb default '{}'::jsonb
) returns public.board_views
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org_id uuid; v_pos double precision; v_row public.board_views;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then raise exception 'board not found' using errcode = 'P0002'; end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501'; end if;
  select coalesce(max(position), -1) + 1 into v_pos from public.board_views where board_id = p_board_id;
  insert into public.board_views (org_id, board_id, kind, name, config, position)
  values (v_org_id, p_board_id, p_kind, p_name, coalesce(p_config, '{}'::jsonb), v_pos)
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_board_view(uuid, public.view_kind, text, jsonb) to authenticated;
```

After the migration: `pnpm db:types` → commit `src/types/database.types.ts` in the same PR;
run `get_advisors` (or document the manual gate) — no new warnings.

## 4. Queries + types

- Add `BoardView = Tables<"board_views">` to `src/lib/boards/queries.ts`.
- `getBoardPayload` gains a 6th parallel read: `views` ordered by `position asc`. `BoardPayload`
  gains `views: BoardView[]`.
- Helper `resolveSelectedView(views, requestedId)`: returns the view whose `id === requestedId`,
  else the first `table` view, else `views[0]`. Pure, unit-tested.
- Helper `resolveKanbanGroupColumn(columns, config)`: returns the column matching
  `config.group_column_id` if it exists and is a Status column, else the first Status column, else
  `null`. Pure, unit-tested.

## 5. Routing + view switcher

- `/boards/[boardId]` page reads `searchParams.view`. `BoardPage` resolves the selected view via
  `resolveSelectedView` and renders the matching component (`BoardTable` for `table`, `KanbanBoard`
  for `kanban`). `searchParams` is a Promise in Next 16 — `await` it (confirm against
  `node_modules/next/dist/docs/`).
- **`ViewSwitcher`** (client) in the board header: a tab per view (kind icon + name), active tab =
  selected. Tabs are links to `?view=<id>` (shallow nav). "+ Add view" → `createBoardView(boardId,
'kanban')` then navigate to the new view. Per-tab "⋯" menu: **Rename** (inline) → `updateBoardView`;
  **Delete** → `deleteBoardView` (disabled/hidden when `views.length === 1`).
- Uses the shadcn primitives per `pulse-ui` (the new `popover.tsx` primitive may host the ⋯ menu /
  grouping picker). Tabs styled monochromatic + single accent for the active tab.

## 6. Kanban view component

`src/components/boards/KanbanBoard.tsx` (client), fed by `useBoardCache(boardId)` + realtime —
no new fetch path.

- **Grouping** (pure fn `buildKanbanColumns(payload, groupColumnId)` in `src/lib/boards/kanban.ts`):
  resolves the group column; produces an ordered list of columns — one per Status option (label +
  color from `settings.options`) preceded by a **"No status"** column. Each column's cards = items
  whose Status cell `value` matches that option id (No-status = items with no cell or unmatched
  value), ordered by `item.position`.
- **Card** (`KanbanCard`): item name + compact read-only People (avatars) and Date summaries,
  reusing existing cell display renderers from `src/components/boards/cells/`. Draggable.
- **Drag** (dnd-kit, already a candidate dep — add if absent): dropping a card on another column
  calls `setCell(itemId, groupColumnId, { ...statusValue for target option })` from
  `useBoardMutations` (optimistic + realtime). Dropping on its own column is a no-op.
- **Per-column "+ Add"**: `addItem` into the board's first group, then `setCell` to that column's
  status option. No-status column's add just creates the item (no status set).
- **Grouping-column picker** (Kanban header): lists the board's Status columns; selecting one calls
  `updateBoardView(viewId, { config: { group_column_id } })` then refreshes (navigation/refetch).
- **Empty/edge states**: board with no Status column → Kanban renders an empty-state prompting to
  add a Status column (column creation is out of scope, so this is informational). Single "No
  status" column when all items are unset.

## 7. Server Actions

`src/lib/boards/view-actions.ts` (mirrors `actions.ts` shape: `"use server"`, Zod-validated input,
parent-org guard, returns typed result):

- `createBoardView(boardId, kind, name?)` → calls `create_board_view` RPC; default name by kind
  (`'Kanban'`). Returns the new view.
- `updateBoardView(viewId, { name?, config? })` → RLS-scoped update; org/board derived server-side;
  validates `config` against a per-kind Zod schema.
- `deleteBoardView(viewId)` → refuses when it is the board's last view (count check) — returns a
  typed error; otherwise RLS-scoped delete.

## 8. State / cache coherence

- **Selected view is URL-driven** (`?view=`), no Zustand. Refresh-safe and shareable.
- The **view list** comes from the RSC payload. View CRUD (add/rename/delete) navigates or calls
  `router.refresh()` → the RSC re-runs and refetches the list. This **sidesteps the
  staleTime-Infinity board cache** ([[2026-06-15-gotcha-05-board-cache-coherence]]): views are not
  in the TanStack cache, so no stale-read hazard.
- **Cards** remain live via the existing realtime channel (drag-restatus echoes to other users).
- Live multi-user sync of the _view list itself_ is deferred (a teammate adding a Kanban view shows
  up on next navigation/refresh, not instantly).

## 9. Testing

- **RLS integration** (`boards.rls.integration.test.ts` or a sibling): `board_views` read/write is
  org-scoped; cross-org read & write denied; `create_board` seeds exactly one `table` view;
  `create_board_view` enforces membership and increments position.
- **Unit**: `resolveSelectedView` (requested / table-fallback / first-fallback);
  `resolveKanbanGroupColumn` (match / status-fallback / null); `buildKanbanColumns` (No-status
  bucketing, option ordering, card membership + position order).
- **Component**: `KanbanBoard` renders a column per option + No-status, card content; drag → asserts
  `setCell` called with `(itemId, groupColumnId, targetOptionValue)` (mocked mutation); per-column
  add → `addItem` + `setCell`. `ViewSwitcher` renders tabs, add/rename/delete; delete
  disabled/hidden at `views.length === 1`.
- **e2e**: existing 4 stay green; add a Kanban happy path — switch to a Kanban view, drag a card to
  another column, assert the status persists (reload).
- Gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green; advisors clean.

## 10. Build order (for the plan)

1. Migration (`board_views` + enum + RLS + trigger + `create_board` seed/backfill +
   `create_board_view`), `db:types`, advisors. Tests: RLS integration.
2. Queries/types: `BoardView`, `getBoardPayload.views`, `resolveSelectedView`,
   `resolveKanbanGroupColumn`. Tests: unit.
3. View actions (`create`/`update`/`delete`). Tests: action-level (mirroring existing action tests).
4. `ViewSwitcher` + `?view=` routing in `BoardPage` (Table still renders). Tests: component.
5. `buildKanbanColumns` + `KanbanBoard` + `KanbanCard` + grouping picker + per-column add. Tests:
   unit + component.
6. e2e Kanban happy path; full gate; wrapup.
