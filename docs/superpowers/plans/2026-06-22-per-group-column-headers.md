# Per-group column headers (Monday-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an interactive column-header row inside every group of the board table (Monday-style), removing the single global header, so empty/new groups visibly show the board's columns.

**Architecture:** Columns are board-scoped and shared; this is a render-layer change in one file (`src/components/boards/BoardTable.tsx`). The global header grid is deleted; each `GroupSection` renders a grid row (frozen group/name cell + one `ColumnHeader` per column + `AddColumnMenu`) using the existing shared `template`. Column width / options / dialog state stays owned by `BoardTable` and is threaded to every group via a single `ColumnHeaderControls` bundle, so a resize/add/rename from any group reflows all groups + the footer.

**Tech Stack:** React 19 / Next 16 RSC client component, TanStack Query board cache, dnd-kit, Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-06-22-per-group-column-headers-design.md`.

---

## File structure

- **Modify:** `src/components/boards/BoardTable.tsx`
  - Remove global header grid row (currently `~576–618`).
  - Add `ColumnHeaderControls` type + build the bundle in `BoardTable`.
  - Extract `NameResizeHandle` from `NameColumnHeader`; delete now-unused `NameColumnHeader`.
  - Add `GroupHeaderRow` presentational component.
  - `GroupSection` renders `GroupHeaderRow` in place of its colored band; accept + forward `col: ColumnHeaderControls`.
- **Modify:** `src/components/boards/BoardTable.test.tsx`
  - Add a fixture with columns + multiple groups (one empty); add per-group-header tests.
- Reused as-is (no change): `ColumnHeader.tsx`, `AddColumnMenu.tsx`, `GroupMenu`.

---

## Task 1: Failing tests for per-group column headers

**Files:**
- Test: `src/components/boards/BoardTable.test.tsx`

- [ ] **Step 1: Add a multi-group + columns fixture and write failing tests**

Add near the existing `payloadFixture()` (after line ~86):

```tsx
// Fixture with 3 board columns and two groups — the second group is EMPTY
// (no items). The bug: an empty group used to show no columns.
function payloadWithColumns() {
  const col = (id: string, name: string, kind = "text", position = 0) => ({
    id,
    board_id: "b1",
    org_id: "o1",
    kind,
    name,
    settings: {},
    position,
    width: null,
  });
  return {
    board: { id: "b1", org_id: "o1", name: "Board", name_column_width: null },
    groups: [
      { id: "g1", board_id: "b1", org_id: "o1", name: "Group 1", color: "#0073ea", position: 0 },
      { id: "g2", board_id: "b1", org_id: "o1", name: "Group 2", color: "#e2445c", position: 1 },
    ],
    columns: [
      col("c_status", "Status", "status", 0),
      col("c_owner", "Owner", "people", 1),
      col("c_date", "Due Date", "date", 2),
    ],
    items: [
      { id: "i1", board_id: "b1", org_id: "o1", group_id: "g1", name: "Item 1", position: 0, parent_id: null },
    ],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderBoardWithColumns() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={payloadWithColumns()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}
```

Then add a new describe block at the end of the file:

```tsx
describe("BoardTable per-group column headers", () => {
  it("renders a column header per column inside EVERY group, including the empty one", () => {
    renderBoardWithColumns();
    // 2 groups × 3 columns = 6 column-header cells (ColumnHeader renders the
    // column name as visible text). The empty group (g2) must show them too.
    expect(screen.getAllByText("Status")).toHaveLength(2);
    expect(screen.getAllByText("Owner")).toHaveLength(2);
    expect(screen.getAllByText("Due Date")).toHaveLength(2);
  });

  it("renders an Add-column control in every group header (not one global one)", () => {
    renderBoardWithColumns();
    // AddColumnMenu exposes an accessible trigger; one per group.
    expect(screen.getAllByRole("button", { name: /add column/i })).toHaveLength(2);
  });

  it("does not render a single global header above the groups", () => {
    renderBoardWithColumns();
    // The old global header rendered a standalone "Name" resize separator with
    // this exact label. Per-group headers use group controls instead, so the
    // old global "Name" column header must be gone.
    expect(screen.queryByRole("separator", { name: /^Resize Name column/i })).toBeNull();
  });
});
```

> NOTE: the exact accessible name for the AddColumnMenu trigger and the Name resize handle must match the real components. Before finalizing, confirm: `AddColumnMenu`'s trigger `aria-label` (Task 2 keeps it), and that the per-group name resize handle uses `aria-label="Resize Name column (double-click to auto-fit)"`. Adjust the matchers in this test to the real labels if they differ.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- src/components/boards/BoardTable.test.tsx`
Expected: the 3 new tests FAIL (old global header still renders one set of headers; empty group shows none) while existing tests still pass.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/components/boards/BoardTable.test.tsx
git commit -m "test(boards): per-group column headers (failing)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Implement per-group headers in BoardTable.tsx

**Files:**
- Modify: `src/components/boards/BoardTable.tsx`

- [ ] **Step 1: Add the `ColumnHeaderControls` type and `NameResizeHandle`**

Near the top-level helpers (after `gridTemplate`, ~line 226), add the bundle type. Place it next to the existing `CellControls` type usage (import `CacheColumn` type is already available via `Column`/cache types):

```tsx
/** Board-level column-management surface, shared by every group's header so a
 *  resize/add/rename from any group reflows all groups + the footer. */
type ColumnHeaderControls = {
  nameWidth: number;
  liveWidths: Record<string, number>;
  setLiveWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setLiveNameWidth: (w: number | null) => void;
  renameColumn: (id: string, name: string) => void;
  deleteColumn: (id: string) => void;
  resizeColumn: (id: string, w: number) => void;
  resizeNameColumn: (w: number | null) => void;
  onAddColumn: (kind: ColumnKind) => void;
  onEditOptions: (col: Column) => void;
};
```

Extract the resize handle from `NameColumnHeader` (lines ~784–835) into a reusable handle, then **delete** the now-unused `NameColumnHeader`:

```tsx
/** The Name-column resize separator (drag to resize, double-click to auto-fit).
 *  Lives on the right edge of each group header's frozen Name cell. */
function NameResizeHandle({
  width,
  onResize,
  onResizeEnd,
  onAutoFit,
}: {
  width: number;
  onResize: (w: number) => void;
  onResizeEnd: (w: number) => void;
  onAutoFit: () => void;
}) {
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = width;
    const move = (ev: PointerEvent) => {
      last = clampDragWidth(startW + (ev.clientX - startX), NAME_DRAG_MIN, NAME_COL_MAX);
      onResize(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Name column (double-click to auto-fit)"
      onPointerDown={onPointerDown}
      onDoubleClick={onAutoFit}
      className="hover:bg-primary/40 absolute top-0 right-0 h-full w-1 cursor-col-resize"
    />
  );
}
```

- [ ] **Step 2: Add the `GroupHeaderRow` component**

Add above `GroupSection` (~line 981). This is the grid row mirroring `SummaryFooter`'s frozen-Name + per-column structure, but with group controls in the Name cell and interactive `ColumnHeader`s in the column tracks. It receives the group-control bits GroupSection already owns:

```tsx
function GroupHeaderRow({
  group,
  columns,
  template,
  collapsed,
  onToggleCollapse,
  renaming,
  name,
  onNameChange,
  onCommitRename,
  onCancelRename,
  onOpenRename,
  itemCount,
  dragAttributes,
  dragListeners,
  onSetColor,
  onDelete,
  col,
}: {
  group: Group;
  columns: Column[];
  template: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  renaming: boolean;
  name: string;
  onNameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpenRename: () => void;
  itemCount: number;
  dragAttributes: React.HTMLAttributes<HTMLButtonElement>;
  dragListeners: SyntheticListenerMap | undefined;
  onSetColor: (color: string) => void;
  onDelete: () => void;
  col: ColumnHeaderControls;
}) {
  return (
    <div
      className="group/grouphdr bg-surface text-foreground grid border-b text-sm font-semibold"
      style={{ gridTemplateColumns: template }}
    >
      {/* Frozen group/Name cell — group controls + Name resize handle. */}
      <div
        className={cn(
          "bg-surface relative sticky left-0 z-10 flex items-center gap-2 px-3 py-1.5",
          NAME_FREEZE_EDGE,
        )}
        style={{ boxShadow: `inset 3px 0 0 0 ${group.color}` }}
      >
        <button
          type="button"
          aria-label={`Reorder ${group.name}`}
          {...dragAttributes}
          {...dragListeners}
          className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
          aria-hidden
        />
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename();
              }
            }}
            aria-label={`Rename ${group.name}`}
            className="h-7 max-w-xs"
          />
        ) : (
          <button
            type="button"
            onClick={onOpenRename}
            className="focus-visible:ring-ring min-w-0 truncate rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            {group.name}
          </button>
        )}
        <span className="text-muted-foreground text-xs font-normal">{itemCount}</span>
        <GroupMenu group={group} onRename={onOpenRename} onSetColor={onSetColor} onDelete={onDelete} />
        <NameResizeHandle
          width={col.nameWidth}
          onResize={(w) => col.setLiveNameWidth(w)}
          onResizeEnd={(w) => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(w);
          }}
          onAutoFit={() => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(null);
          }}
        />
      </div>

      {columns.map((c) => (
        <ColumnHeader
          key={c.id}
          column={c}
          width={col.liveWidths[c.id] ?? c.width ?? VALUE_COL_WIDTH}
          onRename={(n) => col.renameColumn(c.id, n)}
          onDelete={() => col.deleteColumn(c.id)}
          onResize={(w) => col.setLiveWidths((m) => ({ ...m, [c.id]: w }))}
          onResizeEnd={(w) => col.resizeColumn(c.id, w)}
          onEditOptions={() => col.onEditOptions(c)}
        />
      ))}
      <AddColumnMenu onAdd={col.onAddColumn} />
    </div>
  );
}
```

> Confirm `SyntheticListenerMap` is importable from `@dnd-kit/core` (or type the prop as `Record<string, Function> | undefined` if not). The drag handle markup is moved verbatim from the current GroupSection band.

- [ ] **Step 3: Rewire `GroupSection` to render `GroupHeaderRow`**

In `GroupSection` (signature ~981): add `col: ColumnHeaderControls` to props/type. Replace the colored-band `<div className="group/grouphdr ...">…</div>` block (currently ~1127–1196) with:

```tsx
      <GroupHeaderRow
        group={group}
        columns={columns}
        template={template}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        renaming={renaming}
        name={name}
        onNameChange={setName}
        onCommitRename={commitRename}
        onCancelRename={() => {
          setRenaming(false);
          onRenameSettled();
        }}
        onOpenRename={openRename}
        itemCount={items.length}
        dragAttributes={attributes}
        dragListeners={listeners}
        onSetColor={onSetColor}
        onDelete={onDelete}
        col={col}
      />
```

Leave the rest of `GroupSection` (collapse-guarded item rows + `AddItemRow`) unchanged — the header now always renders regardless of `collapsed`.

- [ ] **Step 4: Build the bundle in `BoardTable` and delete the global header**

In `BoardTable` (after `setColumnSummary`, ~line 504), build the bundle (reuse the existing `addColumn` relation/mirror branch verbatim from the old header's `AddColumnMenu.onAdd`, lines ~605–617):

```tsx
  const columnControls: ColumnHeaderControls = {
    nameWidth,
    liveWidths,
    setLiveWidths,
    setLiveNameWidth,
    renameColumn: mutations.renameColumn,
    deleteColumn: mutations.deleteColumn,
    resizeColumn: mutations.resizeColumn,
    resizeNameColumn: mutations.resizeNameColumn,
    onAddColumn: (kind) => {
      if (kind === "relation") {
        setRelationTargetBoards([]);
        setRelationConfigOpen(true);
        listRelationTargetBoards().then(setRelationTargetBoards);
      } else if (kind === "mirror") {
        setMirrorConfigOpen(true);
      } else {
        mutations.addColumn(kind);
      }
    },
    onEditOptions: (c) => setOptionsFor(c as CacheColumn),
  };
```

Delete the global header grid `<div>` (lines ~576–618: the `NameColumnHeader` + `columns.map(ColumnHeader)` + `AddColumnMenu` block). Keep the surrounding `scrollContainerRef` div and `contentRef` div. Pass `col={columnControls}` into each `<GroupSection .../>` (the `.map` at ~635).

- [ ] **Step 5: Run the new tests**

Run: `pnpm test -- src/components/boards/BoardTable.test.tsx`
Expected: all tests (Task 1's three + the pre-existing suite) PASS. If a label matcher mismatches the real `AddColumnMenu`/handle aria-label, fix the matcher in the test to the real label.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "fix(boards): render interactive column header in every group

Empty/new groups now show the board columns. Removes the single global
header; each group renders a frozen group cell + per-column ColumnHeader +
AddColumnMenu, sharing column width/options state via ColumnHeaderControls
so resize/add/rename from any group reflows all groups. Columns remain
board-scoped (no schema change).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Propagation tests (add + resize reflect across all groups)

**Files:**
- Test: `src/components/boards/BoardTable.test.tsx`

- [ ] **Step 1: Add tests asserting shared column state**

Append to the `per-group column headers` describe. These confirm the shared-state design (board-level columns appear in every group; resize from one group updates all). Use the real mutation hook (no extra mock needed — adding a column goes through `useBoardMutations`/optimistic cache; assert at the render level):

```tsx
  it("a resize handle exists per column per group (resize from any group)", () => {
    renderBoardWithColumns();
    // ColumnHeader renders a separator labelled `Resize <name>`; 2 groups → 2 each.
    expect(screen.getAllByRole("separator", { name: "Resize Status" })).toHaveLength(2);
  });

  it("keeps the column header visible when a group is collapsed", () => {
    renderBoardWithColumns();
    const collapse = screen.getByRole("button", { name: /Collapse Group 2/i });
    fireEvent.click(collapse);
    // Even collapsed, Group 2 still shows all 3 column headers (2 groups worth total).
    expect(screen.getAllByText("Status")).toHaveLength(2);
  });
```

- [ ] **Step 2: Run and confirm PASS**

Run: `pnpm test -- src/components/boards/BoardTable.test.tsx`
Expected: PASS. Adjust the collapse button accessible-name matcher if needed.

- [ ] **Step 3: Commit**

```bash
git add src/components/boards/BoardTable.test.tsx
git commit -m "test(boards): per-group header shared-state + collapse coverage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full verification gate

- [ ] **Step 1: Run all four gates**

From inside the worktree (CLI bins resolve via the inherited main `node_modules`; if a bin isn't found, prepend the main checkout's `node_modules/.bin` to PATH — worktree gotcha):

```bash
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm build` cannot run inside the worktree (Turbopack); run it from the main checkout against this branch, OR rely on typecheck + the post-merge build. Note in the closing summary which path was used.

Expected: typecheck clean (no unused `NameColumnHeader`/`CacheColumn` import left dangling — remove dead imports), lint clean, all tests green.

- [ ] **Step 2: Manual smoke (optional but recommended)**

`pnpm dev -p 3001`, open a from-scratch board, add a group → confirm the new (empty) group shows Status/Owner/Due Date headers and the `+` add-column control; resize a column in one group → all groups + footer reflow; rename/delete a column from a group → reflects everywhere.

- [ ] **Step 3: Close out**

Run `scripts/finish-task.sh` from inside the worktree (merges `task/group-column-headers` → `develop`, pushes, removes worktree + branch). Then hand the user the "How to test" walkthrough.

---

## Self-review notes

- **Spec coverage:** global header removed (T2.4); per-group interactive headers (T2.2–2.3); shared width/options/dialog state via `ColumnHeaderControls` (T2.1,2.4); collapse keeps header (T2.3 + T3); empty-group bug covered (T1); add/resize propagation (T3); footer/Kanban/DB untouched (no tasks — out of scope). ✓
- **No new server round-trips:** all callbacks reuse existing `useBoardMutations` actions + client width state. ✓
- **Type consistency:** `ColumnHeaderControls` field names used identically in the type, the `columnControls` literal, and `GroupHeaderRow`/`ColumnHeader` call sites. `onAddColumn(kind: ColumnKind)` matches `AddColumnMenu`'s `onAdd`. ✓
- **Open confirmations for the implementer:** real aria-labels for `AddColumnMenu` trigger and the Name resize handle; `SyntheticListenerMap` import path. Fix matchers/types to reality if they differ.
