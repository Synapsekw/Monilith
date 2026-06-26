# Item creation metadata — "Created by" & "Created at" (immutable)

**Date:** 2026-06-25
**Slug:** `item-creation-metadata`
**Status:** Design — awaiting plan

## Problem

When anyone creates an item or a subitem we need a permanent record of **who** created it and
**when** (date + time). These are audit fields: they must be populated automatically and must be
impossible to change afterwards — by anyone, through any path. They should appear as two
read-only columns fixed at the end of the board table.

## Decisions (from brainstorming)

| Question                     | Decision                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Pin behaviour                | **Scroll normally at the end** — permanent, non-removable, but not frozen to the viewport.     |
| Existing items (pre-feature) | **Backfill** `created_by` to the item's **organization creator** (`organizations.created_by`). |
| Surfaces beyond the table    | **Board table + item detail panel** (covers items and subitems in both).                       |
| "Created at" granularity     | **Date + time**, absolute & localized (e.g. `Jun 25, 2026, 3:42 PM`). User asked for both.     |
| "Created by" display         | **Avatar + name**, matching the People-cell house style.                                       |

## Architecture overview

The leading **Name column is already a virtual column** — hardcoded in `BoardTable`, read
straight off `item.name`, never a row in the `columns` table. We follow that exact precedent:
**two virtual trailing columns** read straight off item-row fields (`item.created_by`,
`item.created_at`). This deliberately avoids:

- seeding two `columns` rows per board (and migrating every existing board),
- the `cell_values` EAV plumbing and its mutable update path,
- any new column-kind enum value.

The data lives **on the item row**. Immutability is enforced **in the database** (triggers), so
it holds regardless of which client or code path writes — RLS/UI are not the only guard.

### Unit boundaries

1. **DB layer** (`supabase/migrations/`) — schema column, backfill, attribution + immutability
   triggers, `create_item` RPC tweak. Source of truth for correctness.
2. **Read-only cell renderers** (`src/components/boards/cells/`) — `CreatedByCell`,
   `CreatedAtCell`, and a `formatDateTime` helper. Pure, presentational, unit-testable; take
   simple props (a resolved member/profile + an ISO string), no DB types.
3. **Table integration** (`src/components/boards/BoardTable.tsx`) — extend the grid template and
   render the two headers + cells across every row type (group header, item row, subitem rows,
   add-row).
4. **Item panel** (`src/components/boards/item-panel/`) — a small read-only "Created" metadata
   section reusing the renderers from (2).

## Data model

### Migration (new file under `supabase/migrations/`)

```sql
-- 1. Column: who created the row. Mirrors organizations.created_by convention
--    (uuid, references auth.users, NOT NULL — no nulls after backfill).
alter table public.items
  add column created_by uuid references auth.users (id);

-- 2. Backfill existing rows to their org's creator (the only sanctioned default user).
update public.items i
  set created_by = o.created_by
  from public.organizations o
  where o.id = i.org_id
    and i.created_by is null;

-- 3. Lock the column down now that every row has a value.
alter table public.items
  alter column created_by set not null;

-- 4. Attribution on INSERT: force creator + timestamp from the authenticated caller,
--    ignoring any client-supplied value (anti-spoofing). Service/migration contexts
--    (auth.uid() null) keep the provided/default value so tooling still works.
create function public.items_set_creation_metadata()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger items_set_creation_metadata
  before insert on public.items
  for each row execute function public.items_set_creation_metadata();

-- 5. Immutability on UPDATE: created_by/created_at can never change (any caller).
create function public.items_protect_creation_metadata()
returns trigger language plpgsql as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger items_protect_creation_metadata
  before update on public.items
  for each row execute function public.items_protect_creation_metadata();
```

Trigger order matters: **backfill runs before the immutability trigger exists**, so the
one-time `update` is not blocked by the lock it later installs.

The `create_item` RPC (`boards_core.sql`) already has `v_uid := auth.uid()`. We set
`created_by => v_uid` explicitly in its insert for clarity/defence; the trigger guarantees it
regardless, and `addSubitem`'s direct insert needs **no change** (the trigger fills it in).

### Types

After the migration is applied, regenerate `src/types/database.types.ts` (`pnpm db:types`) — do
**not** hand-edit. `items.Row` gains `created_by: string`. The board payload query already does
`items.select("*")`, so `created_by` flows to first paint with **no query change**.

> **Apply constraint (known trap):** the agent cannot push migrations / run DDL against the
> cloud DB (classifier denies — see memory `migration-apply-blocked-by-classifier`). The build
> will write the migration file, then the **user applies the SQL** in Supabase, then the agent
> verifies + regenerates types. This is the one unavoidable manual handoff in the otherwise
> autonomous build, and it gates the TypeScript that references `created_by`.

## UI

Both columns are **read-only**: no cell editor, no click-to-edit, and a static header with no
rename/delete/drag affordance (unlike `ColumnHeader`). They render after the last user column,
before the `+` add-column slot, and scroll with the body (not frozen).

- **Created by** — `CreatedByCell`: avatar chip (reusing the existing initials/`avatar_url`
  pattern) + full name, resolved from the already-loaded members directory. Header icon: lucide
  `User`, label "Created by". Empty/unresolved creator (e.g. a user who left the org) → muted
  initials/"Unknown", never a crash.
- **Created at** — `CreatedAtCell`: `formatDateTime(item.created_at)` → `Jun 25, 2026, 3:42 PM`,
  `text-sm`. Header icon: lucide `Clock`, label "Created at".

Styling per `pulse-ui`: monochrome chrome, semantic tokens only, `text-sm`,
`text-muted-foreground` for empty, `size-3.5` icons in dense rows. No new color.

Grid template extends from `${nameWidth}px ${tracks} ${ADD_COL_WIDTH}px` to
`${nameWidth}px ${tracks} ${CREATED_BY_WIDTH}px ${CREATED_AT_WIDTH}px ${ADD_COL_WIDTH}px`
(fixed widths; no resize handle — they're fixed columns). Every row-rendering path that emits
the add-col spacer cell gains the two trailing cells: group header row, item row, **subitem
rows**, and the add-item row.

**Item panel:** a read-only "Created" section near the bottom — two label/value rows ("Created
by" → avatar+name, "Created at" → formatted datetime) reusing the same renderers. Shown for
both items and subitems opened in the panel.

## Performance & data-fetching budget

- **First paint:** `created_by` is included via the existing `items.select("*")` — **zero new
  queries**. Creator profiles resolve from the members directory already passed to the table; a
  creator missing from that list degrades to "Unknown" rather than triggering a fetch (no N+1).
- **Per interaction:** the columns are **read-only display** — there is no toggle, sort, filter,
  or edit on them, so **0 server round-trips** and **0 Server Actions**. (Immutability means
  there is deliberately no mutation path at all.)
- **Server data vs client:** no in-page state for these columns; nothing to push to History API.
- **Bounded/indexed:** no new unbounded read; we reuse the existing board payload (already the
  app's bounded read pattern). No sort/filter on the new columns ⇒ no new index needed (YAGNI;
  add a `created_by` index only if/when we add sorting later).

## Testing (TDD — written and executed)

- **DB (integration test, `*.integration.test.ts`):**
  - inserting an item as user A sets `created_by = A` and `created_at ≈ now()`, even if the
    client passes a different `created_by` (anti-spoof);
  - subitem insert (direct-insert path) is also attributed to the caller;
  - updating an item's name does **not** change `created_by`/`created_at`; an explicit attempt
    to change them is silently preserved (immutability).
- **Cells (unit, jsdom):** `CreatedByCell` renders avatar+name for a known member, "Unknown"
  for an unresolved id, empty-safe for missing; `formatDateTime`/`CreatedAtCell` formats a known
  ISO string deterministically (fixed timezone/locale in the test).
- **Table (component):** the two trailing headers render after the last column and before `+`;
  an item row and a **subitem row** each render a created-by and created-at cell; the cells
  expose no edit affordance.
- **Panel (component):** the Created section renders both values read-only.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

## Execution DAG

**Interfaces**

- T1 (DB) **produces:** `items.created_by` column + regenerated `database.types.ts`; immutability
  guarantees. **consumes:** nothing.
- T2 (cells) **produces:** `CreatedByCell`, `CreatedAtCell`, `formatDateTime`. **consumes:**
  member/profile prop shape only (independent of T1's regen).
- T3 (table) **consumes:** T1 types (`item.created_by`) + T2 cells. **produces:** rendered
  trailing columns in `BoardTable` (items + subitems).
- T4 (panel) **consumes:** T1 types + T2 cells. **produces:** Created section in item panel.

**Graph / batches**

- **Batch A (parallel):** T1, T2 — disjoint footprints (SQL/types vs pure components).
  - _within A:_ T1 includes the manual apply + type regen handoff.
- **Batch B (parallel, after A):** T3, T4 — both depend on T1 (types) and T2 (cells); disjoint
  files (`BoardTable.tsx` vs `item-panel/`), so they run concurrently in isolated edits.

**Critical path:** T1 (incl. apply + regen) → T3. T1 is the floor; T2 overlaps it; T4 overlaps
T3.

## Out of scope (YAGNI)

- Sorting/filtering by created-by or created-at (no index added now).
- Showing creation metadata on Kanban/Calendar cards (table + panel only).
- Per-user column hide/show, resizing, or reordering of the two columns (they're fixed).
- An "updated by / updated at" pair (only creation is requested).

## Risks

- **Migration apply handoff** (above) — the one manual step; everything downstream of types is
  blocked until it lands. Mitigation: do T1 first; the build pauses only for the apply, then
  resumes autonomously.
- **Backfill target** — items whose org creator later left the org show that historical user;
  acceptable (it's the chosen default and is honest about being a backfill).
- **Subitem render paths** — `BoardTable` has multiple row emitters; the integration task must
  cover every one (a missed path = a row with misaligned columns). Tests assert subitem
  coverage.
