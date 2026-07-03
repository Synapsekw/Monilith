# Column Reordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI styling steps must load the `pulse-ui` skill first.

**Goal:** Drag-to-reorder board columns in the Table view (grip on each column header + "Move left/right" menu items), Name column immovable at position 0, persisted via one Server Action with optimistic reorder and free realtime propagation.

**Architecture:** `columns.position` (float8, midpoint scheme) already exists and every consumer (payload query, client cache sort, realtime fold, kanban/gantt/export) already orders by it — **no migration, no `pnpm db:types`**. We add: a `reorderColumn` Server Action mirroring `reorderItem`; an optimistic `reorderColumnMutation` (the cache's `replaceColumn` re-sorts, so the whole table reflows in one render); a per-group-header `DndContext`/`SortableContext` over the data columns only (the frozen Name cell, Created-by/at cells, and AddColumnMenu stay outside → Name is immovable by construction); and reorder affordances on `ColumnHeader` (hover-reveal grip + Move left/right menu items) behind an optional prop so the component stays presentational.

**Tech Stack:** Next.js 16 RSC + client components, Supabase (RLS), Zod, TanStack Query, `@dnd-kit/core`/`sortable`/`modifiers`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-03-column-reorder-design.md`

## Global Constraints

- Gotcha-09 budget: drag = client state only; drop = **exactly one** Server Action (single-row PK `UPDATE`); no RSC navigation/refetch; `revalidatePath` only (next render).
- 0 new first-paint round-trips (position is already in the board payload).
- Styling: semantic tokens only (`text-muted-foreground`, `bg-surface`, `ring-ring`…); lucide icons; touch = shared `useTouchAwareSensors` + 44px coarse-pointer targets (`pointer-coarse:size-11 pointer-coarse:opacity-100`); `touch-none` on drag handles.
- Translate-only drag transform (`CSS.Translate.toString`) — never scale/stretch grid tracks (gotcha-20).
- Commits: stage explicitly by path (never `git add -A`), lowercase conventional subject, descriptive body, end body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Line numbers below are approximate — verify anchors before editing.

---

## Task 1: `reorderColumn` Server Action + validation schema

**Files:**

- Modify: `src/lib/validations/board-actions.ts` (after `resizeColumnSchema`, ~line 66)
- Modify: `src/lib/validations/board-actions.test.ts`
- Modify: `src/lib/boards/actions.ts` (after `resizeColumn`, ~line 753)
- Test: `src/lib/boards/column-actions.test.ts`

**Interfaces:**

- Consumes: existing `fail`, `ActionResult`, `createClient`, `revalidatePath` conventions in `actions.ts`; `uuid` helper in `board-actions.ts`.
- Produces: `reorderColumnSchema = z.object({ columnId: uuid, position: z.number() })` exported from `@/lib/validations/board-actions`; `export async function reorderColumn(input: { columnId: string; position: number }): Promise<ActionResult>` exported from `@/lib/boards/actions` (Task 3 imports it).

- [ ] **Step 1: Write the failing validation test**

Append to `src/lib/validations/board-actions.test.ts` (reuse the file's existing `UUID` const; add `reorderColumnSchema` to the import list from `./board-actions`):

```ts
describe("reorderColumnSchema", () => {
  it("accepts a fractional position", () => {
    expect(
      reorderColumnSchema.safeParse({ columnId: UUID, position: 2.5 }).success,
    ).toBe(true);
  });

  it("rejects a non-numeric position and a non-uuid id", () => {
    expect(
      reorderColumnSchema.safeParse({ columnId: UUID, position: "x" }).success,
    ).toBe(false);
    expect(
      reorderColumnSchema.safeParse({ columnId: "nope", position: 1 }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing action tests**

Append to `src/lib/boards/column-actions.test.ts` (the file already mocks `@/lib/supabase/server`'s `createClient` via the `from` spy and mocks `next/cache`; add `reorderColumn` to the import from `@/lib/boards/actions`):

```ts
describe("reorderColumn", () => {
  it("updates position in a single query and revalidates the board", async () => {
    const eqSelect = {
      select: () => ({
        maybeSingle: async () => ({ data: { board_id: BOARD }, error: null }),
      }),
    };
    const update = vi.fn().mockReturnValue({ eq: () => eqSelect });
    from.mockImplementation((t: string) => (t === "columns" ? { update } : {}));

    const res = await reorderColumn({ columnId: COL, position: 1.5 });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({ position: 1.5 });
    expect(from).toHaveBeenCalledTimes(1); // no separate board lookup
  });

  it("rejects invalid input before any db call", async () => {
    const res = await reorderColumn({ columnId: COL, position: "x" as never });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails when the column is not visible/found", async () => {
    const eqSelect = {
      select: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    };
    const update = vi.fn().mockReturnValue({ eq: () => eqSelect });
    from.mockImplementation((t: string) => (t === "columns" ? { update } : {}));

    const res = await reorderColumn({ columnId: COL, position: 1 });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `pnpm test -- board-actions.test.ts column-actions.test.ts`
Expected: FAIL — `reorderColumnSchema` / `reorderColumn` are not exported.

- [ ] **Step 4: Add the schema**

In `src/lib/validations/board-actions.ts`, directly after `resizeColumnSchema`:

```ts
export const reorderColumnSchema = z.object({
  columnId: uuid,
  position: z.number(),
});
```

- [ ] **Step 5: Add the action**

In `src/lib/boards/actions.ts`, add `reorderColumnSchema` to the existing import from `@/lib/validations/board-actions`, then insert after `resizeColumn` (~line 753). Same one-round-trip shape as `reorderItem` (update returning `board_id`) — do NOT use the two-query `columnBoardId` helper:

```ts
/** Update a column's position (header drag-reorder / Move left-right). */
export async function reorderColumn(input: {
  columnId: string;
  position: number;
}): Promise<ActionResult> {
  const parsed = reorderColumnSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("columns")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.columnId)
    .select("board_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Column not found.");

  revalidatePath(`/boards/${data.board_id}`);
  return { ok: true, data: undefined };
}
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm test -- board-actions.test.ts column-actions.test.ts`
Expected: PASS (new tests green, pre-existing suite untouched). Note: the mock chain in Step 2 is `update().eq().select().maybeSingle()` — if the real call order differs after implementation, fix the mock to mirror the implementation, not vice versa.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validations/board-actions.ts src/lib/validations/board-actions.test.ts src/lib/boards/actions.ts src/lib/boards/column-actions.test.ts
git commit -m "feat(boards): reorder-column server action

Single-row position UPDATE mirroring reorderItem (Zod boundary, RLS
security, one round trip returning board_id, targeted revalidatePath).
No schema change: columns.position (float8 midpoint) already exists.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Reorder affordances on `ColumnHeader` (presentational)

**Files:**

- Modify: `src/components/boards/ColumnHeader.tsx`
- Test: `src/components/boards/ColumnHeader.test.tsx`

> Load the `pulse-ui` skill before styling. Chrome stays monochrome; no new tokens.

**Interfaces:**

- Consumes: nothing from other tasks (callbacks are plain props).
- Produces: exported type `ColumnReorder` and a new optional `reorder?: ColumnReorder` prop on `ColumnHeader`:

```ts
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";

export type ColumnReorder = {
  setNodeRef: (el: HTMLDivElement | null) => void;
  style: React.CSSProperties; // translate-only transform + transition
  isDragging: boolean;
  handleAttributes: DraggableAttributes;
  handleListeners: DraggableSyntheticListeners;
  onMoveLeft: (() => void) | null; // null = disabled (first data column)
  onMoveRight: (() => void) | null; // null = disabled (last data column)
};
```

When `reorder` is omitted, rendering is byte-identical to today (existing tests must keep passing unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `src/components/boards/ColumnHeader.test.tsx` (reuse the file's `col()` fixture; import `type ColumnReorder` from the component):

```tsx
function reorder(over: Partial<ColumnReorder> = {}): ColumnReorder {
  return {
    setNodeRef: () => {},
    style: {},
    isDragging: false,
    handleAttributes: {} as ColumnReorder["handleAttributes"],
    handleListeners: undefined,
    onMoveLeft: vi.fn(),
    onMoveRight: vi.fn(),
    ...over,
  };
}

describe("ColumnHeader reorder affordances", () => {
  const base = {
    width: 180,
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onResize: vi.fn(),
    onResizeEnd: vi.fn(),
  };

  it("renders a reorder grip when reorder props are provided", () => {
    render(<ColumnHeader column={col()} {...base} reorder={reorder()} />);
    expect(
      screen.getByRole("button", { name: "Reorder Notes column" }),
    ).toBeInTheDocument();
  });

  it("renders no grip and no move items without reorder props", () => {
    render(<ColumnHeader column={col()} {...base} />);
    expect(
      screen.queryByRole("button", { name: "Reorder Notes column" }),
    ).toBeNull();
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    expect(screen.queryByText("Move left")).toBeNull();
  });

  it("fires onMoveRight from the menu", () => {
    const onMoveRight = vi.fn();
    render(
      <ColumnHeader
        column={col()}
        {...base}
        reorder={reorder({ onMoveRight })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    fireEvent.click(screen.getByText("Move right"));
    expect(onMoveRight).toHaveBeenCalledTimes(1);
  });

  it("disables Move left at the left edge", () => {
    render(
      <ColumnHeader
        column={col()}
        {...base}
        reorder={reorder({ onMoveLeft: null })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    expect(
      screen.getByText("Move left").closest("[role=menuitem]"),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test -- ColumnHeader`
Expected: FAIL — `ColumnReorder` not exported, no `reorder` prop, grip/menu items missing.

- [ ] **Step 3: Implement**

In `src/components/boards/ColumnHeader.tsx`:

a) Imports — add `GripVertical` to the lucide import, `DropdownMenuSeparator` to the dropdown-menu import, `cn` from `@/lib/utils`, and the dnd-kit types; add the exported `ColumnReorder` type from the Interfaces block above.

b) Props — add `reorder?: ColumnReorder;` to the props type and destructure it.

c) Root div (currently `<div className="group/col relative flex items-center gap-1 border-l px-3 py-1.5">`) becomes:

```tsx
    <div
      ref={reorder?.setNodeRef}
      style={reorder?.style}
      className={cn(
        "group/col relative flex items-center gap-1 border-l px-3 py-1.5",
        reorder?.isDragging && "bg-surface z-auto shadow-lg",
      )}
    >
```

(The container is already `relative`; positioned + `shadow-lg` lifts it above sibling headers while staying below the `z-10` sticky frozen Name cell.)

d) Grip — inside the non-editing branch, immediately BEFORE the `<span className="truncate">{column.name}</span>`:

```tsx
{
  reorder && (
    <button
      type="button"
      aria-label={`Reorder ${column.name} column`}
      {...reorder.handleAttributes}
      {...(reorder.handleListeners ?? {})}
      className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/col:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}
```

e) Menu — inside `<DropdownMenuContent align="end">`, ABOVE the existing "Edit labels" / "Rename" items:

```tsx
{
  reorder && (
    <>
      <DropdownMenuItem
        disabled={!reorder.onMoveLeft}
        onSelect={() => reorder.onMoveLeft?.()}
      >
        Move left
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!reorder.onMoveRight}
        onSelect={() => reorder.onMoveRight?.()}
      >
        Move right
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- ColumnHeader`
Expected: PASS — 4 new tests green AND every pre-existing ColumnHeader test still green (no-`reorder` renders are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/ColumnHeader.tsx src/components/boards/ColumnHeader.test.tsx
git commit -m "feat(boards): reorder grip + move left/right menu on column header

Presentational only, behind an optional reorder prop so the component
and its existing tests are unchanged when the prop is omitted. Grip
follows the shipped touch ergonomics (hover-reveal, touch-none, 44px
always-visible target on coarse pointers); menu items are the
keyboard/no-drag path, disabled at the edges.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Optimistic `reorderColumn` mutation

**Files:**

- Modify: `src/lib/boards/use-board-mutations.ts`
- Test: `src/lib/boards/use-board-mutations.test.tsx`

**Interfaces:**

- Consumes: `reorderColumn(input: { columnId: string; position: number }): Promise<ActionResult>` from `@/lib/boards/actions` (Task 1); existing `optimisticColumn(columnId, change)` helper, `Ctx` type, `showMutationError`.
- Produces: `reorderColumn: (columnId: string, position: number) => void` on the object returned by `useBoardMutations` (Task 4 consumes it).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/boards/use-board-mutations.test.tsx`, modeled on the existing `useBoardMutations.reorderGroup` describe (~line 451). Add `reorderColumn` to the file's existing `vi.mock("@/lib/boards/actions", …)` factory and mocked-import list, and reuse the file's cache-seeding pattern — seed two columns `c1` (position 0) and `c2` (position 1) the same way `seedGroups` seeds groups (copy its shape; columns need `id/org_id/board_id/kind/name/settings/position/width/created_at/updated_at`):

```tsx
describe("useBoardMutations.reorderColumn", () => {
  beforeEach(() => reorderColumn.mockReset());

  it("optimistically moves the column and re-sorts", async () => {
    const qc = new QueryClient();
    seedColumns(qc); // c1 @ 0, c2 @ 1
    reorderColumn.mockResolvedValue({ ok: true, data: undefined });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });
    act(() => result.current.reorderColumn("c2", -1)); // drop c2 before c1

    const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
    expect(cache.columns.map((c) => c.id)).toEqual(["c2", "c1"]);
    await waitFor(() =>
      expect(reorderColumn).toHaveBeenCalledWith({
        columnId: "c2",
        position: -1,
      }),
    );
  });

  it("rolls back on failure", async () => {
    const qc = new QueryClient();
    seedColumns(qc);
    reorderColumn.mockResolvedValue({ ok: false, error: "nope" });

    const { result } = renderHook(() => useBoardMutations("b1"), {
      wrapper: wrapper(qc),
    });
    act(() => result.current.reorderColumn("c2", -1));

    await waitFor(() => {
      const cache = qc.getQueryData<BoardCache>(boardKey("b1"))!;
      expect(cache.columns.map((c) => c.id)).toEqual(["c1", "c2"]);
    });
  });
});
```

(Match the file's actual `renderHook`/`wrapper`/`act` helper names — mirror the `reorderGroup` describe verbatim; a toast mock already exists in the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- use-board-mutations`
Expected: FAIL — `result.current.reorderColumn` is not a function.

- [ ] **Step 3: Implement the mutation**

In `src/lib/boards/use-board-mutations.ts`: add `reorderColumn` to the existing import from `@/lib/boards/actions`. Insert after `resizeColumnMutation` (~line 349), mirroring it exactly:

```ts
const reorderColumnMutation = useMutation<
  unknown,
  Error,
  { columnId: string; position: number },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await reorderColumn(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  // replaceColumn re-sorts by position, so this one patch reflows every
  // group header, row, and the footer immediately.
  onMutate: (vars) => {
    return optimisticColumn(vars.columnId, { position: vars.position });
  },
  onError: (err, _vars, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    showMutationError(
      "Couldn't move the column — your change was undone.",
      err,
    );
  },
});
```

(If `resizeColumnMutation`'s `onMutate` is `async` and awaits `qc.cancelQueries`, mirror that too — copy its exact shape.)

Expose it in the returned object next to `resizeColumn` (~line 1163):

```ts
    reorderColumn: (columnId: string, position: number) =>
      reorderColumnMutation.mutate({ columnId, position }),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- use-board-mutations`
Expected: PASS (2 new tests + full pre-existing file green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/use-board-mutations.ts src/lib/boards/use-board-mutations.test.tsx
git commit -m "feat(boards): optimistic column reorder mutation

Patches position via the shared optimisticColumn helper; the cache's
replaceColumn re-sort reflows all groups instantly, with rollback +
toast on failure. Realtime UPDATE echo stays idempotent.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: BoardTable wiring — per-group-header DnD + controls

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Test: `src/components/boards/BoardTable.test.tsx`

**Interfaces:**

- Consumes: `mutations.reorderColumn(columnId, position)` (Task 3); `ColumnHeader`'s `reorder?: ColumnReorder` prop (Task 2); existing `reorderPosition` from `@/lib/boards/group-reorder`, `useTouchAwareSensors`, `CSS`, `useSortable`, `SortableContext`, `DndContext`, `VALUE_COL_WIDTH`, `ColumnHeaderControls` type + `columnControls` literal, `GroupHeaderRow`.
- Produces: user-facing feature; no downstream task.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/boards/BoardTable.test.tsx` (the file already has `payloadWithColumns()` with 3 columns × 2 groups and `renderBoardWithColumns()` from the per-group-headers work — reuse them; `reorderColumn` is already covered by the file's existing `vi.mock` of `use-board-mutations`/actions — follow the file's mocking style):

```tsx
describe("BoardTable column reorder", () => {
  it("renders a reorder grip per data column in every group header", () => {
    renderBoardWithColumns();
    // 2 groups × 3 columns; Name/Created cells get no grip.
    expect(
      screen.getAllByRole("button", { name: "Reorder Status column" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Reorder Owner column" }),
    ).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Reorder Name/ })).toBeNull();
  });

  it("disables Move left on the first data column and Move right on the last", () => {
    renderBoardWithColumns();
    fireEvent.click(screen.getAllByLabelText("Status column menu")[0]);
    expect(
      screen.getByText("Move left").closest("[role=menuitem]"),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Move right").closest("[role=menuitem]"),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("BoardTable column reorder (pure position math)", () => {
  it("computes a column reorder position among board columns", () => {
    const cols = [
      { id: "c_status", position: 0 },
      { id: "c_owner", position: 1 },
      { id: "c_date", position: 2 },
    ];
    // drag Due Date before Status → strictly less than 0
    expect(reorderPosition(cols, "c_date", "c_status")!).toBeLessThan(0);
    // self-drop is a no-op
    expect(reorderPosition(cols, "c_owner", "c_owner")).toBeNull();
  });
});
```

(`reorderPosition` may already be imported by this test file for the item/group math tests — if not, import it from `@/lib/boards/group-reorder`.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test -- BoardTable.test.tsx -t "column reorder"`
Expected: the grip/menu tests FAIL (no grips rendered); the position-math test may already pass (helper exists) — that's fine.

- [ ] **Step 3: Imports + controls bundle**

In `src/components/boards/BoardTable.tsx`:

a) Extend the dnd-kit imports (~lines 27–34):

```tsx
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
```

and add `type ColumnReorder` to the ColumnHeader import:

```tsx
import {
  ColumnHeader,
  type ColumnReorder,
} from "@/components/boards/ColumnHeader";
```

(`ColumnReorder` is only needed if a type annotation is written out; if unused after Step 4, drop it — no dead imports.)

b) `ColumnHeaderControls` type (~line 243) — add one field:

```ts
  reorderColumn: (id: string, position: number) => void;
```

c) `columnControls` literal (~line 542) — add next to `resizeColumn`:

```ts
    reorderColumn: mutations.reorderColumn,
```

- [ ] **Step 4: `SortableColumnHeader` wrapper + `GroupHeaderRow` DnD**

a) Add above `GroupHeaderRow` (~line 1042):

```tsx
/** Owns useSortable for one data-column header so ColumnHeader stays
 *  presentational. Translate-only transform (gotcha-20: grid tracks have
 *  differing widths — never stretch). */
function SortableColumnHeader({
  column,
  col,
  onMoveLeft,
  onMoveRight,
}: {
  column: Column;
  col: ColumnHeaderControls;
  onMoveLeft: (() => void) | null;
  onMoveRight: (() => void) | null;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });
  return (
    <ColumnHeader
      column={column}
      width={col.liveWidths[column.id] ?? column.width ?? VALUE_COL_WIDTH}
      onRename={(n) => col.renameColumn(column.id, n)}
      onDelete={() => col.deleteColumn(column.id)}
      onResize={(w) => col.setLiveWidths((m) => ({ ...m, [column.id]: w }))}
      onResizeEnd={(w) => col.resizeColumn(column.id, w)}
      onEditOptions={() => col.onEditOptions(column)}
      reorder={{
        setNodeRef,
        style: {
          transform: CSS.Translate.toString(transform),
          transition,
        },
        isDragging,
        handleAttributes: attributes,
        handleListeners: listeners,
        onMoveLeft,
        onMoveRight,
      }}
    />
  );
}
```

b) In `GroupHeaderRow` (~line 1050), add sensors + handlers at the top of the function body:

```tsx
const columnSensors = useTouchAwareSensors();

function columnMovePosition(index: number, dir: -1 | 1): number | null {
  const over = columns[index + dir];
  if (!over) return null;
  return reorderPosition(
    columns.map((c) => ({ id: c.id, position: c.position })),
    columns[index].id,
    over.id,
  );
}

function handleColumnDragEnd(e: DragEndEvent) {
  const { active, over } = e;
  if (!over || active.id === over.id) return;
  const position = reorderPosition(
    columns.map((c) => ({ id: c.id, position: c.position })),
    String(active.id),
    String(over.id),
  );
  if (position !== null) col.reorderColumn(String(active.id), position);
}
```

c) Replace the `{columns.map((c) => (<ColumnHeader … />))}` block (~lines 1177–1188) with (DndContext/SortableContext render no DOM, so headers stay direct grid children; the frozen Name cell before this block and the `CreatedHeaderCell`s/`AddColumnMenu` after it stay OUTSIDE the contexts — that is what makes Name immovable):

```tsx
<DndContext
  sensors={columnSensors}
  modifiers={[restrictToHorizontalAxis]}
  onDragEnd={handleColumnDragEnd}
>
  <SortableContext
    items={columns.map((c) => c.id)}
    strategy={horizontalListSortingStrategy}
  >
    {columns.map((c, i) => (
      <SortableColumnHeader
        key={c.id}
        column={c}
        col={col}
        onMoveLeft={
          i > 0
            ? () => {
                const p = columnMovePosition(i, -1);
                if (p !== null) col.reorderColumn(c.id, p);
              }
            : null
        }
        onMoveRight={
          i < columns.length - 1
            ? () => {
                const p = columnMovePosition(i, 1);
                if (p !== null) col.reorderColumn(c.id, p);
              }
            : null
        }
      />
    ))}
  </SortableContext>
</DndContext>
```

- [ ] **Step 5: Run the new tests + the full board suite**

Run: `pnpm test -- BoardTable.test.tsx ColumnHeader`
Expected: PASS — new "column reorder" tests green, all pre-existing BoardTable/ColumnHeader tests green (per-group headers, frozen name, item drag untouched).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no unused imports; `ColumnReorder` import dropped if unused).

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): drag-to-reorder columns in the table view

Per-group-header DndContext + horizontal SortableContext over the data
columns only — the frozen Name cell and trailing Created/Add cells sit
outside the sortable set, so Name is immovable by construction. Drop
computes the shared reorderPosition midpoint and fires the optimistic
reorderColumn mutation (one Server Action per drop, zero refetches);
kanban/gantt/export inherit the order from the position-sorted cache.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Full verification gate + manual smoke

**Files:** none (verification only)

**Interfaces:**

- Consumes: everything above.
- Produces: evidence for the "done" claim + the user's "How to test this" walkthrough.

- [ ] **Step 1: Run the full gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four PASS (evidence before claims — `verification-before-completion`). Known env notes: cold `typecheck` can fail on `cacheLife` until `pnpm build` generates `.next/types` (run build first if so); flaky integration tests are pre-existing — investigate before blaming this change.

- [ ] **Step 2: Manual browser smoke (use the `verify`/`run` skill)**

1. Open a board with ≥3 columns and ≥2 groups in the Table view.
2. Hover a column header → grip appears; drag it left one slot → all group headers, the rows' cells, and the footer reflow together instantly; no page reload/refetch.
3. Refresh → the order persists.
4. Open the same board in a second browser session → drag a column in session A → session B's headers reorder within a moment (realtime).
5. Column menu → "Move left/right" works; "Move left" disabled on the first data column, "Move right" on the last.
6. Confirm the Name column cannot be dragged (no grip) and nothing can be dropped before it; Created by / Created at / "+" stay at the far right.
7. Kanban view → card fields follow the new column order.
8. Touch device or DevTools touch emulation: long-press (~200ms) the grip lifts the header; a quick horizontal swipe scrolls instead.

- [ ] **Step 3: Finish + handoff**

Run `scripts/finish-task.sh` from inside the worktree (auto-rebases onto latest `develop`, re-runs gates, merges, pushes, cleans up). Then hand the user the numbered "How to test this" walkthrough (Step 2 above) in the closing message and the `/wrapup` session note. If the branch cannot be merged, say so explicitly — the task is not complete.

---

## Execution DAG

- **Dependencies:** Task 3 depends on Task 1 (imports the action). Task 4 depends on Tasks 2 and 3. Task 5 depends on Task 4. Tasks 1 and 2 are independent (disjoint files, no shared symbols).
- **Parallel batches:**
  - **Batch A (parallel):** Task 1, Task 2 — dispatch together (different files; same worktree is fine).
  - **Batch B:** Task 3.
  - **Batch C:** Task 4.
  - **Batch D:** Task 5.
- **Critical path:** Task 1 → Task 3 → Task 4 → Task 5 (4 tasks; Task 2 hides inside Batch A's wall-clock).

## Migration note

**No migration and no `pnpm db:types` step**: `columns.position` (float8) shipped in `20260615061747_boards_core.sql` and is already in the generated types, the payload query, and the cache sort. If that ever changes, migrations are applied to cloud dev manually by the user (agent pushes are blocked by the classifier) — not applicable here.

## Self-review (plan author)

- **Spec coverage:** action + schema (T1 = spec §3.2), grip + menu affordances (T2 = §3.4/§3.5), optimistic mutation (T3 = §3.3), per-group DnD with Name immovable by construction (T4 = §3.4), realtime/other views need no tasks (§3.6/§3.7 — verified existing code paths), perf budget honored (0 first-paint, 1 action per drop — T1 Step 5, T3, T4), tests per spec §7 spread across T1–T4, e2e deliberately omitted (spec marks it optional; unit + gate per item-drag precedent).
- **Placeholder scan:** none — every code step shows the code; "mirror the file's helpers" instances name the exact existing describe block to copy.
- **Type consistency:** `ColumnReorder` (T2) is exactly what `SortableColumnHeader` passes (T4); `reorderColumn(columnId: string, position: number)` matches T1's action input, T3's vars, and T4's `ColumnHeaderControls` field; `reorderPosition(list, activeId, overId): number | null` matches `group-reorder.ts`.
