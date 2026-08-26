# Sidebar Board Folders — design

**Date:** 2026-08-26
**Status:** approved (brainstorming)
**Scope:** A personal, per-user folder layer in the sidebar's Boards section that can hold **both**
boards you own and boards shared with you. Nav organisation only — no new permissions, no new
sharing surface, no reporting. Does not touch workspaces, portfolios, or the boards schema.

## Problem

The sidebar's Boards section is two flat lists: owned boards (drag-reorderable) and a "Shared with
me" list appended underneath (`src/components/boards/BoardsNav.tsx`). Once a user has more than a
handful of boards the list is an undifferentiated wall of names, and there is no way to express
"these four boards are one project."

Two existing concepts look like they might already solve this and do not:

- **Workspaces** (`workspaces` table, `activeWorkspaceId`) are a _switcher_ — a scope you move
  between, one at a time. They partition the sidebar; they do not group inside it. They are also
  org-owned, so a board shared with you by another owner cannot be placed in one of yours.
- **Portfolios** (`20260621071929_portfolios.sql`, `src/lib/portfolios/`) are a reporting rollup —
  a grid of boards with health, priority, budget and progress. They live on their own page, not in
  the nav, and carry per-placement metadata that a nav folder has no use for.

So this is a genuinely new, deliberately thin layer.

## Decisions

Settled during brainstorming, in the user's words where it matters:

1. **Folders are private to the user.** They are my own sidebar organisation. Nobody else's sidebar
   changes when I create one. This is not a compromise — it is the _only_ model in which a board
   owned by someone else and shared with me can be filed under my folder without cross-tenant
   complications or a second permission system.
2. **A board is in at most one folder.** A true folder tree, not tags. Unfiled or filed, never both,
   never twice. Enforced structurally by a primary key, not by application code.
3. **Folders are user-global, not workspace-scoped.** A folder has no `workspace_id`. It renders
   whatever of its boards are visible in the current context; a folder with nothing visible is
   **hidden** for that workspace rather than shown empty. This is what lets one folder hold a shared
   board (which is not workspace-filtered) alongside your own (which are).
4. **Both a drag path and a menu path.** The menu path is built first and is the keyboard/a11y path;
   drag is the second increment and can slip without blocking the feature.
5. **They are called "Folders" in the UI**, not "Projects" — the sidebar already sits next to
   Portfolios, and "Projects" next to "Portfolios" reads as two names for one thing. Table names
   follow: `board_folders`, `board_folder_boards`. Note "group" was rejected as a label because it
   already means a row-group inside a board in this codebase.

### Why the placement cannot live on `boards`

A `boards.folder_id` column would be a property of the board, therefore shared by every user who can
see that board. Filing a board shared with me would move it in the _owner's_ sidebar too. The
placement must be keyed by `(user_id, board_id)` — which is exactly the join table below.

## Architecture

### 1. Schema

One migration, minted via `scripts/new-migration.sh sidebar_board_folders` (never a hand-stamped
version), applied to DEV via the `supabase-dev` MCP with the **same version + name**, then verified
with `pnpm db:ledger-check`. Types regenerated and committed in the same PR.

```sql
create table public.board_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 60),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index board_folders_user_position_idx
  on public.board_folders (user_id, position);

create table public.board_folder_boards (
  user_id    uuid not null references auth.users(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  folder_id  uuid not null references public.board_folders(id) on delete cascade,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, board_id)
);
create index board_folder_boards_folder_position_idx
  on public.board_folder_boards (folder_id, position);
```

`primary key (user_id, board_id)` **is** decision 2 — one folder max per user per board, unbreakable
from the application layer. The `folder_id` index covers the hot read (fetch my placements grouped
by folder) and doubles as the FK covering index the advisor wants.

`updated_at` uses the repo's existing `set_updated_at` trigger convention; check the helper's actual
name in `20260615061747_boards_core.sql` at implementation time rather than assuming.

### 2. RLS

Both tables: `enable row level security`, no permissive default, one policy per command.

- `board_folders` — all four commands: `using (user_id = auth.uid())`, and
  `with check (user_id = auth.uid())` on insert/update. A folder is yours or it does not exist.
- `board_folder_boards` — same identity gate, **plus** an insert/update `with check` that the board
  is one you can actually see:

  ```sql
  exists (
    select 1 from public.boards b
    where b.id = board_id
      and (b.created_by = auth.uid()
           or exists (select 1 from public.board_members m
                      where m.board_id = b.id and m.user_id = auth.uid()))
  )
  ```

  Without this, a user could file a board id they cannot see — harmless to read (the read path joins
  against visible boards) but an unnecessary existence oracle. Check whether `boards_core` already
  ships a board-visibility helper function and reuse it rather than re-inlining this `exists`;
  grep before writing.

**Revoked shares:** if a board is later unshared, the placement row survives (nothing cascades — the
`board_members` row is what disappeared, not the board). This is deliberate and safe: the read path
only ever renders placements whose board appears in the boards the user can see, so a stale
placement is invisible. If the share is restored, the board reappears in its old folder — which is
the friendly behaviour. No cleanup job.

### 3. Reads

New file `src/lib/boards/folders/queries-cached.ts`:

```ts
listBoardFoldersCached(userId): Promise<BoardFolderData>
```

- `"use cache"` + `cacheLife("nav")` + `cacheTag(boardFoldersTag(userId))`.
- New tag `boardFoldersTag(userId)`, returning `board-folders:user:<userId>`, added to
  `src/lib/cache/tags.ts` — never inline the literal (that file's own comment is the rule).
- Service client (`createServiceClient`) with an **explicit `user_id = userId` filter** as the tenant
  boundary, matching `listMyBoardsCached` exactly. The service client bypasses RLS, so the filter is
  load-bearing, not decorative.
- Bounded: `.limit(200)` on folders, `.limit(2000)` on placements, both over the indexed
  `user_id` / `(folder_id, position)` columns. Per-user counts are naturally small; these are the
  same defensive caps as `MY_BOARDS_LIMIT`.
- Returns `{ folders: BoardFolder[], placements: Array<{ boardId, folderId, position }> }` — raw
  data, no joining against boards. The fold happens client-side (§5).

`getSidebarNavData()` in `src/components/shell/sidebar-nav-data.tsx` adds this to the **existing**
`Promise.all` alongside `listMyBoardsCached` / `listSharedBoardsCached` / `listDashboardsCached`.
Uncached sibling `src/lib/boards/folders/queries.ts` follows the `queries.ts` / `queries-cached.ts`
split the boards module already uses, for the RLS integration test to exercise the real policies.

### 4. Performance & data-fetching budget (working agreement #5)

- **First paint:** one additional cached read, run in parallel inside the existing `Promise.all`. No
  new sequential await, no waterfall. `cacheLife("nav")` matches its siblings.
- **Expanding/collapsing a folder:** **0 server round-trips.** Pure client state persisted to
  `localStorage`, the same mechanism `NavSection` already uses (`storageKey`). Not a `<Link>`, not a
  router navigation — per gotcha-09, a nav navigation would re-run every query in the page.
- **Moving a board / creating / renaming / deleting a folder:** changes server data → Server Action
  - targeted `updateTag(boardFoldersTag(userId))`. The board list tags (`boardsTag`,
    `sharedBoardsTag`) are **not** invalidated, because no board row changed.
- **Bounded hot path:** both reads are `.limit()`-capped over indexed columns. No unbounded
  `select *`.

### 5. Grouping is a pure function

`src/lib/boards/folders/group.ts`:

```ts
groupBoardsByFolder({ folders, placements, boards, sharedBoards }): {
  folders: Array<{ folder: BoardFolder; boards: NavBoard[] }>;  // only non-empty ones
  unfiledOwned: BoardListEntry[];
  unfiledShared: SharedBoardEntry[];
}
```

No I/O, no React. It is where decision 3 lives (a folder whose visible board count is 0 is dropped),
and it is the cheapest thing in the feature to test exhaustively. `NavBoard` is a discriminated
union over `{ kind: "owned" } | { kind: "shared" }` so the row renderer keeps each variant's
affordances (shared-out icon vs. viewer-eye + "shared by" tooltip) without a lossy merge.

### 6. UI

`BoardsNav` composes, top to bottom:

1. **Folders** — for each non-empty folder, a `<BoardFolderRow>`: chevron, folder icon, name, count
   badge, and a `⋯` menu (Rename, Delete). Expanded body renders its boards using the existing
   owned/shared row components.
2. **Unfiled owned boards** — today's list, unchanged, still drag-reorderable.
3. **"Shared with me"** — the existing heading, now listing only shared boards that are _not_ filed
   in a folder. The heading disappears when that list is empty, as it does today.

A shared board rendered inside a folder keeps its viewer-eye and "Shared by X" tooltip, so folder
membership never hides whose board it is.

**Collapsed icon rail: unchanged.** It stays the flat initial-letter list it is today — folders are
an expanded-sidebar affordance only. This deliberately avoids inventing a folder glyph state for the
`w-14` rail and keeps `CoarseCaption`/gotcha-47 behaviour exactly as shipped.

**New folder** is an action in the Boards `NavSection` header next to `NewBoardDialog` — a small
dialog matching `NewWorkspaceDialog`'s shape (single name field, Zod-validated, submit on Enter).

**Design system:** `pulse-ui` + `frontend-design` skills are mandatory before writing any of this
markup (working agreement #3). Folder rows reuse the existing hover/active token classes
(`bg-state-hover`, `bg-primary/80`) rather than introducing new colour.

### 7. Move interactions, in two increments

**Increment A — menu (ships first, is the accessible path).**
`BoardItemMenu` gains a "Move to folder ▸" submenu: every folder, plus "New folder…" and "Remove
from folder" (shown only when filed). Shared board rows gain a `⋯` menu for the first time,
containing only the move entries — no rename/delete/archive, since the user does not own the board.

**Increment B — drag.**
Extend the lazy `@dnd-kit` region (`BoardsNavSortable`, mounted on first pointer/focus so the chunk
stays off the shell bundle) so that folder rows are `useDroppable` targets and shared rows are
draggable. Dropping onto a collapsed folder auto-expands it. This is the largest single piece of
work in the feature; if it runs long it lands as a follow-up PR without blocking A, because A alone
is a complete, usable feature.

### 8. Server Actions

`src/lib/boards/folders/actions.ts` — all `"use server"`, all Zod-validated at the boundary, all
returning `ActionResult` / `fail` **imported from `src/lib/actions/result.ts`** (never re-declared
locally), all ending in `updateTag(boardFoldersTag(user.id))`:

| Action                                 | Behaviour                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFolder(name)`                   | Trimmed, 1–60 chars. `position` = current max + 1. Returns the new folder.                                                                                                        |
| `renameFolder(id, name)`               | Same validation. RLS scopes the update to the caller.                                                                                                                             |
| `deleteFolder(id)`                     | Placements cascade; the boards themselves are untouched and reappear as unfiled. No confirmation prompt — nothing destructive happens to boards, and it is one click to recreate. |
| `moveBoardToFolder(boardId, folderId)` | `folderId: null` unfiles. Upsert on the `(user_id, board_id)` PK — one statement, no read-modify-write race.                                                                      |

All four use the request-scoped RLS client (`createClient`), not the service client: these are
user-initiated writes and RLS is the security boundary.

## Error handling

- A failed action returns `fail(...)`; the UI surfaces the existing toast pattern and leaves the
  sidebar unchanged. No optimistic-update rollback complexity in v1 — the actions are single-row and
  fast.
- Cached reads follow the module's existing convention: `queries-cached.ts` returns `[]` on error
  (the sidebar degrades to today's flat list rather than blanking the shell), while the uncached
  `queries.ts` throws — the same fail-loud/fail-soft split `listMyBoards` vs `listMyBoardsCached`
  already draws.
- A placement pointing at a board the user can no longer see is not an error state; it is silently
  filtered by `groupBoardsByFolder`.

## Testing (working agreement #4 — written and executed)

- **`group.test.ts`** — the bulk of the value: mixed owned+shared folder; folder hidden when all its
  boards are outside the active workspace; unfiled partition correctness; a placement referencing an
  invisible board; a board appearing in exactly one folder.
- **`BoardsNav.test.tsx`** (extend existing) — folder renders with its boards; shared board inside a
  folder keeps its viewer/owner affordances; "Shared with me" heading omitted when every shared
  board is filed; collapsed rail still flat.
- **`actions.test.ts`** — Zod rejection cases (empty/61-char/whitespace name), `updateTag` called
  with `boardFoldersTag`, unfile via `null`.
- **`board-folders.rls.integration.test.ts`** — mirrors `portfolios.rls.integration.test.ts`
  (skips unless `PULSE_TEST_DB` is set): user B cannot read or write user A's folders; filing a
  board you cannot see is rejected by the `with check`; deleting a folder leaves the boards intact.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before
  `scripts/finish-task.sh`.

## Execution DAG (working agreement #6)

**Task list**

1. **Migration + RLS + regenerated types** — _Produces:_ `board_folders`, `board_folder_boards`,
   `database.types.ts`.
2. **`boardFoldersTag` + queries (cached & uncached)** — _Consumes:_ 1. _Produces:_
   `listBoardFoldersCached`, the tag.
3. **`groupBoardsByFolder` + its tests** — _Consumes:_ the `BoardFolder` / placement types from 1
   only. _Produces:_ the fold used by 5.
4. **Server Actions + tests** — _Consumes:_ 1, 2 (for the tag). _Produces:_ create/rename/delete/move.
5. **Sidebar UI: folder rows, dialog, wiring in `sidebar-nav-data`** — _Consumes:_ 2, 3, 4.
6. **Increment A: "Move to folder" menus** — _Consumes:_ 4, 5.
7. **Increment B: drag-and-drop onto folders** — _Consumes:_ 5, 6.

**Parallel batches**

- **Batch 1:** Task 1 alone (everything else consumes the types).
- **Batch 2:** Tasks 2, 3, 4 concurrently — three agents, no shared files (`queries-cached.ts`,
  `group.ts`, `actions.ts` are disjoint; only `tags.ts` is touched twice, so **Task 2 owns
  `tags.ts`** and Task 4 imports it).
- **Batch 3:** Task 5.
- **Batch 4:** Task 6, then Task 7.

**Critical path:** 1 → 2 → 5 → 6 → 7 (five links). Batch 2's parallelism is the only real wall-clock
saving; the tail is inherently sequential because 6 and 7 both mutate the same nav components.

**Worktree note:** this is one coherent feature in one `task/` worktree
(`scripts/start-task.sh sidebar-board-folders`), with Batch 2 dispatched as parallel subagents
_inside_ it. Separate worktrees per task would only create rebase conflicts on `BoardsNav.tsx`.
Regenerate types via the `supabase-dev` MCP, not `pnpm db:types` (which throws
`LegacyProjectNotLinkedError` inside a worktree).

## Out of scope

- Nested folders (a folder inside a folder).
- Sharing a folder, or any org-visible folder. Decision 1 stands; the schema does not preclude
  adding a visibility column later, but nothing in v1 anticipates it (YAGNI).
- Folders for dashboards, portfolios, or any nav section other than Boards.
- Reordering folders themselves (they append in creation order). Board order _within_ a folder is
  stored (`position`) but only becomes user-controllable with Increment B.
- Filing archived boards, or any change to archive behaviour.
- The collapsed icon rail gaining folder awareness.
