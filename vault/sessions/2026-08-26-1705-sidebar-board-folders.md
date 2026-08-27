---
type: session
date: 2026-08-26-1705
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Sidebar board folders

## What changed

- **Shipped private, per-user folders in the sidebar's Boards section** — merged to `develop` as
  `3cbd3e06` (31 files, +3750/-83). Spec: `docs/superpowers/specs/2026-08-26-sidebar-board-folders-design.md`;
  plan: `docs/superpowers/plans/2026-08-26-sidebar-board-folders.md` (7 tasks, 4 batches).
- **Two migrations.** `20260826102555_sidebar_board_folders` (tables + RLS) and
  `20260826123843_board_folder_boards_folder_ownership` (the follow-up gate — see below). Placement
  is `board_folder_boards`, PK `(user_id, board_id)` — that key alone enforces "a board is in at
  most one folder", and keying on `user_id` is what lets a board **shared with you** be filed
  without touching the owner's sidebar.
- **New module `src/lib/boards/folders/`** — `types` / `group` (the pure fold) / `queries` /
  `queries-cached` / `actions`; nine new components in `src/components/boards/`.
- **Executed via subagent-driven development:** 7 implementer dispatches, 7 task reviews, 5 fix
  rounds, 1 whole-branch review, 1 final fix wave. Every task passed its own review before the next
  started. 6046 tests green, all four gates.
- **Announced on `/updates`** (backdated 2026-08-26): one `new` entry for folders.

## Why

The Boards list was two flat lists with no way to say "these four boards are one project". Existing
concepts don't cover it: **workspaces** are a switcher you move between, and are org-owned so a
board shared with you can't live in one; **portfolios** are a reporting rollup on their own page.
Folders are deliberately the thinnest possible third thing — nav organisation, private to one user,
no permissions of their own.

## Two findings only the whole-branch review could see

Both were invisible to every scoped task review by construction, and are worth remembering:

1. **The fold's output met the sortable's identity check.** `groupBoardsByFolder` returns a fresh
   `unfiledOwned` array each render; `BoardsNavSortable` syncs optimistic order on *prop identity*,
   whose comment asserted "identity only changes on a server re-render" — true until this branch
   passed it a derived array. Result: a persisted, deliberately-unrevalidated board reorder silently
   snapped back on the next click. Fixed with `useMemo` **plus** module-level default constants
   (the memo alone never hits when a caller omits the optional props).
2. **RLS gated the board but never the folder.** You could file your own board into *someone else's*
   folder id — inert and invisible, but a folder-existence oracle, exactly what the spec closed for
   boards and left open for folders. Measured live on DEV in a rolled-back transaction, then closed
   by the second migration.

## How to test

1. Pull `develop` and reload. (The deployment runs the **DEV** database — these are real boards.)
2. Boards section header → **new-folder icon** → name it → Create. Expect a **toast** naming the
   folder; the sidebar itself won't change, because a folder with no visible boards is hidden by design.
3. A board's `⋯` → **Move to folder** → your folder. It nests under a folder row with a count.
4. A board under **Shared with me** → its `⋯` → same folder. It nests alongside, still showing
   "Shared by …". **Check both rows share one left edge** — that alignment is class arithmetic
   nobody has seen rendered.
5. Folder chevron collapses instantly (0 round-trips); reload — still collapsed.
6. Drag an unfiled board onto the folder header; then drag a **shared** board onto it.
7. **Reorder two unfiled boards, then click a different board — the order must survive.** Check this
   first: `MeasuringStrategy.Always` changed measurement for the pre-existing reorder too, and no
   test here can distinguish the two strategies.
8. Drag over a collapsed folder that has another folder below it — it auto-expands; confirm the drop
   lands where the highlight says.
9. Folder `⋯` → Rename, then Delete — the boards inside return to the main list, unharmed.
10. Switch workspaces: a folder holding only other-workspace boards vanishes rather than showing
    empty. Sign in as another user: none of your folders appear.

## Open threads

- **Nothing has been run in a browser.** Every visual and pointer claim is read from code. Steps 4,
  6, 7, 8 above are the ones that matter.
- **Four new RLS integration assertions are unexecuted** — `isSafeTestTarget()` deny-lists the DEV
  and PROD refs, so that suite skips everywhere. The policies were verified directly against DEV
  (rolled-back probes, twice, including a live `pg_policy` read). Running them for real needs a
  throwaway Supabase project.
- **The reorder-memo invariant is undefended at the caller boundary.** A future edit in
  `sidebar-nav.tsx` that reallocates `boards` (e.g. `boards.filter(...)`) reopens finding 1 with a
  green suite. The durable fix is content-based sync in `BoardsNavSortable`.
- **Eight minors knowingly carried:** no `board_id` index on `board_folder_boards`; dead
  `listBoardFolders()`; `renameFolder`/`deleteFolder` return `ok:true` on a 0-row match; no
  `KeyboardSensor` (dnd-kit's aria promises a space-bar lift that does nothing); three tab stops per
  folder header; **filed boards aren't draggable** (only unfiled ones — so folder→folder needs the
  menu); auto-expand-on-hover permanently writes persisted collapse state even on a cancelled drag;
  `collapsedSections` accrues `folder:<uuid>` keys forever.
- **"New folder…" is deliberately absent** from the move submenu (user ruling — the plan's prose and
  its code disagreed; code governed). With zero folders the submenu is a disabled dead end; the
  create-success toast is what points the way out.

## Next session entry point

Do the browser pass in step 7/8 above before building on this. If reorder feel regressed, the
suspect is `MeasuringStrategy.Always` on the shared `DndContext` in `BoardsNavSortable.tsx`.
