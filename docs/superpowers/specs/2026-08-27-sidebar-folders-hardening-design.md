# Sidebar Board Folders — Hardening (the nine carried minors)

**Status:** spec written, awaiting review
**Date:** 2026-08-27
**Predecessor:** `docs/superpowers/specs/2026-08-26-sidebar-board-folders-design.md` (shipped as PR #101, `3cbd3e06`)
**Session note listing the debt:** `vault/sessions/2026-08-26-1705-sidebar-board-folders.md`

## Problem

Sidebar board folders shipped with nine knowingly-carried minors. They are not a backlog wish-list —
each was written down at merge time because it was understood and deliberately deferred. Three of
them are correctness or accessibility defects that a green test suite cannot see:

- `renameFolder` / `deleteFolder` **report success when they changed nothing** (item 3).
- Every drag handle in the sidebar **announces a keyboard lift that does not exist** (item 4).
- The optimistic-reorder guard is **identity-based**, so a one-word upstream edit
  (`boards.filter(...)`) silently reintroduces a shipped-and-fixed bug **with the suite still
  green** (item 9).

The rest are a missing index, dead code, a persisted write on a cancelled gesture, unbounded
localStorage growth, a redundant tab stop, and a drag affordance that only half the rows have.

This slice pays all nine down. It adds **no new user-facing feature**; the one visible behaviour
change is that boards already inside a folder become draggable.

## Non-goals

- **Within-folder reorder by drag.** A folder's boards sort by placement `position`, but no drag
  gesture persists that order today and this slice does not add one. Filed rows are drag _sources_.
- **Keyboard drag on the other eight drag surfaces** (Kanban, Gantt, Calendar, BoardTable,
  GroupHeaderRow, SubitemBlock, ColumnOptionsDialog). See D-4 and Q3.
- **Coarse-pointer sizing on the folder header.** The header row is 24px; pulse-ui asks for 44px
  targets on coarse pointers. Real, but it is a layout change that re-opens the alignment tests
  (`BoardsNav.test.tsx` → "folder row alignment") and belongs with a broader sidebar touch pass.
- **`NavSection`'s identical two-tab-stop header.** Item 8's fix applies there too; changing it
  moves every sidebar section and every `nav-section.test.tsx` query. Out of scope, noted for later.
- **Running the four folder RLS integration assertions.** Still blocked on a throwaway Supabase
  project (decision-25). Unchanged by this slice.

---

## Findings that changed the design

Three things were verified against the tree and the live DEV database while scoping, and each one
moves a design decision away from what the debt list implies.

### F1 — the missing index matters for the FK cascade, not for the unfile path

The debt list justifies the `board_id` index by "`moveBoardToFolder`'s unfile path filters on
`board_id` alone". That is true of the application code but not of the executed SQL: the unfile
delete runs through the **request-scoped RLS client**, so Postgres also sees
`user_id = (select auth.uid())` and the composite PK's leading column is supplied. Measured on DEV
(read-only `EXPLAIN`, no `ANALYZE`, nothing written):

```
-- with the RLS predicate present (the real app path today):
Delete on board_folder_boards
  ->  Index Scan using board_folder_boards_pkey
        Index Cond: ((user_id = $1) AND (board_id = $2))     -- clean seek, already fine

-- board_id alone (the shape of the `boards ON DELETE CASCADE` referential-integrity check):
Delete on board_folder_boards
  ->  Bitmap Heap Scan on board_folder_boards
        ->  Bitmap Index Scan on board_folder_boards_pkey
              Index Cond: (board_id = $1)                    -- FULL scan of the PK index
```

The second plan is the one that runs **every time any board anywhere is deleted**, and it scans the
whole placement index for every user, not just the deleter's. It is also what the Supabase
`unindexed_foreign_keys` advisor flags. `board_id` is the only uncovered FK on either new table
(`folder_id` is covered by `board_folder_boards_folder_position_idx`; both `user_id` columns are
covered by the PK / `board_folders_user_position_idx`).

**Consequence:** the index still ships, with the honest rationale. The acceptance evidence is the
re-run `EXPLAIN` showing `Index Scan using board_folder_boards_board_id_idx`, not a claim about the
unfile path.

### F2 — `sortableKeyboardCoordinates` reaches folder headers, but bails on a non-droppable source

Read from the installed `@dnd-kit/sortable@10.0.0` (`sortable.cjs.development.js:664-760`), because
this decides whether item 4 is a two-line change or a broken promise:

- It iterates **`droppableContainers.getEnabled()`** — every droppable in the `DndContext`, not just
  the `SortableContext` items. So the `folder:<id>` drop targets **are** arrow-key reachable. Paired
  with the `MeasuringStrategy.Always` already set on this context, their rects stay fresh while a
  collapsed folder expands under the cursor.
- `restrictToVerticalAxis` constrains the drag _transform_'s x-axis. It does not filter the getter's
  Up/Down candidate set. Compatible.
- **It returns `undefined` unless `droppableContainers.get(active.id)` resolves.** `useSortable`
  registers a draggable _and_ a droppable under the same id, so owned unfiled rows are fine.
  `DraggableSharedRow` calls `useDraggable` only — so a shared board would pick up on Space and then
  refuse to move on every arrow press. That is a worse lie than the current one.

**Consequence:** any row that is a drag source but not a `useSortable` item must also register
`useDroppable({ id: board.id })` on the same node — which is precisely what `useSortable` does
internally. This is safe: a drop landing on such an id is already an explicit no-op
(`folderIdFromDropTarget` returns `null`, then `reorderPosition` returns `null` because the id is
not in `ordered` — `src/lib/boards/group-reorder.ts:15`).

### F3 — item 6's stated remedy (`onDragCancel`) is not needed, and a better fix exists

`BoardFolderRow`'s `useEffect` writes the **persisted** collapse map on hover. The debt list frames
the fix as "add `onDragCancel`". But an `onDragCancel` handler can only undo what was written — it
still writes localStorage on every hover, still fights a concurrent toggle, and still has a hole
(unmount mid-drag). Making hover expansion **purely visual** removes the write entirely, so there is
nothing to undo and no cancel handler is required.

---

## Design decisions

### D-1 — `board_id` index (the one migration)

One migration, minted with `scripts/new-migration.sh board_folder_boards_board_id_idx` (**not minted
in this slice — the plan mints it**), containing exactly:

```sql
create index board_folder_boards_board_id_idx
  on public.board_folder_boards (board_id);
```

Not a partial index, not composite. The consumer is the FK cascade check, which filters on
`board_id` alone. Applied to DEV via the `supabase-dev` MCP **with the same version + name as the
committed file**, then verified with `pnpm db:ledger-check`. An index changes no generated types, so
`database.types.ts` is untouched (state it in the PR rather than committing a no-op regen).

### D-2 — delete `src/lib/boards/folders/queries.ts` outright

Zero importers repo-wide (`listBoardFolders` appears only in its own definition; the RLS integration
suite does not import it). The whole 47-line file goes. `queries-cached.ts` is the live read and is
untouched.

**No test is added for this**, deliberately. Typecheck, lint and build are the guard; a test
asserting "this module does not exist" is a test that cannot fail in any way that matters
(gotcha-89). The evidence is the grep plus green gates.

### D-3 — a 0-row match is a failure for rename/delete, and a success for unfile

`renameFolder` and `deleteFolder` adopt the codebase's existing not-found pattern —
`src/lib/org/admin-actions.ts:188-193`, `.update(...)/.delete().eq(...).select("id").maybeSingle()`
then `if (error || !data) return fail(...)`. RETURNING costs no extra round-trip and both tables have
a SELECT policy, so RLS permits it.

```
error         -> fail(error.message)      (unchanged)
no row        -> fail("That folder no longer exists.")   (new)
one row       -> updateTag, ok            (unchanged)
```

`updateTag` moves **after** the not-found check: nothing changed, so nothing is invalidated.

**`moveBoardToFolder`'s unfile path keeps returning `ok: true` on 0 rows.** Unfiling a board that has
no placement is a legitimate no-op — a double-click, or a stale menu — and failing it would surface a
spurious error toast for a state the user already has. The asymmetry is deliberate and is locked by a
test so a future "consistency" refactor has to argue with it.

Copy: "That folder no longer exists." — states what happened, in the interface's voice, no apology.

### D-4 — `KeyboardSensor`: shared module, **opt-in per surface**. _(the ruling)_

`src/lib/dnd/sensors.ts` grows one optional argument:

```ts
export function useTouchAwareSensors(options?: {
  keyboardCoordinateGetter?: KeyboardCoordinateGetter;
});
```

With no argument the returned sensor list is **byte-identical to today's** — PointerSensor +
TouchSensor, nothing else. `BoardsNavSortable` is the only caller that passes
`sortableKeyboardCoordinates`.

**Why not enable it globally.** `useTouchAwareSensors` is shared by eight other drag surfaces whose
geometries genuinely differ: Kanban is cross-container, Gantt bars move horizontally, Calendar drops
onto date cells, BoardTable does rows _and_ columns, ColumnOptionsDialog is a modal list.
`sortableKeyboardCoordinates` is the correct getter for some of them and wrong for others. Turning it
on everywhere in a debt-paydown slice would trade one accessibility lie ("Space picks it up" →
nothing happens) for a subtler one ("Space picks it up" → arrows move it somewhere unannounced or
wrong), across eight surfaces, none of which gets a manual acceptance pass in this slice. It also
re-opens five test files for no verified benefit.

**Why not a local sensor in `BoardsNavSortable`.** It duplicates sensor construction that the file's
own comment says lives in exactly one place, and the next surface that wants keyboard drag copies the
duplicate.

**Why the options argument preserves that invariant.** The "one place" the comment protects is the
_activation constraints_ — the 6px pointer distance and the 200ms touch lift. Those stay in one
place, and so does the `KeyboardSensor`'s construction. The only thing passed in is the **coordinate
strategy**, which is exactly the part that legitimately differs per surface and therefore cannot live
in one place. The module still owns how sensors are built; the caller declares which geometry it has.

**What this leaves open**, stated plainly rather than quietly: eight surfaces continue to spread
dnd-kit `attributes` onto their handles with no keyboard path. That is tracked as Q3 and, whichever
way it is answered, gets an ADR — it is the kind of thing that reads as fixed and is not.

### D-5 — filed boards become drag sources; `FolderSection` gets a `renderRow`

`FolderSection` changes from a pre-rendered `children: ReactNode` to data plus a render callback,
the shape `SharedBoardsSection` already uses:

```ts
export type FolderSection = {
  folder: BoardFolder;
  entries: NavBoard[]; // count derives from entries.length
};
// BoardsNav owns the plain renderer; BoardsNavSortable supplies a drag-enabled one.
```

`NavBoard` is the existing discriminated union from `src/lib/boards/folders/group.ts` — no new type.

Filed rows use `useDraggable` + the paired `useDroppable` from F2, not `useSortable`: there is no
within-folder reorder to persist (see Non-goals). They carry `data: { folderId }` so `handleDragEnd`
can reject a drop onto the folder the board is already in — today's only guard is
`active.id === over.id`, which does not catch it, and without the guard a same-folder drop fires a
pointless server write plus a full `router.refresh()`.

Grip copy: `Move ${board.name} to another folder`. It says exactly what the control does — a filed
row cannot reorder, and reusing the unfiled row's "Reorder …" label would be the third lie in this
document.

Alignment is already protected: `PlainBoardRow` reserves an inert `size-6` grip slot, so swapping in a
real handle shifts nothing. The three "folder row alignment" tests must stay green untouched — if one
goes red, the markup change is wrong, not the test.

**Filed → unfiled by drag is deferred to Q1.** In scope: folder→folder by drag, plus the existing
⋯ → "Remove from folder". If Q1 is answered "no", a filed row dropped anywhere that is not a folder
header must simply snap back — no toast, no write — which is what the guards above already produce.

### D-6 — hover auto-expand becomes purely visual (F3)

`BoardFolderRow` computes `const open = !collapsedSections[key] || isOver;` and **deletes the
`useEffect` entirely**. Hovering a collapsed folder mid-drag opens it visually; the persisted map is
never touched; a cancelled drag needs no undo and no `onDragCancel`.

A **successful drop** into a collapsed folder does persist it open, because otherwise the board the
user just filed disappears behind a chevron. That write happens once, in `BoardsNavSortable`'s
`fileIntoFolder` success path, through a new idempotent `setSection(key, collapsed)` — not through
`toggleSection`, which would _close_ an already-open folder.

Net effect on the persisted store: strictly fewer writes than today (one per successful drop, versus
one per hover).

### D-7 — bound `collapsedSections` at both ends

Two changes, because either alone leaves the map growing:

1. **`toggleSection` deletes the key when re-opening** instead of writing `false`. Absent already
   means open — `nav-section.tsx:33` and `BoardFolderRow.tsx:37` both read `!map[key]`, and nothing
   in the tree distinguishes `false` from absent (verified by grep; those two are the only readers).
   This is what stops a normal collapse/expand cycle from leaving residue.
2. **`pruneSections(prefix, keep)`** drops `folder:`-prefixed keys whose id is not in `keep`, so a
   _deleted_ folder's key does not outlive it. Called from `BoardsNav` in an effect keyed on the
   folder-id signature.

Two traps this must not fall into, both stated as required behaviour:

- **Prune against the raw `folders` prop, never `grouped.folders`.** The fold _drops_ folders with no
  board visible in the current workspace. Pruning against the rendered tree would delete the collapse
  state of folders that exist, merely because you switched workspace.
- **Skip the prune when the `folders` prop was omitted** (`folders === NO_FOLDERS`, the module-level
  sentinel). A caller that passes no folder data means "unknown", not "none" — pruning against an
  empty keep-set would wipe every folder key in the sidebar.

`pruneSections` must return the **identical object** when nothing is stale, so the effect cannot
loop.

### D-8 — one disclosure per folder header

The chevron button and the name button merge into a single `<button>` containing chevron + folder
icon + name, carrying `aria-expanded` and `aria-controls`. The count `<span aria-hidden>` and the
`BoardFolderMenu` trigger stay outside it. **Three tab stops become two** — the menu trigger is a
distinct control and correctly remains its own stop. The goal is one stop per control, not one per
header.

**D-8a — the accessible name becomes the folder name, and `aria-label` is dropped.** Today both
buttons carry `aria-label={`${open ? "Collapse" : "Expand"} ${name}`}`. With one button and
`aria-expanded`, that label is redundant with the state a screen reader already announces
("Acme Rebrand, button, collapsed"), and it is the standard disclosure pattern.

Cost, stated up front: roughly six existing queries in `BoardsNav.test.tsx` locate this control by
`/Collapse Acme Rebrand/i` or `/Expand Acme Rebrand/i` and must migrate to
`getByRole("button", { name: "Acme Rebrand", expanded: true })` — which is a _stronger_ query, since
it asserts the ARIA state rather than label prose. `focusAnchorTarget` finds this control by
`button[aria-expanded]` and is unaffected (it now resolves to exactly one node instead of two; its
stale comment about "two toggles" gets corrected).

If this is vetoed, the fallback is: keep the dynamic `aria-label` on the merged button, and the
existing queries stay as they are. Everything else in D-8 is unchanged either way.

**Also folded in:** neither button has a `focus-visible` ring today. The merged button gets
`focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none`, matching `GRIP_CLASS`.
An unreachable-looking focus state on the section's _first_ tab stop is the same class of defect as
the rest of this slice, and it is one class string.

### D-9 — content-based optimistic-reorder sync

`BoardsNavSortable`'s render-phase guard changes from identity to content:

```ts
// before:  if (syncedBoards !== boards)
// after:   if (syncedKey !== navSyncKey(boards))
```

`navSyncKey` is a new pure helper in `src/lib/boards/nav-sync-key.ts` (grepped: nothing like it
exists). It hashes **every field `SortableBoardRow` renders** — `id`, `position`, `name`,
`shared_out` — not just ids. Only hashing ids/positions would leave a server-side rename stranded in
the stale `ordered` state, trading one silent bug for another.

**The test that proves it (required, and it must fail today).** In `BoardsNav.test.tsx`: arm the drag
layer, `drop("b2","b1")`, then re-render with `[...boards]` — a **freshly allocated, content-identical
array**, exactly what a `boards.filter(...)` upstream produces. Today the identity differs, `setOrdered(boards)`
fires, and the rendered order snaps back to `["b1","b2"]` → **red**. After, the key matches, the
optimistic order stands → green.

Its mandatory companion: re-render with a genuinely different server order and assert `ordered`
**does** resync. Without it, `navSyncKey` could return a constant and both tests would still pass —
the exact shape gotcha-89 catalogues.

**What this makes unnecessary, and what stays.** Once sync is content-based, the caller boundary no
longer needs defending, so **no assertion is added to `shell/sidebar-nav.test.tsx`** — it would be a
test with no defect left to guard. The `useMemo` and the `NO_FOLDERS` / `NO_PLACEMENTS` module
constants in `BoardsNav.tsx` **stay**, because they are still a genuine render-cost saving; their
comments are downgraded from "load-bearing, not a micro-optimisation" to what they now are. See Q2.

---

## Performance & data-fetching budget _(AGENTS.md working agreement #5)_

**(a) First paint vs. interaction.**

| Moment                               | Server round-trips                                                     | Change                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| First paint of the sidebar           | unchanged — `sidebar-nav-data.tsx`'s existing `Promise.all`            | none                                                                                |
| Folder collapse / expand (click)     | **0**                                                                  | none (locked by the existing "collapses a folder without a server round-trip" test) |
| Folder auto-expand on drag hover     | **0** round-trips, and now **0 localStorage writes**                   | strictly fewer side effects than today                                              |
| Prune on mount                       | 0 round-trips; ≤1 localStorage write, and only when a stale key exists | new, bounded                                                                        |
| Drag a filed board to another folder | 1 `moveBoardToFolder` + 1 `router.refresh()`                           | same as today's unfiled path                                                        |
| Reorder an unfiled board             | 1 `reorderBoard`, **no** revalidation                                  | unchanged (gotcha-44)                                                               |
| Rename / delete a folder             | 1 statement — `.select("id")` is RETURNING on the same statement       | unchanged                                                                           |

**(b) Does the interaction change server data?** Collapse/expand and hover-expand do not: they stay
client state in `useUIStore`, persisted to localStorage, with no `<Link>`, no `router` navigation and
no `router.refresh()`. Filing a board does change server data, so it keeps its Server Action plus the
targeted `router.refresh()` — a placement decides which subtree a row renders in.

**(c) Are hot-path reads bounded over indexed columns?** Yes, and this slice improves one.
`listBoardFoldersCached` is unchanged and still capped at 200 folders / 2000 placements, ordered over
`(user_id, position)` and `(folder_id, position)`. No new query, no `select *`, no unbounded read.
The new `board_folder_boards_board_id_idx` converts the `boards`-delete cascade from a full scan of
the placement PK index into a seek (F1).

**Bundle:** `@dnd-kit` stays out of the shell bundle. `KeyboardSensor` and
`sortableKeyboardCoordinates` are imported **only** inside the lazy `BoardsNavSortable` chunk, which
already carries the dnd stack; `sensors.ts` takes the getter as an argument rather than importing it,
so nothing new reaches the eight eager call sites. Deleting `queries.ts` removes a `server-only`
module with no runtime effect.

---

## Testing strategy

Every task is TDD: write the failing test, watch it fail, implement, watch it pass.

**The gotcha-89 rule applies to every test in this slice.** For each test whose value is "this
specific defect cannot return", the implementer must apply a one-line mutation, watch it go red,
revert, and **paste the failure output into the task report**. Three tests carry the strongest
obligation, because each is guarding a defect that shipped:

| Test                                                    | Mutation that must turn it red                       |
| ------------------------------------------------------- | ---------------------------------------------------- |
| rename/delete report a 0-row match as failure           | remove the `!data` arm                               |
| optimistic order survives a content-identical re-render | restore `!==` identity comparison                    |
| prune keeps a hidden folder's key                       | prune against `grouped.folders` instead of `folders` |

**The fake must apply its arguments, not just record them.** `folders/actions.test.ts`'s chainable
stub currently resolves `{ error }` with no notion of affected rows. It gains a `state.affectedRows`
that `.select().maybeSingle()` actually reads, so a 0-row result changes what the action observes.
Recording alone would let the fix be deleted with the suite green — decision from gotcha-89.

**What cannot be unit-tested, said plainly.** jsdom gives every node a 0×0 rect, so no keyboard drag
can be simulated end to end: arrow-key collision resolution needs real geometry. The unit tests
therefore assert _wiring_ (a `KeyboardSensor` is present and carries `sortableKeyboardCoordinates`; a
shared/filed row's node is registered as a droppable so the getter will not bail). The behaviour
itself is verified in the manual walkthrough. This is stated rather than papered over with a test
that asserts the shape of the code.

**Regression surface that must stay green untouched:** the three "folder row alignment" tests, the
"collapses a folder without a server round-trip" test, the two "optimistic reorder survives a client
re-render" tests, and the focus-handoff tests. If any of them needs editing, the change is wrong.

**Reuse over re-implementation.** The migration-shape test consumes the existing
`readMigrationSources()` (`src/test/anon-conformance.ts:174`), which already resolves and reads
`supabase/migrations/*.sql` for the conformance probes. The one genuinely new helper in this slice is
`navSyncKey`, and it was grepped for first.

Suites re-opened: `folders/actions.test.ts`, `dnd/sensors.test.ts`, `stores/ui.test.ts`,
`BoardsNav.test.tsx`, plus a new `nav-sync-key.test.ts` and a new migration-shape test.
**`shell/sidebar-nav.test.tsx` is deliberately not re-opened** (D-9, Q2). No `CalendarBoard` /
`KanbanBoard` / `GanttBoard` / `BoardTable` / `ColumnOptionsDialog` test is re-opened, which is a
direct consequence of the D-4 ruling and is itself asserted: `useTouchAwareSensors()` called with no
argument must return exactly two sensors and no `KeyboardSensor`.

---

## Execution DAG _(AGENTS.md working agreement #6)_

Four lanes. Items 5, 6, 8 and 9 all converge on `BoardsNavSortable.tsx` / `BoardFolderRow.tsx` /
`BoardsNav.test.tsx`, so they are one lane, never parallel agents.

```
Lane A {1,2,3}  DB + server actions          ─┐
Lane B {7}      stores/ui.ts                 ─┼─► Lane D {5,6,8,9} ─► integrate
Lane C {4a}     lib/dnd/sensors.ts           ─┘
```

| Lane | Items                         | Owns                                                                                                                           | Produces                                        | Consumes                                            |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------- |
| A    | 1, 2, 3                       | the new migration, `folders/queries.ts` (deleted), `folders/actions.ts` + test                                                 | `board_folder_boards_board_id_idx`              | —                                                   |
| B    | 7                             | `src/stores/ui.ts`, `stores/ui.test.ts`                                                                                        | `setSection`, `pruneSections`, delete-on-reopen | —                                                   |
| C    | 4 (sensor half)               | `src/lib/dnd/sensors.ts`, `sensors.test.ts`                                                                                    | opt-in `keyboardCoordinateGetter`               | —                                                   |
| D    | 5, 6, 8, 9, 4 (consumer half) | `BoardsNav.tsx`, `BoardsNavSortable.tsx`, `BoardFolderRow.tsx`, `boards-nav-focus.ts`, `nav-sync-key.ts`, `BoardsNav.test.tsx` | —                                               | B's `setSection`/`pruneSections`, C's sensor option |

**Edges:** B → D, C → D. A is independent of all three.

**This differs from the partition in the brief, in two ways, both deliberate:**

1. The brief has `{7}` fully independent. It is not: D-6's "persist open on a successful drop" needs
   an idempotent `setSection`, and D-7's prune needs `pruneSections` — both live in `ui.ts`. Two
   agents editing `ui.ts` in one worktree clobber each other, so `ui.ts` gets exactly one owner (B)
   and D consumes what it produces.
2. The brief scopes `{4}` as "sensors + board test files". The D-4 ruling removes the board test
   files from that lane entirely — only `sensors.ts` + its own test change — and moves the single
   consuming line into D.

**Batches**

- **Batch 1 — A, B, C concurrently.** Three agents, fully disjoint files. Dispatch with
  `superpowers:dispatching-parallel-agents`.
- **Batch 2 — D alone.** One agent, four ordered sub-steps, each red→green before the next:
  **9 → 8 → 6 → 5**. 8 and 6 are adjacent because both rewrite `BoardFolderRow`'s header; 9 goes
  first because it is the smallest and the most consequential; 5 goes last because it restructures
  `FolderSection` and depends on the header markup being settled.
- **Batch 3 — integrate.** Apply the migration to DEV via the `supabase-dev` MCP at the committed
  version + name, re-run the `EXPLAIN`, `pnpm db:ledger-check`, then the four gates and
  `scripts/finish-task.sh`.

**Critical path:** `max(B, C) → D → integrate`. D is the wall-clock floor — four items in one 50KB
test file. A runs entirely in its shadow.

**Worktree:** one for the whole slice — `.claude/worktrees/sidebar-folders-hardening` (already cut).
Batch 1's three agents run _inside_ it. Separate worktrees per lane would only manufacture rebase
conflicts.

---

## Open questions for the owner

**Q1 — Should a filed board be draggable _out_ to the unfiled list?**
In scope today: folder→folder by drag, and ⋯ → "Remove from folder". Not in scope: an explicit
`unfiled:` drop zone around the unfiled list so a filed board can be dragged out. Adding it means one
more droppable, one more branch in `handleDragEnd`, and a visible drop affordance for a region that
currently has no border. Answering "no" is coherent — the menu path exists and a filed row dropped on
empty space simply snaps back. Answering "yes" grows lane D by roughly one sub-step.

**Q2 — Confirm `shell/sidebar-nav.test.tsx` stays closed.**
The brief lists it among the suites likely re-opened. D-9 argues the opposite: once sync is
content-based, an assertion there ("passes the same array identity through") guards an invariant that
no longer exists — a test with nothing left to break. The corollary is that `BoardsNav.tsx`'s
`useMemo` and module-level `NO_FOLDERS`/`NO_PLACEMENTS` constants stay, but their comments stop
claiming to be load-bearing for correctness. Confirm both halves.

**Q3 — What do we do about the other eight drag surfaces?**
The D-4 ruling leaves Kanban, Gantt, Calendar, BoardTable, GroupHeaderRow, SubitemBlock and
ColumnOptionsDialog announcing "press space bar to pick up" with no keyboard path. Three options:
(a) accept for now, record an ADR naming all eight so it cannot be forgotten — cheapest, honest;
(b) suppress the false announcement now by overriding each `DndContext`'s
`accessibility.screenReaderInstructions` — small per surface, but eight surfaces and eight test
files, and it removes the promise rather than keeping it;
(c) opt every surface into keyboard drag now — correct end state, but each needs its own coordinate
strategy and its own manual acceptance pass, which is a slice of its own.
Recommendation: **(a) now, (c) as a scheduled follow-up.**
