# Kanban Card Member Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render resolved assignee names on the Kanban card's People/Owner summary by threading the already-present `members` directory from `KanbanBoard` → `KanbanColumnView` → `KanbanCard` → `CellRenderer`, preserving the `members.length === 0` count-fallback.

**Architecture:** Pure client-side prop threading. `members` is already fetched server-side and already passed into `KanbanBoard` (from `BoardViews`). The only change is forwarding it two layers deeper to the leaf `CellRenderer`, which already accepts it and feeds `PeopleCell` (which already resolves names and falls back to a count). No data fetch, no Server Action, no schema, no upstream change. 0 new server round-trips.

**Tech Stack:** Next.js 16 (RSC + client components), React 19, TypeScript (strict), Vitest + Testing Library, @tanstack/react-virtual (already virtualizing the card list).

**Spec:** `docs/superpowers/specs/2026-06-23-kanban-card-member-names-design.md`

---

## File Structure

- **Modify:** `src/components/boards/KanbanBoard.tsx`
  - `KanbanBoard` already receives `members` (L93–96). Update the stale doc-comment (L98–101) and pass `members` into `KanbanColumnView` (the `kanbanColumns.map`, L246–257).
  - `KanbanColumnView` (L264–370): add required `members: EditorMember[]` prop; forward to `KanbanCard` (L347–352).
  - `KanbanCard` (L372–429): add required `members: EditorMember[]` prop; forward to `CellRenderer` as `members={members}` (L417–423).
  - `EditorMember` is already imported at L40 — no new import.
- **Modify (test):** `src/components/boards/KanbanBoard.test.tsx`
  - Extend the fixture to include a `people` column + a people cell value on a visible card.
  - Parameterize `renderKanban` to accept a `members` array.
  - Add three render assertions (names / count-fallback / singular).

No files created. No other files touched. (`PeopleCell`, `CellRenderer`, `memberLabel`, `BoardViews` are already correct — do **not** edit them.)

---

## Execution DAG

Single indivisible task (`T1`). No dependencies, no parallel batches, critical path = T1. **Do not** dispatch parallel agents — there is no concurrency to exploit.

---

### Task 1: Thread `members` to the Kanban card's People summary

**Files:**

- Modify: `src/components/boards/KanbanBoard.tsx` (`KanbanBoard` map L246–257; `KanbanColumnView` L264–370; `KanbanCard` L372–429; doc-comment L98–101)
- Test: `src/components/boards/KanbanBoard.test.tsx`

This task is TDD: write the failing names test first, watch it fail (card shows the count, not the name), then thread the prop, then verify pass + add the fallback/singular guards.

---

- [ ] **Step 1: Extend the test fixture with a people column + cell, and parameterize the render helper**

In `src/components/boards/KanbanBoard.test.tsx`, replace the `payloadFixture` function (currently L76–111) so the `columns` array also contains a `people` column and one card carries a people cell value. Then replace `renderKanban` (currently L113–124) so it accepts a `members` argument.

Replace the `payloadFixture` body's `columns` / `cellValues` so it reads:

```tsx
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
  const owner = {
    id: "owner",
    board_id: "b1",
    org_id: "o1",
    kind: "people",
    name: "Owner",
    position: 1,
    settings: {},
  };
  return {
    board: { id: "b1", org_id: "o1", name: "Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [status, owner],
    items: [
      { id: "i1", name: "Card A", group_id: "g1", position: 0 },
      { id: "i2", name: "Card B", group_id: "g1", position: 1 },
    ],
    cellValues: [
      { item_id: "i1", column_id: "status", value: { optionId: "o1" } },
      { item_id: "i1", column_id: "owner", value: { userIds: ["u1", "u2"] } },
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
```

Replace `renderKanban` with a version that takes `members` (default `[]`, preserving existing callers):

```tsx
type TestMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

function renderKanban(members: TestMember[] = []) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <KanbanBoard
        payload={payloadFixture()}
        selectedViewId="v2"
        members={members}
      />
    </QueryClientProvider>,
  );
}
```

Note: existing tests call `renderKanban()` with no args — the `= []` default keeps them green and exercises the count-fallback path (which is the pre-change behavior), so they will not break when the fixture gains a people column.

- [ ] **Step 2: Write the failing "names render" test**

Add this test inside the `describe("KanbanBoard", …)` block in `src/components/boards/KanbanBoard.test.tsx`:

```tsx
it("renders assignee names on the card when a member directory is provided", () => {
  renderKanban([
    {
      userId: "u1",
      fullName: "Ada Lovelace",
      email: "ada@x.com",
      avatarUrl: null,
    },
    { userId: "u2", fullName: null, email: "grace@x.com", avatarUrl: null },
  ]);
  // fullName for u1, email fallback for u2, joined with ", "
  expect(screen.getByText("Ada Lovelace, grace@x.com")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the new test to verify it FAILS**

Run: `pnpm test -- KanbanBoard --run -t "renders assignee names on the card"`

Expected: FAIL. The card currently calls `CellRenderer` without `members`, so `PeopleCell` hits the `members.length === 0` branch and renders `"2 people"` — the query for `"Ada Lovelace, grace@x.com"` finds no element.

- [ ] **Step 4: Thread `members` — update the `KanbanBoard` map and doc-comment**

In `src/components/boards/KanbanBoard.tsx`, first replace the stale doc-comment on the `members` prop (currently L98–101) so it reflects the new behavior:

```tsx
  // Org member directory, threaded down to each card's read-only People
  // summary so it renders resolved assignee names (full name → email), with a
  // count-fallback when the directory is empty — matching the Table cell.
  members?: EditorMember[];
```

Then, in the `kanbanColumns.map((col) => …)` JSX (currently L246–257), pass `members` into `KanbanColumnView`:

```tsx
{
  kanbanColumns.map((col) => (
    <KanbanColumnView
      key={col.id}
      column={col}
      cellMap={cellMap}
      summaryColumns={summaryColumns}
      members={members}
      firstGroupId={firstGroupId}
      groupColumnId={groupColumn.id}
      addItem={addItem}
      setCell={setCell}
    />
  ));
}
```

- [ ] **Step 5: Add the `members` prop to `KanbanColumnView` and forward it to `KanbanCard`**

In the `KanbanColumnView` function signature (currently L264–286), add `members` to both the destructure and the prop type:

```tsx
function KanbanColumnView({
  column,
  cellMap,
  summaryColumns,
  members,
  firstGroupId,
  groupColumnId,
  addItem,
  setCell,
}: {
  column: KanbanColumn;
  cellMap: Map<string, CacheCellValue["value"]>;
  summaryColumns: CacheColumn[];
  members: EditorMember[];
  firstGroupId: string | undefined;
  groupColumnId: string;
  addItem: (
    vars: { groupId: string; name: string },
    callbacks?: {
      onSuccess?: (item: CacheItem) => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  setCell: SetCell;
}) {
```

Then in the `KanbanCard` usage inside `KanbanColumnView` (currently L347–352), pass `members`:

```tsx
<KanbanCard
  item={card}
  fromColId={column.id}
  cellMap={cellMap}
  summaryColumns={summaryColumns}
  members={members}
/>
```

- [ ] **Step 6: Add the `members` prop to `KanbanCard` and feed it to `CellRenderer`**

In the `KanbanCard` function signature (currently L372–382), add `members`:

```tsx
function KanbanCard({
  item,
  fromColId,
  cellMap,
  summaryColumns,
  members,
}: {
  item: CacheItem;
  fromColId: string;
  cellMap: Map<string, CacheCellValue["value"]>;
  summaryColumns: CacheColumn[];
  members: EditorMember[];
}) {
```

Then in the `summaryColumns.map` → `CellRenderer` call inside `KanbanCard` (currently L417–423), pass `members`:

```tsx
<CellRenderer
  key={col.id}
  kind={col.kind}
  value={value}
  settings={(col.settings ?? {}) as Settings}
  members={members}
/>
```

- [ ] **Step 7: Run the names test to verify it PASSES**

Run: `pnpm test -- KanbanBoard --run -t "renders assignee names on the card"`

Expected: PASS. `members` now reaches `PeopleCell`, which resolves `u1` → `"Ada Lovelace"` (fullName) and `u2` → `"grace@x.com"` (email fallback), joined as `"Ada Lovelace, grace@x.com"`.

- [ ] **Step 8: Add the count-fallback (no-regression) test**

Add inside the `describe` block:

```tsx
it("falls back to a people count on the card when no directory is provided", () => {
  renderKanban([]); // empty directory
  expect(screen.getByText("2 people")).toBeInTheDocument();
  expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
});
```

- [ ] **Step 9: Add the singular-grammar edge test**

This needs a card with exactly one assignee. Add a focused test that renders with an empty directory and asserts the singular form via a one-assignee fixture override. Add inside the `describe` block:

```tsx
it("uses singular 'person' for a single assignee in the count-fallback", () => {
  const qc = new QueryClient();
  const payload = payloadFixture() as unknown as {
    cellValues: Array<{ item_id: string; column_id: string; value: unknown }>;
  };
  // Override card i1's owner cell to a single assignee.
  payload.cellValues = payload.cellValues.map((c) =>
    c.column_id === "owner" ? { ...c, value: { userIds: ["u1"] } } : c,
  );
  render(
    <QueryClientProvider client={qc}>
      <KanbanBoard
        payload={payload as never}
        selectedViewId="v2"
        members={[]}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText("1 person")).toBeInTheDocument();
});
```

- [ ] **Step 10: Run the full Kanban suite**

Run: `pnpm test -- KanbanBoard --run`

Expected: PASS — all three new tests plus the existing Kanban tests (existing tests still call `renderKanban()` with the `= []` default, so they exercise the unchanged count-fallback path and stay green).

- [ ] **Step 11: Run the full gate suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

Expected: all four pass. (`typecheck` confirms the new required `members` props are satisfied at every call site; `build` confirms no client/server boundary regressions.)

- [ ] **Step 12: Commit**

Stage **only** the two files you changed (never `git add -A`):

```bash
git add src/components/boards/KanbanBoard.tsx src/components/boards/KanbanBoard.test.tsx
git commit -m "feat(kanban): render assignee names on card People summary"
```

(Commit identity is pinned by the worktree to `Danijel Jovanovic <info@synapse-solutions.ai>` — do not override.)

---

## Self-Review

- **Spec coverage:**
  - Names render on card → Steps 2–7. ✅
  - Count-fallback preserved → Step 8. ✅
  - Singular grammar → Step 9. ✅
  - 0 round-trips / no upstream change → no task touches `BoardViews` or any fetch; `members` is threaded, not fetched. ✅
  - Stale doc-comment update → Step 4. ✅
  - Non-goals (no avatars, no editing, no `PeopleCell`/`CellRenderer`/`BoardViews` edits) → no task touches them. ✅
- **Placeholder scan:** none — every code step shows full code; every run step shows the exact command + expected result.
- **Type consistency:** `members: EditorMember[]` (required) used identically in `KanbanColumnView` and `KanbanCard`; `EditorMember` already imported (L40); test uses a structurally-matching `TestMember` shape. Public `KanbanBoard` prop keeps `members?: EditorMember[]` with its `= []` default (Step 4 only edits the doc-comment, not the optionality).

---

## How to test this (manual, post-merge)

User-observable change. After this merges to `develop` (pull `develop`):

1. Open a board that has a **Status** column (so Kanban is available) and a **People** (Owner) column, with at least one item assigned to one or more org members.
2. Switch to the **Kanban** view (Views → Kanban) and ensure it's grouped by the Status column.
3. On a card whose item has assignees, look at the summary row beneath the card title.
   - **Before:** it read `"1 person"` / `"2 people"` (a count).
   - **After:** it reads the assignees' **names**, e.g. `"Ada Lovelace, Grace Hopper"` (full name, falling back to email if a member has no name), comma-separated — matching what the Table view's Owner cell shows for the same item.
4. (Optional, parity check) Switch to the **Table** view: the same item's Owner cell shows the same names. The two views now agree.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-23-kanban-card-member-names.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent for Task 1, review between TDD steps, fast iteration.

**2. Inline Execution** — execute Task 1 in this session via executing-plans, with a checkpoint before the gate run.

Given this is a single small task, inline execution is reasonable; subagent-driven still applies if delegating to conserve context.
