# Sidebar Board Folders — Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay down all nine minors knowingly carried when sidebar board folders shipped (PR #101), without adding a feature. The only user-visible change is that boards already inside a folder become draggable.

**Architecture:** One index-only migration; one dead module deleted; two Server Actions learn to tell "changed nothing" from "succeeded"; the shared dnd sensor factory grows an **opt-in** keyboard coordinate getter (no other drag surface changes); the persisted collapse map gains an idempotent setter and a prefix-scoped prune; and the Boards-nav components get four fixes in one lane — content-based optimistic-order sync, one disclosure per folder header, purely-visual hover expansion, and drag-enabled filed rows.

**Tech Stack:** Next.js 16 App Router (Server Actions, `updateTag`), Supabase Postgres + RLS, TypeScript strict, Zod 4, Zustand + `persist`, Tailwind v4 + shadcn primitives, `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` + `@dnd-kit/modifiers@9.0.0`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-27-sidebar-folders-hardening-design.md`
**Debt list:** `vault/sessions/2026-08-26-1705-sidebar-board-folders.md` → "Open threads"

## Global Constraints

- **Migrations are minted only via `scripts/new-migration.sh <slug>`.** Never hand-stamp a version. Apply to DEV via the `supabase-dev` MCP with the **same version + name** as the committed file, then verify with `pnpm db:ledger-check`. An index changes no generated types — do **not** commit a no-op `database.types.ts` regen; say so in the PR body instead.
- **The production deployment runs the DEV database.** DEV holds real, live, user-facing data. Read-only `EXPLAIN` (no `ANALYZE`) only; no destructive probes.
- **Server Actions return `ActionResult` / `fail` from `src/lib/actions/result.ts`.** Never re-declare the shape. Cache tags come from `src/lib/cache/tags.ts` — never inline a literal.
- **Grep before writing any helper.** The one new helper in this plan (`navSyncKey`) was grepped for and does not exist.
- **UI work requires the `pulse-ui` and `frontend-design` skills loaded before writing markup** (working agreement #3). Reuse existing token classes (`bg-state-hover`, `text-muted-foreground`, `focus-visible:ring-ring`); introduce no new colour and no raw Tailwind palette class.
- **In-page toggles are 0 server round-trips.** Folder collapse/expand and hover-expand must never call `router.refresh()`, `router.push()`, or render a `<Link>`. The existing "collapses a folder without a server round-trip" test stays green.
- **TDD, and gotcha-89 discipline.** Write the failing test, watch it fail, implement, watch it pass. For every test guarding a specific defect, apply a one-line mutation, watch it go red, revert, and **paste the failure output into the task report**. A test that passes before and after the change is worthless.
- **Fakes must record AND apply their arguments.** `folders/actions.test.ts`'s stub must let a 0-row result actually change what the action observes.
- **Do not touch these files.** `src/components/shell/sidebar-nav.tsx`, `src/components/shell/sidebar-nav.test.tsx`, `src/components/shell/nav-section.tsx`, `src/lib/boards/folders/queries-cached.ts`, `src/components/boards/BoardFolderMenu.tsx`, and the seven other drag surfaces (`KanbanBoard`, `GanttBoard`, `CalendarBoard`, `BoardTableInner`, `GroupHeaderRow`, `SubitemBlock`, `ColumnOptionsDialog`) with their tests. If a change seems to require one of these, stop and report — it means a design decision needs revisiting, not a wider diff.
- **These tests must stay green with no edits:** the three "BoardsNav folder row alignment" tests, "collapses a folder without a server round-trip", both "optimistic reorder survives a client re-render" tests, and the focus-handoff tests in "BoardsNav focus handoff into the drag layer" / "BoardsNav folder-row focus handoff". If one goes red, the implementation is wrong.
- **Commit identity is pinned** to `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage explicitly by path — never `git add -A` / `git add .` / `git commit -a`.
- **Gates before finishing:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `scripts/finish-task.sh` from inside the worktree.

## File Structure

**Created**

| File                                                               | Responsibility                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<stamp>_board_folder_boards_board_id_idx.sql` | The single index. Stamp minted by the script.                                                     |
| `src/lib/boards/nav-sync-key.ts`                                   | `navSyncKey(boards)` — content signature for the optimistic-order guard.                          |
| `src/lib/boards/nav-sync-key.test.ts`                              | Unit tests for the above.                                                                         |
| `src/lib/boards/folders/migration-indexes.test.ts`                 | Parses `supabase/migrations/*.sql`; asserts `board_folder_boards` has an index led by `board_id`. |

**Modified**

| File                                          | Change                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/boards/folders/actions.ts`           | `renameFolder` / `deleteFolder` fail on a 0-row match; `updateTag` moves after that check.                                    |
| `src/lib/boards/folders/actions.test.ts`      | Fake gains applied `affectedRows`; four new tests.                                                                            |
| `src/stores/ui.ts`                            | `toggleSection` deletes on re-open; add `setSection`, `pruneSections`.                                                        |
| `src/stores/ui.test.ts`                       | Tests for all three.                                                                                                          |
| `src/lib/dnd/sensors.ts`                      | Optional `keyboardCoordinateGetter` → adds a `KeyboardSensor`. Default output unchanged.                                      |
| `src/lib/dnd/sensors.test.ts`                 | Default-shape guard + opt-in test.                                                                                            |
| `src/components/boards/BoardsNavSortable.tsx` | Content-based sync; keyboard sensor opt-in; filed rows drag-enabled; same-folder drop guard; persist-open on successful drop. |
| `src/components/boards/BoardsNav.tsx`         | `FolderSection` → `{ folder, entries }` + plain `renderRow`; prune effect.                                                    |
| `src/components/boards/BoardFolderRow.tsx`    | One disclosure button; hover expansion becomes visual-only; `useEffect` deleted.                                              |
| `src/components/boards/boards-nav-focus.ts`   | Comment only — the "two toggles" note is now false.                                                                           |
| `src/components/boards/BoardsNav.test.tsx`    | New tests for items 5/6/8/9; ~6 disclosure queries migrate to `{ name, expanded }`.                                           |

**Deleted**

| File                                | Why                                              |
| ----------------------------------- | ------------------------------------------------ |
| `src/lib/boards/folders/queries.ts` | `listBoardFolders` has zero importers repo-wide. |

## Execution DAG

```
Task 1 {items 1,2,3}  DB + server actions   ─┐
Task 2 {item 7}       stores/ui.ts          ─┼─► Task 4 {items 5,6,8,9 + 4b} ─► Task 5 (integrate)
Task 3 {item 4a}      lib/dnd/sensors.ts    ─┘
```

**Dependency edges**

- Task 4 depends on Task 2 (consumes `setSection`, `pruneSections`).
- Task 4 depends on Task 3 (consumes the `keyboardCoordinateGetter` option).
- Task 1 depends on nothing and blocks nothing.
- Task 5 depends on Tasks 1–4.

**Parallel batches**

- **Batch 1:** Tasks **1, 2, 3 concurrently** — three agents, fully disjoint files. Dispatch with `superpowers:dispatching-parallel-agents`.
- **Batch 2:** Task **4** alone. Four ordered sub-steps, each red→green before the next: **item 9 → item 8 → item 6 → item 5**.
- **Batch 3:** Task **5**.

**Critical path:** `max(Task 2, Task 3) → Task 4 → Task 5`. Task 4 is the wall-clock floor: four items converging on one 50KB test file. Task 1 runs entirely in its shadow.

**Why items 5/6/8/9 are one task, not four:** all four mutate `BoardsNavSortable.tsx`, `BoardFolderRow.tsx` and `BoardsNav.test.tsx`. Parallel agents on those files clobber each other in a shared worktree and manufacture rebase conflicts in separate ones. **Why `ui.ts` has exactly one owner:** items 6 and 7 both need it, so Task 2 owns the file and Task 4 consumes its exports — this is why Task 2 is _not_ independent, contrary to the debt list's grouping.

**Worktree:** one for the whole slice — `.claude/worktrees/sidebar-folders-hardening`, branch `task/sidebar-folders-hardening` (already cut). Batch 1's three agents run _inside_ it.

---

### Task 1: The index, the dead module, and the 0-row actions

**Items:** 1, 2, 3

**Files:**

- Create: `supabase/migrations/<stamp>_board_folder_boards_board_id_idx.sql`
- Create: `src/lib/boards/folders/migration-indexes.test.ts`
- Delete: `src/lib/boards/folders/queries.ts`
- Modify: `src/lib/boards/folders/actions.ts`, `src/lib/boards/folders/actions.test.ts`

**Interfaces:**

- Consumes: `fail` / `ActionResult` from `src/lib/actions/result.ts`; `boardFoldersTag` from `src/lib/cache/tags.ts`; the not-found pattern at `src/lib/org/admin-actions.ts:188-193`.
- Produces: index `board_folder_boards_board_id_idx`. No exported API changes — `renameFolder` / `deleteFolder` keep their `ActionResult` signatures.

- [ ] **Step 1: Confirm the dead module before deleting it**

```bash
grep -rn "listBoardFolders\b" src/ e2e/ scripts/ | grep -v "listBoardFoldersCached"
```

Expect **only** the definition in `src/lib/boards/folders/queries.ts`. If anything else appears, stop and report — the premise is wrong.

- [ ] **Step 2: Delete `src/lib/boards/folders/queries.ts`**

The whole file. `queries-cached.ts` is the live read and is untouched.

**No test is added.** Typecheck/lint/build are the guard; a test asserting a module's absence cannot fail in any meaningful way (gotcha-89). Record the grep output as the evidence.

- [ ] **Step 3: Mint the migration**

```bash
scripts/new-migration.sh board_folder_boards_board_id_idx
```

Note the generated path — its version stamp is what you must reuse when applying to DEV in Task 5. **Never hand-edit the stamp.**

- [ ] **Step 4: Write the migration SQL**

```sql
-- The `board_id` FK on board_folder_boards is uncovered: the PK is
-- (user_id, board_id), so a board_id-only predicate cannot seek it.
--
-- The consumer is NOT the app's unfile path — that runs through the RLS client,
-- which supplies user_id and already gets a clean PK seek. The consumer is the
-- `boards ON DELETE CASCADE` referential-integrity check, which filters on
-- board_id alone and today scans the ENTIRE placement PK index, across all
-- users, every time any board is deleted. Measured on DEV with EXPLAIN before
-- this index existed:
--
--   Bitmap Index Scan on board_folder_boards_pkey
--     Index Cond: (board_id = $1)          -- full index scan
--
-- It is also what the Supabase `unindexed_foreign_keys` advisor flags.
create index board_folder_boards_board_id_idx
  on public.board_folder_boards (board_id);
```

- [ ] **Step 5: Write the failing migration-shape test, then watch it pass**

`src/lib/boards/folders/migration-indexes.test.ts`: assert there is a `create index … on public.board_folder_boards (board_id …)` whose **leading** column is `board_id`.

**Reuse `readMigrationSources()` from `src/test/anon-conformance.ts:174`** — it already resolves `supabase/migrations` from the repo root and returns every file's contents, which is exactly this test's input. Do not re-implement a `readdirSync` walk (grep-before-writing-a-helper).

Write it **before** Step 4's SQL if you can reorder; otherwise delete the `create index` line, watch the test go red, restore it, and paste both outputs. That mutation IS the evidence — a file-shape assertion is otherwise trivially satisfiable.

- [ ] **Step 6: Write the four failing action tests**

In `src/lib/boards/folders/actions.test.ts`, first extend the chainable stub so a 0-row result is **observable**, not just recorded: add `state.affectedRows: number` (default `1`) and a `.maybeSingle()` terminal that resolves `{ data: state.affectedRows > 0 ? { id: FOLDER } : null, error: state.insertError }`. The existing `.single()` path for `createFolder` stays as it is.

Then the tests:

1. `"renameFolder reports a folder that isn't yours as missing"` — `state.affectedRows = 0`; expect `res.ok === false`, the message `"That folder no longer exists."`, and **`updateTag` not called**.
2. `"deleteFolder reports a folder that isn't yours as missing"` — same shape.
3. `"still renames and invalidates on a real match"` — `affectedRows = 1`; the existing rename assertions plus `updateTag` called once. (Regression guard: the fix must not break the happy path.)
4. `"unfiling a board with no placement stays a success"` — `moveBoardToFolder({ boardId, folderId: null })` with `affectedRows = 0` expects `res.ok === true`. This locks D-3's deliberate asymmetry so a future "consistency" refactor has to argue with it.

Run them. Tests 1 and 2 **must fail** (today both actions return `ok: true`). If they pass, the fake is not applying `affectedRows` — fix the fake before touching the action.

- [ ] **Step 7: Implement the 0-row checks**

In `renameFolder`:

```ts
const { data, error } = await supabase
  .from("board_folders")
  .update({ name: parsed.data.name })
  .eq("id", parsed.data.folderId)
  .select("id")
  .maybeSingle();
if (error) return fail(error.message);
// An RLS-filtered miss is not an error — the row simply was not visible to us.
if (!data) return fail("That folder no longer exists.");

updateTag(boardFoldersTag(user.id));
return { ok: true, data: undefined };
```

`deleteFolder` mirrors it with `.delete().eq("id", …).select("id").maybeSingle()`.

`moveBoardToFolder` is **unchanged** — add a comment on the unfile branch explaining why a 0-row delete stays a success (a double-click or a stale menu is not an error the user should see).

`updateTag` must sit **after** the not-found check in both.

- [ ] **Step 8: Mutation-check and report**

Delete the `if (!data)` arm from `renameFolder`; tests 1 must go red. Restore. Same for `deleteFolder`. Paste both failures into the report.

- [ ] **Step 9: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Do **not** apply the migration to DEV — Task 5 does that, after the branch is otherwise complete.

---

### Task 2: Bound the persisted collapse map

**Items:** 7 (and the store half of 6)

**Files:**

- Modify: `src/stores/ui.ts`, `src/stores/ui.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `setSection(key: string, collapsed: boolean)`, `pruneSections(prefix: string, keep: ReadonlySet<string>)`, and `toggleSection` with delete-on-reopen semantics. **Task 4 consumes all three.**

- [ ] **Step 1: Confirm nothing distinguishes `false` from absent**

```bash
grep -rn "collapsedSections" src/ | grep -v "\.test\."
```

Expect exactly two readers, both using `!collapsedSections[key]` — `src/components/shell/nav-section.tsx:33` and `src/components/boards/BoardFolderRow.tsx:37`. If a third reader exists, or one checks `=== false`, stop and report.

- [ ] **Step 2: Write the failing tests**

In `src/stores/ui.test.ts`, extend the existing `describe("collapsedSections")`:

1. `"re-opening a section removes its key rather than persisting false"` — `toggleSection("boards")` twice, then `expect("boards" in useUIStore.getState().collapsedSections).toBe(false)`. **Fails today** (the key is present with value `false`).
2. `"setSection is idempotent and does not flip an already-open section"` — `setSection("boards", false)` twice leaves the section open; `setSection("boards", true)` collapses it. Fails today (`setSection` does not exist).
3. `"pruneSections drops folder keys that are not in the keep set"` — seed `{ "folder:a": true, "folder:b": true, boards: true }`, prune with `keep = new Set(["a"])`, expect `folder:b` gone, `folder:a` kept, **`boards` untouched**. The prefix scoping is the whole safety property.
4. `"pruneSections with an empty keep set removes every folder key"` — proves the function **applies** its argument rather than short-circuiting.
5. `"pruneSections returns the identical object when nothing is stale"` — `expect(after).toBe(before)`. This is what stops Task 4's effect from looping.

- [ ] **Step 3: Implement**

```ts
collapsedSections: Record<string, boolean>;
toggleSection: (key: string) => void;
setSection: (key: string, collapsed: boolean) => void;
pruneSections: (prefix: string, keep: ReadonlySet<string>) => void;
```

- `toggleSection(key)`: if the key is currently truthy, return a map **without** it (`delete`, not `= false`) — absent already means open, so writing `false` only grows localStorage forever. Otherwise set it to `true`.
- `setSection(key, collapsed)`: `collapsed ? { ...map, [key]: true }` : map without the key. Must return the **same object** when the value is already what was asked for.
- `pruneSections(prefix, keep)`: drop entries whose key starts with `prefix` and whose suffix is not in `keep`; leave every other key alone; **return the identical object when nothing was dropped**.

`partialize` is unchanged — it still persists the whole (now bounded) map.

- [ ] **Step 4: Mutation-check**

Change `pruneSections` to ignore its `keep` argument (drop every prefixed key); test 3 must go red. Change it to ignore `prefix` (prune everything); test 3 must go red on `boards`. Restore, paste both.

- [ ] **Step 5: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test -- src/stores/ui.test.ts
```

Then the full `pnpm test` — `nav-section.test.tsx` exercises `toggleSection` and must stay green.

---

### Task 3: Opt-in keyboard sensor

**Item:** 4 (sensor half)

**Files:**

- Modify: `src/lib/dnd/sensors.ts`, `src/lib/dnd/sensors.test.ts`

**Interfaces:**

- Consumes: `KeyboardSensor`, `KeyboardCoordinateGetter` from `@dnd-kit/core`.
- Produces: `useTouchAwareSensors(options?: { keyboardCoordinateGetter?: KeyboardCoordinateGetter })`. **Task 4 consumes it.**

**Do not import `sortableKeyboardCoordinates` here.** It lives in `@dnd-kit/sortable`, and importing it would drag that package into every eager call site's module graph. The caller passes the getter in.

- [ ] **Step 1: Write the failing tests**

In `src/lib/dnd/sensors.test.ts`, keep the existing test untouched and add:

1. `"stays pointer+touch only when no keyboard strategy is supplied"` — `useTouchAwareSensors()` returns **exactly two** sensors and none is `KeyboardSensor`. **This is the guard that the other eight drag surfaces are unchanged** — it passes today and must keep passing, which is the point.
2. `"adds a KeyboardSensor carrying the supplied coordinate getter"` — call with a sentinel getter; expect a third sensor whose `sensor === KeyboardSensor` and whose `options.coordinateGetter` is that exact function. **Fails today.**

- [ ] **Step 2: Implement**

```ts
export function useTouchAwareSensors(options?: {
  keyboardCoordinateGetter?: KeyboardCoordinateGetter;
}) {
  const keyboard = options?.keyboardCoordinateGetter;
  const pointer = useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  });
  const touch = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 8 },
  });
  // Constructed unconditionally — `useSensor` is a hook, so a conditional call
  // would change the hook order between renders. `useSensors` filters nullish
  // entries (verified in @dnd-kit/core@6.3.1, core.cjs.development.js:205-212),
  // so passing `null` is the sanctioned way to leave a sensor out.
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: keyboard,
  });
  // Opt-in, per surface: dnd-kit spreads `attributes` (which announce a
  // space-bar lift) onto every handle, but the coordinate STRATEGY that makes
  // that lift real differs by geometry — a sortable list, a Gantt bar and a
  // calendar cell do not move the same way. Constructing the sensor stays in
  // one place; choosing the geometry cannot.
  return useSensors(pointer, touch, keyboard ? keyboardSensor : null);
}
```

**Never call `useSensor` inside a branch or a conditional spread** — it is a hook, and the hook order must be stable across renders. The conditionality belongs in the argument list, not the call site.

Update the module doc comment: the "configured in exactly one place" claim now covers the activation constraints and sensor construction, with the keyboard geometry passed in.

- [ ] **Step 3: Mutation-check**

Make the `KeyboardSensor` unconditional; test 1 must go red (three sensors, not two). Restore, paste.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

`GanttBoard.test.tsx`, `KanbanBoard.test.tsx`, `BoardsNav.test.tsx`, `CalendarBoard.test.tsx`, `BoardTable.test.tsx` and `ColumnOptionsDialog.test.tsx` all exercise this hook and must stay green **with no edits**. If any needs touching, the default path changed and the implementation is wrong.

---

### Task 4: The Boards-nav lane

**Items:** 9, 8, 6, 5 (in that order), plus the consuming half of 4

**Files:**

- Create: `src/lib/boards/nav-sync-key.ts`, `src/lib/boards/nav-sync-key.test.ts`
- Modify: `src/components/boards/BoardsNavSortable.tsx`, `src/components/boards/BoardsNav.tsx`, `src/components/boards/BoardFolderRow.tsx`, `src/components/boards/boards-nav-focus.ts`, `src/components/boards/BoardsNav.test.tsx`

**Interfaces:**

- Consumes: Task 2's `setSection` / `pruneSections`; Task 3's `keyboardCoordinateGetter` option; existing `NavBoard` from `src/lib/boards/folders/group.ts`; existing `reorderPosition` from `src/lib/boards/group-reorder.ts`.
- Produces: `navSyncKey`; the reshaped `FolderSection` type.

**Load `pulse-ui` and `frontend-design` before writing any markup** (working agreement #3).

#### Sub-step 4a — item 9: content-based optimistic-order sync

- [ ] **Step 1: Write `nav-sync-key.test.ts` first**

`navSyncKey(boards)` must produce equal strings for content-identical lists with different array identities, and different strings when **any** of `id`, `position`, `name`, `shared_out` differs, or when order differs. Cover each field individually — a key that ignores `name` would strand a server-side rename in the stale optimistic state.

- [ ] **Step 2: Implement `src/lib/boards/nav-sync-key.ts`**

A pure function over `Pick<BoardListEntry, "id" | "position" | "name" | "shared_out">[]`, joining a per-board signature with a separator that cannot appear in a uuid or collide across fields. Document _why_ all four fields are in it.

- [ ] **Step 3: Write the two failing tests in `BoardsNav.test.tsx`**

Add a `describe("BoardsNav optimistic reorder survives a re-allocated prop")` next to the existing re-render block:

1. **The required failing test.** Render, `fireEvent.pointerEnter` the body, `await findByTestId("boards-nav-sortable")`, `drop("b2","b1")`, `await waitFor(reorderBoard called)`, assert `["b2","b1"]`. Then re-render passing **`[...boards]`** — a freshly allocated, content-identical array, exactly what `boards.filter(...)` upstream produces — and assert the order is **still** `["b2","b1"]`, `reorderBoard` was called once, and `routerRefresh` was never called.
   **This must fail right now**, snapping back to `["b1","b2"]`. If it passes before the fix, it is not testing the identity guard — rewrite it. (Note: pass the same `sharedBoards` reference; only `boards` is re-allocated, or the test is ambiguous about which prop caused the resync.)
2. **The companion that stops the guard being vacuous.** Re-render with a genuinely different server list (positions swapped) and assert `ordered` **does** resync to the server order. Without this, `navSyncKey` could return a constant and test 1 would still pass.

- [ ] **Step 4: Implement in `BoardsNavSortable.tsx`**

```ts
const [ordered, setOrdered] = useState(boards);
const [syncedKey, setSyncedKey] = useState(() => navSyncKey(boards));
const incomingKey = navSyncKey(boards);
if (syncedKey !== incomingKey) {
  setSyncedKey(incomingKey);
  setOrdered(boards);
}
```

Rewrite the comment block above it: the invariant is no longer "the prop identity only changes on a server re-render" (which was never true once a derived array was passed in) but "the prop's _content_ changed, so the server sent a new list".

- [ ] **Step 5: Update `BoardsNav.tsx`'s stale comments**

The `NO_FOLDERS` / `NO_PLACEMENTS` block and the `useMemo` comment both claim to be load-bearing for correctness. They are now a render-cost saving. **Keep the code, downgrade the prose.** Do not delete the memo or the constants.

- [ ] **Step 6: Mutation-check**

Restore `if (syncedBoards !== boards)`; test 1 must go red. Restore, paste. Then make `navSyncKey` return `""` unconditionally; test 2 must go red. Restore, paste.

#### Sub-step 4b — item 8: one disclosure per folder header

- [ ] **Step 7: Write the failing test**

`"a folder header has exactly two tab stops — the disclosure and its ⋯ menu"`: query `[data-folder-row]` and count `button, a[href], input, [tabindex]:not([tabindex="-1"])`. Expect **2**. Fails today (3).

Add: `"the disclosure carries aria-expanded and aria-controls and its name is the folder name"`, and `"clicking the folder name still toggles"`.

- [ ] **Step 8: Merge the two buttons**

One `<button type="button">` containing chevron icon + folder icon + name, with `onClick={() => toggleSection(key)}`, `aria-expanded={open}`, `aria-controls={bodyId}`. The count `<span aria-hidden>` and `<BoardFolderMenu>` stay **outside** it (inside the button they would join the accessible name).

Per **D-8a**, drop the `aria-label` — the accessible name becomes the folder name and `aria-expanded` carries the state. Migrate the ~6 existing queries from `/Collapse Acme Rebrand/i` / `/Expand Acme Rebrand/i` to `getByRole("button", { name: "Acme Rebrand", expanded: true | false })`. **If the owner vetoed D-8a**, keep the dynamic `aria-label` instead and leave those queries alone; everything else here is identical.

Add `focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none` — neither button has a visible focus ring today, on the section's first tab stop.

- [ ] **Step 9: Fix `boards-nav-focus.ts`'s comment**

Lines 62-64 say "A folder header has two toggles (chevron and name); both restore to the chevron". Now false. `focusAnchorTarget`'s `button[aria-expanded]` selector still resolves — to exactly one node. Comment only; no logic change. Confirm the two folder-row focus-handoff tests stay green **unedited**.

#### Sub-step 4c — item 6: hover expansion becomes visual-only

- [ ] **Step 10: Write the failing tests**

1. `"hovering a collapsed folder expands it visually without writing collapse state"` — seed `collapsedSections: { "folder:f1": true }`, render `BoardFolderRow` with `isOver`, assert the body is visible **and** `useUIStore.getState().collapsedSections["folder:f1"]` is **still `true`**. **Fails today** (the effect flips it to `false`).
2. `"a cancelled drag leaves the folder collapsed"` — rerender with `isOver={false}`; body hidden again, store still `true`.
3. `"a successful drop into a collapsed folder persists it open"` — in the full `BoardsNav` tree, seed collapsed, `drop("b1","folder:f1")`, `await waitFor(moveBoardToFolder resolved)`, assert `"folder:f1" in collapsedSections === false`.

The existing `"opens a collapsed folder while a board is dragged over it"` test asserts only the rendered state — after D-8a it queries by `{ name, expanded }` instead of by label, but its assertion is unchanged and it must stay green.

- [ ] **Step 11: Implement**

In `BoardFolderRow`: `const open = !collapsedSections[key] || isOver;` and **delete the `useEffect` entirely** (and its `useEffect` import if now unused). Replace the comment with why hover no longer persists: a cancelled drag must leave nothing behind, so there is nothing to undo and no `onDragCancel` is needed.

In `BoardsNavSortable.fileIntoFolder`, on the success path before `router.refresh()`:

```ts
// The folder may have been collapsed — expand it so the board the user just
// filed is visible. setSection, not toggleSection: an already-open folder
// must stay open.
setSection(`folder:${folderId}`, false);
```

Pull `setSection` from the store with a selector, as the file already does for other state.

- [ ] **Step 12: Mutation-check**

Restore the `useEffect`; test 1 must go red. Swap `setSection(key, false)` for `toggleSection(key)`; add/keep a case where the folder is already open and assert it stays open — that must go red. Restore, paste both.

#### Sub-step 4d — item 5: filed boards become drag sources

- [ ] **Step 13: Write the failing tests**

1. `"a filed owned board gets a drag handle once the drag layer mounts"` — fails today.
2. `"a filed shared board gets a drag handle too"` — fails today.
3. `"drags a filed board into another folder and refreshes"` — `drop("b3","folder:f2")` calls `moveBoardToFolder({ boardId: "b3", folderId: "f2" })` then `routerRefresh`.
4. `"ignores a drop onto the folder the board is already in"` — `drop("b3","folder:f1")` where b3 is already in f1: `moveBoardToFolder` **not** called, `routerRefresh` **not** called.
5. `"a filed board dropped on an unfiled board is a no-op"` — no `reorderBoard`, no `moveBoardToFolder`, no toast. (Guards the Q1="no" fallback.)
6. The three **existing** "folder row alignment" tests must stay green **with no edits** — the inert `size-6` spacer in `PlainBoardRow` already reserves the handle's slot.

- [ ] **Step 14: Reshape `FolderSection`**

```ts
export type FolderSection = {
  folder: BoardFolder;
  entries: NavBoard[]; // count is entries.length
};
```

`BoardsNav` stops pre-rendering `children` and instead maps `grouped.folders` into `{ folder, entries }`, rendering rows itself in the plain tree via a local `renderPlainRow(entry, folderId)` (owned → `PlainBoardRow`, shared → `SharedBoardRow`). `BoardFolderRow` still takes `count` and `children`; the caller now computes both. This mirrors `SharedBoardsSection`'s existing `renderRow` shape — reuse the pattern, do not invent a second one.

- [ ] **Step 15: Make filed rows draggable in `BoardsNavSortable.tsx`**

`DroppableFolderRow` renders its `section.entries` through a drag-enabled renderer. Filed rows use **`useDraggable` plus a paired `useDroppable` on the same node and id** — the pairing is required, not decorative: `sortableKeyboardCoordinates` returns `undefined` when `droppableContainers.get(active.id)` misses, so without it a keyboard lift on a filed or shared row picks up and then refuses to move (spec F2). Apply the same pairing to the existing `DraggableSharedRow`.

Carry the current folder in the drag data: `useDraggable({ id: board.id, data: { folderId } })`.

In `handleDragEnd`, before calling `fileIntoFolder`:

```ts
// Dropping a board back on its own folder header is a no-op, not a write —
// `active.id === over.id` never catches it, because the ids are namespaced
// differently.
if (active.data.current?.folderId === folderId) return;
```

Grip `aria-label`: `Move ${board.name} to another folder`. A filed row cannot reorder — reusing "Reorder …" would be a fresh accessibility lie. Reuse `GRIP_CLASS` verbatim; add no new class.

- [ ] **Step 16: Wire the keyboard sensor (item 4, consumer half)**

```ts
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
const sensors = useTouchAwareSensors({
  keyboardCoordinateGetter: sortableKeyboardCoordinates,
});
```

Both imports live only in this lazy chunk, which already carries the dnd stack — nothing new reaches the shell bundle.

Test: `expect(useTouchAwareSensors).toHaveBeenCalledWith({ keyboardCoordinateGetter: sortableKeyboardCoordinates })`.

**State the limit in the test file's comment:** jsdom gives every node a 0×0 rect, so arrow-key collision resolution cannot be simulated here. These tests assert wiring; the behaviour is verified in the manual walkthrough. Do not write a test that pretends otherwise.

- [ ] **Step 17: Add the prune effect to `BoardsNav.tsx`**

```ts
// Prune against the RAW `folders` prop, never `grouped.folders`: the fold drops
// folders whose boards are all in another workspace, so pruning against the
// rendered tree would erase the collapse state of folders that still exist.
// And skip entirely when the prop was omitted — NO_FOLDERS means "unknown",
// not "none", and pruning against an empty set would wipe every folder key.
```

Effect keyed on a stable signature of the folder ids (e.g. the sorted ids joined), calling `pruneSections("folder:", new Set(folders.map((f) => f.id)))`. Task 2's `pruneSections` returns the identical object when nothing is stale, so this cannot loop — but key the effect on the signature string, not the array, regardless.

Tests: `"does not prune when no folder data was supplied"` (render without `folders`; a seeded `folder:x` key survives) and `"keeps the key of a folder hidden in this workspace"` (supply a folder whose boards are all elsewhere so `grouped.folders` drops it; its key survives). The second is the one that catches the subtle bug — mutation-check it by pruning against `grouped.folders`.

- [ ] **Step 18: Verify the whole lane**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Confirm every "must stay green with no edits" test in Global Constraints is untouched in the diff (`git diff` the test file and read the changed hunks).

---

### Task 5: Apply, verify, integrate

**Depends on:** Tasks 1–4.

- [ ] **Step 1: Apply the migration to DEV**

Via the `supabase-dev` MCP `apply_migration`, using the **same version + name** as the committed file from Task 1 Step 3. Never `supabase db push` from a worktree.

- [ ] **Step 2: Prove the index is used**

Re-run the read-only probe (no `ANALYZE`, nothing written):

```sql
explain (costs off)
delete from public.board_folder_boards
where board_id = '00000000-0000-4000-8000-000000000000'::uuid;
```

Expect `Index Scan using board_folder_boards_board_id_idx` (or a Bitmap Index Scan on it) instead of the previous full scan of `board_folder_boards_pkey`. **Paste the before/after plans into the report** — this is the acceptance evidence for item 1, not the file-shape test.

- [ ] **Step 3: Ledger check**

```bash
pnpm db:ledger-check
```

Must be clean in both directions. A ledger row with no committed file is drift and blocks the finish (gotcha-57). Needs `psql` on `PATH` or `PG_BIN` set, or it exits 3 and checks nothing.

- [ ] **Step 4: Four gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 5: Commit and finish**

Stage explicitly by path. Suggested commits (Conventional Commits, enforced by the `commit-msg` hook):

- `perf(db): index board_folder_boards.board_id for the boards cascade`
- `fix(boards): fail folder rename/delete when nothing matched`
- `refactor(boards): drop the unused listBoardFolders read`
- `feat(boards): keyboard drag for the sidebar board list`
- `fix(boards): make filed boards draggable and hover-expand non-persistent`
- `fix(ui): bound the persisted collapsed-sections map`

Add a `Changelog:` trailer only to the user-visible one — e.g.
`Changelog: improved | Drag boards between folders | Boards already in a folder can now be dragged straight into another one, and the sidebar's drag handles work from the keyboard.`
Then run `pnpm changelog:gen` and commit `src/lib/changelog/generated.ts` (CI on develop fails if it is stale).

Then, from inside the worktree:

```bash
scripts/finish-task.sh
```

It rebases onto the latest `develop`, runs the gates against the merged state, merges, pushes, and removes the worktree + branch. **The task is not complete until that has run.**

- [ ] **Step 6: Hand over the manual walkthrough**

Include it in the closing message **and** in the `/wrapup` session note under "How to test". Draft:

1. Pull `develop` and reload. (The deployment runs the **DEV** database — these are real boards.)
2. **Filed-board drag.** Put two boards in one folder and one in another. Drag a board out of folder A onto folder B's header — it moves. Drag it back onto folder A's own header — **nothing should happen**: no flicker, no reload.
3. **Keyboard drag.** Tab to an unfiled board's grip handle (it appears on focus), press **Space**, then **Down/Up** — the board moves. Press **Space** to drop, **Escape** to cancel. Now do the same on a board **inside** a folder and on one under **Shared with me** — both should move too; before this change all three did nothing.
4. **Keyboard drop onto a folder.** With a board lifted, arrow **up** onto a folder header and press Space. It files.
5. **Hover a collapsed folder mid-drag, then press Escape.** It expands while hovered and **must return to collapsed** after the cancel. Reload — still collapsed. (Before this change, the cancelled drag left it permanently expanded.)
6. **Drop into a collapsed folder.** It expands and stays expanded across a reload — the board you just filed must be visible.
7. **One tab stop per folder header.** Tab through the Boards section: each folder should take **two** stops (the name/chevron disclosure, then its ⋯), not three. The disclosure must show a visible focus ring.
8. **Folder collapse is still instant.** Click a folder chevron — no spinner, no network. Open DevTools → Network and confirm nothing fires.
9. **Rename/delete a folder in two tabs.** Delete it in tab A, then rename it in tab B — tab B must now show **"That folder no longer exists."** instead of silently reporting success.
10. **Workspace switch.** Switch to a workspace where a folder's boards are all elsewhere (the folder hides), switch back — its collapsed/expanded state must be exactly as you left it.
