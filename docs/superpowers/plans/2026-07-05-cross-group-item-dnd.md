# Cross-group item drag-and-drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a top-level item row from one group and drop it into another group in the boards Table view, landing at the exact drop position.

**Architecture:** Extend the already-existing `moveItem` server action + `moveItemToGroup` optimistic cache helper with an optional target `position`, add a single-item optimistic mutation, then unify the board's group-drag context and the per-group item-drag contexts into ONE board-level `DndContext` so a drag can cross group boundaries. Cross-group drop routes to the new mutation; same-group drop keeps the existing `reorderItem`; group-header drag keeps `reorderGroup`.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript strict, `@dnd-kit/core` + `@dnd-kit/sortable`, `@tanstack/react-query` optimistic mutations, Zod, Vitest + Testing Library.

## Global Constraints

- **Server Actions for all mutations**; validate input with Zod at the boundary (`moveItemSchema`).
- **0 new server round-trips** on interaction: the drag is optimistic via the cache helper; only the mutation's Server Action persists. No `<Link>`/router navigation.
- **RLS is the security boundary** — the `moveItem` action's org/board/subitem guards stay; never trust client-supplied group/position beyond validation.
- **TypeScript strict, no unjustified `any`.**
- **Commit identity** is pinned by the worktree; commit subjects lowercase after `type(scope):`, with a descriptive body + `Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>` trailer. Stage explicitly by path — never `git add -A`.
- **Scope:** Table view only; top-level items only (subitems never move between groups — server-guarded).
- Gates before merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

### Task 1: Extend `moveItem` server action with an optional target position

**Files:**

- Modify: `src/lib/validations/board-actions.ts:42` (`moveItemSchema`)
- Modify: `src/lib/boards/actions.ts:533-589` (`moveItem`)
- Test: `src/lib/boards/actions.test.ts`

**Interfaces:**

- Consumes: `midpoint` (`src/lib/boards/position.ts`), `moveItemSchema`.
- Produces: `moveItem({ itemId: string; groupId: string; position?: number }): Promise<ActionResult>` — when `position` is provided, the item is placed at that float position; when omitted, it appends after the target group's last top-level item (unchanged behavior). Subitem + cross-board guards unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/actions.test.ts` inside the existing `moveItem` describe block (mirror the existing `moveItem` test setup for the Supabase mock — copy the neighbouring test's `from`/`update` mock wiring):

```ts
it("uses the provided position instead of appending", async () => {
  // item exists, same board; group exists, same board (reuse this file's happy-path mocks)
  const update = mockItemUpdate(); // same helper the other moveItem tests use
  const res = await moveItem({ itemId: ITEM, groupId: GROUP, position: 3.5 });
  expect(res.ok).toBe(true);
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ group_id: GROUP, position: 3.5 }),
  );
});

it("still appends when position is omitted", async () => {
  // last top-level item in target group has position 2 → append = midpoint(2, null) = 3
  const update = mockItemUpdate();
  const res = await moveItem({ itemId: ITEM, groupId: GROUP });
  expect(res.ok).toBe(true);
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ group_id: GROUP, position: 3 }),
  );
});
```

> If the existing `moveItem` tests don't expose a reusable `mockItemUpdate`, read the top of the `moveItem` describe block and replicate its exact mock shape inline — do not invent a helper that isn't there.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/boards/actions.test.ts -t moveItem`
Expected: FAIL — the "uses the provided position" case fails because `position` is ignored (always appends).

- [ ] **Step 3: Extend the schema**

In `src/lib/validations/board-actions.ts`, replace line 42:

```ts
/** Move a top-level item to a different group on the same board. */
export const moveItemSchema = z.object({
  itemId: uuid,
  groupId: uuid,
  position: z.number().optional(),
});
```

- [ ] **Step 4: Honor the position in the action**

In `src/lib/boards/actions.ts`, change the `moveItem` signature and the position computation. Replace the signature (L533-536):

```ts
export async function moveItem(input: {
  itemId: string;
  groupId: string;
  position?: number;
}): Promise<ActionResult> {
```

Then replace the append block (the `last` lookup + the `.update` at L563-578) so the lookup only runs when no explicit position was given:

```ts
// Explicit position (drag-drop exact spot) wins; otherwise append after the
// target group's last top-level item (bulk move / collapsed-group drop).
let position = parsed.data.position;
if (position === undefined) {
  const { data: last } = await supabase
    .from("items")
    .select("position")
    .eq("group_id", parsed.data.groupId)
    .is("parent_id", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  position = midpoint(last?.position ?? null, null);
}

const { error } = await supabase
  .from("items")
  .update({ group_id: parsed.data.groupId, position })
  .eq("id", parsed.data.itemId);
if (error) return fail(error.message);
```

(The subitem `group_id` drag-along update below it is unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- src/lib/boards/actions.test.ts -t moveItem`
Expected: PASS (all moveItem cases, including the two new ones and the existing subitem/cross-board rejections).

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/board-actions.ts src/lib/boards/actions.ts src/lib/boards/actions.test.ts
git commit -m "feat(boards): moveItem accepts an explicit target position

Drag-drop needs exact-spot placement in the target group; keep append
as the default when position is omitted (bulk move / collapsed drop).

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 2: Extend `moveItemToGroup` cache helper with an optional position

**Files:**

- Modify: `src/lib/boards/cache.ts:107-124` (`moveItemToGroup`)
- Test: `src/lib/boards/cache.test.ts`

**Interfaces:**

- Consumes: `BoardCache`, `CacheItem`.
- Produces: `moveItemToGroup(cache: BoardCache, itemId: string, groupId: string, position?: number): BoardCache` — reassigns the item's `group_id`; sets `position` to the provided value, or `maxPos + 1` (append) when omitted; drags subitems' `group_id` along. Immutable.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/cache.test.ts` (reuse this file's `baseCache()` builder; assert on the returned item):

```ts
describe("moveItemToGroup position", () => {
  it("places at the explicit position when given", () => {
    const next = moveItemToGroup(baseCache(), "i1", "g2", 4.5);
    const moved = next.items.find((i) => i.id === "i1")!;
    expect(moved.group_id).toBe("g2");
    expect(moved.position).toBe(4.5);
  });

  it("appends (maxPos + 1) when position omitted", () => {
    // g2 already holds a top-level item at position 2 in baseCache()
    const next = moveItemToGroup(baseCache(), "i1", "g2");
    const moved = next.items.find((i) => i.id === "i1")!;
    expect(moved.position).toBe(3);
  });
});
```

> Check `baseCache()` actually has an item `i1` and a group `g2` with a top-level item at position 2. If the fixture differs, adjust the ids/expected numbers to match it exactly — read the fixture first.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/boards/cache.test.ts -t "moveItemToGroup position"`
Expected: FAIL — `moveItemToGroup` takes only 3 args; the explicit-position case fails (it always uses maxPos+1).

- [ ] **Step 3: Extend the helper**

In `src/lib/boards/cache.ts`, replace `moveItemToGroup` (L107-124):

```ts
export function moveItemToGroup(
  cache: BoardCache,
  itemId: string,
  groupId: string,
  position?: number,
): BoardCache {
  const maxPos = cache.items
    .filter((i) => i.group_id === groupId && i.parent_id === null)
    .reduce((m, i) => Math.max(m, i.position), 0);
  const nextPos = position ?? maxPos + 1;
  return {
    ...cache,
    items: cache.items.map((i) => {
      if (i.id === itemId)
        return { ...i, group_id: groupId, position: nextPos };
      if (i.parent_id === itemId) return { ...i, group_id: groupId };
      return i;
    }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/lib/boards/cache.test.ts -t moveItemToGroup`
Expected: PASS (new position tests + any existing `moveItemToGroup` tests).

- [ ] **Step 5: Verify the bulk caller still compiles**

`src/lib/boards/use-bulk-mutations.ts:98` calls `moveItemToGroup(c, id, groupId)` with 3 args — the new 4th arg is optional, so it stays valid (append). No change needed.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/cache.ts src/lib/boards/cache.test.ts
git commit -m "feat(boards): moveItemToGroup accepts an optional position

Mirror the server action so an optimistic cross-group drop can place
the item at the exact drop spot; append stays the default.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 3: Add the cross-group insert-position helper

**Files:**

- Create: `src/lib/boards/board-dnd.ts`
- Test: `src/lib/boards/board-dnd.test.ts`

**Interfaces:**

- Consumes: `midpoint` (`src/lib/boards/position.ts`).
- Produces: `crossGroupInsertPosition(targetItems: readonly { id: string; position: number }[], overId: string, dropBelow: boolean): number` — the float position for inserting an item next to `overId` in the target group's position-ordered top-level list. `dropBelow=false` inserts before `overId`; `true` inserts after. Returns `midpoint(0, firstPos)`-style boundaries at the ends. If `overId` isn't in `targetItems`, returns `midpoint(lastPos, null)` (append).

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/board-dnd.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { crossGroupInsertPosition } from "./board-dnd";

const items = [
  { id: "a", position: 10 },
  { id: "b", position: 20 },
  { id: "c", position: 30 },
];

describe("crossGroupInsertPosition", () => {
  it("inserts before the over row (midpoint of neighbour above)", () => {
    // before "b": between a(10) and b(20) → 15
    expect(crossGroupInsertPosition(items, "b", false)).toBe(15);
  });

  it("inserts after the over row (midpoint of neighbour below)", () => {
    // after "b": between b(20) and c(30) → 25
    expect(crossGroupInsertPosition(items, "b", true)).toBe(25);
  });

  it("inserts before the first row (prepend)", () => {
    // before "a": midpoint(null, 10) → 5
    expect(crossGroupInsertPosition(items, "a", false)).toBe(5);
  });

  it("inserts after the last row (append)", () => {
    // after "c": midpoint(30, null) → 31
    expect(crossGroupInsertPosition(items, "c", true)).toBe(31);
  });

  it("appends when overId is not in the list", () => {
    // unknown over → append after last → 31
    expect(crossGroupInsertPosition(items, "zzz", false)).toBe(31);
  });

  it("appends into an empty group", () => {
    expect(crossGroupInsertPosition([], "zzz", false)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/boards/board-dnd.test.ts`
Expected: FAIL — module `./board-dnd` not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/boards/board-dnd.ts`:

```ts
import { midpoint } from "@/lib/boards/position";

/**
 * Float `position` for inserting an item next to `overId` within a target
 * group's position-ordered top-level items. `dropBelow` = drop the active row
 * *after* `overId` (insert below it); otherwise *before*. Ends prepend/append
 * via midpoint's null boundaries. Unknown `overId` (e.g. dropped on the group
 * container, not a row) → append after the last row.
 */
export function crossGroupInsertPosition(
  targetItems: readonly { id: string; position: number }[],
  overId: string,
  dropBelow: boolean,
): number {
  const ordered = [...targetItems].sort((a, b) => a.position - b.position);
  const idx = ordered.findIndex((i) => i.id === overId);
  if (idx === -1) {
    const last = ordered[ordered.length - 1]?.position ?? null;
    return midpoint(last, null);
  }
  if (dropBelow) {
    const after = ordered[idx + 1]?.position ?? null;
    return midpoint(ordered[idx].position, after);
  }
  const before = ordered[idx - 1]?.position ?? null;
  return midpoint(before, ordered[idx].position);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/lib/boards/board-dnd.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/board-dnd.ts src/lib/boards/board-dnd.test.ts
git commit -m "feat(boards): add crossGroupInsertPosition helper

Pure midpoint math for placing a dragged item at the exact spot in a
target group; handles prepend/append/empty/unknown-over boundaries.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 4: Add the single-item `moveItemToGroup` optimistic mutation

**Files:**

- Modify: `src/lib/boards/use-board-mutations.ts` (import ~L60; new optimistic helper near `optimisticItemField` ~L221; new mutation after `reorderItemMutation` ~L642; new `CellControls`-facing method in the returned object ~L1209)
- Modify: `src/components/boards/BoardTable.tsx:180` (`CellControls` interface — add the method type)
- Test: `src/lib/boards/use-board-mutations.test.tsx`

**Interfaces:**

- Consumes: `moveItem` server action, `moveItemToGroup` cache helper (Task 2), `rollback`/`patchBoardCache`/`showMutationError`.
- Produces: `controls.moveItemToGroup(itemId: string, groupId: string, position?: number): void` — optimistically moves the item (group_id + position + subitems) in the cache, calls the `moveItem` action, rolls back the touched fields on error. Exposed on the `CellControls` object the table already threads down.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/use-board-mutations.test.tsx` (follow the file's existing pattern for rendering the hook + mocking the action module; mirror the `reorderItem` test if present):

```ts
it("moveItemToGroup optimistically reassigns group + position and calls the action", async () => {
  moveItemMock.mockResolvedValue({ ok: true });
  const { result } = renderBoardMutations(); // same harness the other tests use
  act(() => result.current.moveItemToGroup("i1", "g2", 4.5));

  // optimistic cache patch applied synchronously
  const cache = getCache();
  const moved = cache.items.find((i) => i.id === "i1")!;
  expect(moved.group_id).toBe("g2");
  expect(moved.position).toBe(4.5);

  await waitFor(() =>
    expect(moveItemMock).toHaveBeenCalledWith({
      itemId: "i1",
      groupId: "g2",
      position: 4.5,
    }),
  );
});
```

> Read the top of `use-board-mutations.test.tsx` and reuse its actual harness names (`renderBoardMutations`/`getCache`/`moveItemMock` are placeholders for whatever this file already defines — match them exactly; add a `moveItem` mock to the existing `vi.mock("@/lib/boards/actions", ...)` block if it isn't mocked yet).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/boards/use-board-mutations.test.tsx -t moveItemToGroup`
Expected: FAIL — `result.current.moveItemToGroup` is undefined.

- [ ] **Step 3: Import the action + cache helper**

In `src/lib/boards/use-board-mutations.ts`, add `moveItem` to the `@/lib/boards/actions` import block (near `reorderItem`, ~L20) and confirm `moveItemToGroup` is imported from `@/lib/boards/cache` (add it to that import block near `removeItem`, ~L60 — it may not be imported yet):

```ts
// in the actions import block:
  moveItem,
// in the cache import block:
  moveItemToGroup,
```

- [ ] **Step 4: Add the optimistic helper**

In `src/lib/boards/use-board-mutations.ts`, right after `optimisticItemField` (ends ~L221), add a targeted-inverse helper that mirrors its shape but uses the cache transform and restores the item's + subitems' original `group_id`/`position`:

```ts
// Optimistic cross-group move: apply the cache transform, capture a targeted
// inverse that restores the moved item's group_id/position and each subitem's
// group_id (so a concurrent peer update to other entities survives rollback).
function optimisticMoveItem(
  itemId: string,
  groupId: string,
  position?: number,
): Ctx {
  const previous = qc.getQueryData<BoardCache>(key);
  const item = previous?.items.find((i) => i.id === itemId);
  if (!previous || !item) return {};
  const prior = { group_id: item.group_id, position: item.position };
  const subGroups = new Map(
    previous.items
      .filter((i) => i.parent_id === itemId)
      .map((i) => [i.id, i.group_id] as const),
  );
  qc.setQueryData<BoardCache>(
    key,
    moveItemToGroup(previous, itemId, groupId, position),
  );
  return {
    rollback: (c) => ({
      ...c,
      items: c.items.map((i) => {
        if (i.id === itemId) return { ...i, ...prior };
        if (subGroups.has(i.id))
          return { ...i, group_id: subGroups.get(i.id)! };
        return i;
      }),
    }),
  };
}
```

- [ ] **Step 5: Add the mutation**

Immediately after `reorderItemMutation` (ends ~L642), add:

```ts
/** Move a top-level item to another group (drag-drop across groups). Optimistic; rollback on error. */
const moveItemToGroupMutation = useMutation<
  unknown,
  Error,
  { itemId: string; groupId: string; position?: number },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await moveItem(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    return optimisticMoveItem(vars.itemId, vars.groupId, vars.position);
  },
  onError: (err, _v, ctx) => {
    rollback(ctx);
    showMutationError("Couldn't move the item — your change was undone.", err);
  },
});
```

- [ ] **Step 6: Expose it on the returned controls**

In the object returned by the hook, next to `reorderItem` (~L1209), add:

```ts
    moveItemToGroup: (itemId: string, groupId: string, position?: number) =>
      moveItemToGroupMutation.mutate({ itemId, groupId, position }),
```

- [ ] **Step 7: Add the method to the `CellControls` type**

In `src/components/boards/BoardTable.tsx`, in the `CellControls` interface (near `reorderItem` at L180), add:

```ts
  moveItemToGroup: (itemId: string, groupId: string, position?: number) => void;
```

Then wire it into the `controls` object built in `BoardTableInner` (near where `reorderItem` is spread/assigned, ~L639):

```ts
    moveItemToGroup: mutations.moveItemToGroup,
```

> Read L620-650 first: if `controls` pulls methods off a destructured `mutations` list (like `reorderItem` at L639), add `moveItemToGroup` to that destructure and the object. Match the exact wiring style used there.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test -- src/lib/boards/use-board-mutations.test.tsx -t moveItemToGroup && pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/boards/use-board-mutations.ts src/lib/boards/use-board-mutations.test.tsx src/components/boards/BoardTable.tsx
git commit -m "feat(boards): single-item moveItemToGroup optimistic mutation

Wire the moveItem action to an optimistic cache patch with a targeted
inverse (item + subitem group_id/position) and expose it on controls
for the table's cross-group drag handler.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 5: Unify the board DnD context and route cross-group drops

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` — imports (L28-39), `BoardTableInner` drag handler + the board-groups `DndContext` (L654-768), `GroupSection` (remove its item `DndContext`, add container droppable, L1560-1740)
- Test: `src/components/boards/BoardTable.test.tsx` (or a new `BoardTable.cross-group-dnd.test.tsx`)

**Interfaces:**

- Consumes: `controls.moveItemToGroup` (Task 4), `controls.reorderItem`, `reorderGroup`, `crossGroupInsertPosition` (Task 3), `visibleItemsByGroup`.
- Produces: a single board-level `<DndContext id="board-dnd">` whose `onDragEnd` routes group / same-group-item / cross-group-item drags. `GroupSection` no longer owns an item `DndContext`; it renders a `SortableContext` + a droppable group container.

- [ ] **Step 1: Write the failing test**

Add a test that renders the board and simulates a cross-group item drag by invoking the context's `onDragEnd` with an item active in group A over a row in group B. The simplest robust approach in this codebase's tests is to spy on `controls.moveItemToGroup`. Add to `src/components/boards/BoardTable.test.tsx`:

```ts
it("cross-group item drop calls moveItemToGroup with the target group + position", async () => {
  // Render a board with two groups; g1 has item i1, g2 has items i2 (pos 10), i3 (pos 20).
  // Capture the DndContext onDragEnd via the test's existing render helper, then call it:
  const onDragEnd = getBoardDndOnDragEnd(); // see note
  onDragEnd({
    active: {
      id: "i1",
      data: { current: { type: "item", groupId: "g1" } },
      rect: { current: { translated: { top: 12 } } },
    },
    over: {
      id: "i2",
      data: { current: { type: "item", groupId: "g2" } },
      rect: { top: 0, height: 40 },
    },
  });
  expect(moveItemToGroupSpy).toHaveBeenCalledWith(
    "i1",
    "g2",
    expect.any(Number),
  );
});

it("same-group item drop calls reorderItem, not moveItemToGroup", async () => {
  const onDragEnd = getBoardDndOnDragEnd();
  onDragEnd({
    active: {
      id: "i2",
      data: { current: { type: "item", groupId: "g2" } },
      rect: { current: { translated: { top: 30 } } },
    },
    over: {
      id: "i3",
      data: { current: { type: "item", groupId: "g2" } },
      rect: { top: 0, height: 40 },
    },
  });
  expect(reorderItemSpy).toHaveBeenCalled();
  expect(moveItemToGroupSpy).not.toHaveBeenCalled();
});
```

> `getBoardDndOnDragEnd`/spies are placeholders. This codebase's board tests already render `BoardTable` with a mocked `useBoardMutations`; reuse that mock to capture `moveItemToGroup`/`reorderItem` spies. To reach `onDragEnd`, prefer capturing the prop passed to `DndContext` — mock `@dnd-kit/core`'s `DndContext` to a passthrough that stashes `onDragEnd` on a ref, the same way other dnd tests in this repo do it (grep `vi.mock("@dnd-kit/core"` first; if a pattern exists, copy it — otherwise mock `DndContext` to `({children,onDragEnd}) => { captured.current = onDragEnd; return children; }`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/BoardTable.test.tsx -t "cross-group"`
Expected: FAIL — cross-group drop currently impossible; `onDragEnd` doesn't route to `moveItemToGroup` (and per-group contexts differ).

- [ ] **Step 3: Update imports**

In `src/components/boards/BoardTable.tsx`, expand the dnd-kit imports (L28-39):

```ts
import {
  DndContext,
  DragOverlay,
  useDroppable,
  pointerWithin,
  closestCenter,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
```

and add near the other board-lib imports (L41):

```ts
import { crossGroupInsertPosition } from "@/lib/boards/board-dnd";
```

- [ ] **Step 4: Tag item + group draggables with type/group data**

In the item `useSortable` (`ItemRow`, ~L1827) pass data so the handler can read type + origin group. Find `useSortable({ id: item.id })` and change to:

```ts
  } = useSortable({
    id: item.id,
    data: { type: "item", groupId: item.group_id },
  });
```

In the group `useSortable` (`GroupSection`, ~L1560) change `useSortable({ id: group.id })` to:

```ts
  } = useSortable({
    id: group.id,
    data: { type: "group" },
  });
```

- [ ] **Step 5: Add a droppable group container in `GroupSection`**

Inside `GroupSection`, register a container droppable keyed distinctly from the group's sortable id, and put its ref on the rows wrapper. Add near the group's `useSortable` call (~L1560):

```ts
const { setNodeRef: setGroupDropRef } = useDroppable({
  id: `group-drop-${group.id}`,
  data: { type: "group-container", groupId: group.id },
});
```

Then, in the `!collapsed` branch, remove the inner `<DndContext ...>` and `</DndContext>` wrappers (L1678-1683 and L1740) — keep the `<SortableContext>` — and attach `setGroupDropRef` to the rows wrapper `<div ref={rowAreaRef} ...>` at L1688 by composing refs:

```tsx
                <div
                  ref={(node) => {
                    rowAreaRef.current = node;
                    setGroupDropRef(node);
                  }}
                  data-testid={`group-rows-${group.id}`}
                  className="relative"
                  style={{ height: virtualizer.getTotalSize() }}
                >
```

Also attach the container ref to the collapsed strip so a collapsed group is a drop target. Wrap the collapsed `SummaryRow`/`GroupRollupRow` block (L1643-1673) content's outer element with `ref={setGroupDropRef}` (add a wrapping `<div ref={setGroupDropRef}>` around that block).

Delete the now-unused `handleItemDragEnd` (L1564-1573) and `itemSensors` (L1562) from `GroupSection` — item drags are handled at the board level now.

> `rowAreaRef` is currently a plain ref used for measurement. Confirm it's a `useRef<HTMLDivElement | null>` and that the composed-ref callback above is compatible; if `rowAreaRef` is read elsewhere expecting `.current`, the callback form preserves it.

- [ ] **Step 6: Keep one SortableContext per group under the board context**

The per-group `<SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>` stays exactly as-is (now a child of the single board-level context instead of a per-group context). No change beyond removing the surrounding `<DndContext>`.

- [ ] **Step 7: Build the unified board-level context + collision detection + onDragEnd**

In `BoardTableInner`, replace `handleGroupDragEnd` (L654-663) with a combined handler and a collision strategy, and add drag-overlay state:

```ts
const [activeDrag, setActiveDrag] = useState<{
  id: string;
  type: "item" | "group";
  name: string;
} | null>(null);

// Item rows collide by pointer first (falls to the group container when the
// pointer is in a gap / over a collapsed group); groups collide by center.
const boardCollision: CollisionDetection = (args) => {
  const type = args.active.data.current?.type;
  if (type === "group") {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.data.current?.type === "group",
      ),
    });
  }
  const rowHits = pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (c) => c.data.current?.type === "item",
    ),
  });
  if (rowHits.length > 0) return rowHits;
  return pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (c) => c.data.current?.type === "group-container",
    ),
  });
};

function handleBoardDragStart(e: DragStartEvent) {
  const type = e.active.data.current?.type;
  if (type === "group") {
    const g = groups.find((x) => x.id === e.active.id);
    setActiveDrag(g ? { id: g.id, type: "group", name: g.name } : null);
  } else {
    const it = topLevel.find((x) => x.id === e.active.id);
    setActiveDrag(it ? { id: it.id, type: "item", name: it.name } : null);
  }
}

function handleBoardDragEnd(e: DragEndEvent) {
  setActiveDrag(null);
  const { active, over } = e;
  if (!over) return;
  const activeType = active.data.current?.type;

  if (activeType === "group") {
    if (over.data.current?.type !== "group" || active.id === over.id) return;
    const position = reorderPosition(
      groups.map((g) => ({ id: g.id, position: g.position })),
      String(active.id),
      String(over.id),
    );
    if (position !== null) reorderGroup(String(active.id), position);
    return;
  }

  // item drag
  const fromGroup = String(active.data.current?.groupId);
  const overData = over.data.current;
  const toGroup =
    overData?.type === "group-container"
      ? String(overData.groupId)
      : String(overData?.groupId ?? "");
  if (!toGroup) return;

  if (toGroup === fromGroup) {
    if (active.id === over.id) return;
    const position = reorderPosition(
      (visibleItemsByGroup.get(fromGroup) ?? []).map((i) => ({
        id: i.id,
        position: i.position,
      })),
      String(active.id),
      String(over.id),
    );
    if (position !== null) controls.reorderItem(String(active.id), position);
    return;
  }

  // cross-group: compute exact spot, or append when dropped on the container
  const targetItems = (visibleItemsByGroup.get(toGroup) ?? []).map((i) => ({
    id: i.id,
    position: i.position,
  }));
  if (overData?.type === "group-container") {
    controls.moveItemToGroup(String(active.id), toGroup); // append
    return;
  }
  const activeTop =
    active.rect.current.translated?.top ??
    active.rect.current.initial?.top ??
    0;
  const overMid = over.rect.top + over.rect.height / 2;
  const dropBelow = activeTop > overMid;
  const position = crossGroupInsertPosition(
    targetItems,
    String(over.id),
    dropBelow,
  );
  controls.moveItemToGroup(String(active.id), toGroup, position);
}
```

Then replace the board-groups `<DndContext>` opening tag (L729-734) with the unified one:

```tsx
            <DndContext
              id="board-dnd"
              sensors={sensors}
              collisionDetection={boardCollision}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={handleBoardDragStart}
              onDragEnd={handleBoardDragEnd}
            >
```

Add the `DragOverlay` just before the closing `</DndContext>` (after the groups' `</SortableContext>`, ~L767):

```tsx
<DragOverlay>
  {activeDrag ? (
    <div className="bg-surface flex items-center border px-4 py-1.5 text-sm shadow-lg">
      {activeDrag.name}
    </div>
  ) : null}
</DragOverlay>
```

> `restrictToVerticalAxis` currently constrains both group and item drags (both were vertical) — keeping it on the unified context preserves that. Cross-group drag is still vertical within the scroll column, so this is correct; do not remove it.

- [ ] **Step 8: Run the targeted tests**

Run: `pnpm test -- src/components/boards/BoardTable.test.tsx -t "group"`
Expected: PASS — cross-group routes to `moveItemToGroup`, same-group to `reorderItem`, group header to `reorderGroup`.

- [ ] **Step 9: Run the full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. (If `pnpm typecheck` flags `cacheLife`-related `.next/types` errors on a cold run, run `pnpm build` first — known repo quirk — then re-run typecheck.)

- [ ] **Step 10: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): drag items across groups in the table view

Unify the group-reorder and per-group item DnD into one board-level
DndContext with type-tagged draggables, group-container droppables, a
custom collision strategy, and a drag overlay. Cross-group drops route
to moveItemToGroup at the exact spot (append on a container drop);
same-group keeps reorderItem, group headers keep reorderGroup.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

## Execution DAG

- **Task 1** (server action) — no deps.
- **Task 2** (cache helper) — no deps.
- **Task 3** (insert-position helper) — no deps.
- **Task 4** (mutation) — depends on **1** (action signature) + **2** (cache helper).
- **Task 5** (table DnD) — depends on **3** (insert helper) + **4** (controls method).

**Parallel batches:**

- Batch A (concurrent): Task 1, Task 2, Task 3 — independent, different files.
- Batch B: Task 4 (after 1 + 2).
- Batch C: Task 5 (after 3 + 4).

**Critical path:** 1/2 → 4 → 5 (three sequential stages). Tasks touch mostly distinct files; only Task 4 and Task 5 both edit `BoardTable.tsx` (Task 4 adds a type + one wiring line; Task 5 does the big DnD change), so run them sequentially, not concurrently, to avoid clobbering that file.

## Manual test (post-merge, for the user)

1. Pull `develop`, open a board (Table view) with at least two groups, each holding a few items.
2. Drag an item row from group A and drop it **between two specific rows** in group B → it lands exactly there.
3. Drag an item onto a **collapsed** group's header → expand it → the item is at the bottom.
4. Drag an item **within** its own group → still reorders as before.
5. Drag a **group header** → groups still reorder.
6. Confirm no full-page reload/flicker on any drag (optimistic; realtime reconciles).

## Self-Review notes

- **Spec coverage:** exact-spot drop (Task 3 + 5), collapsed-group append (Task 5 container droppable + Task 1/2 append), top-level-only (server guard unchanged; subitem `SubitemBlock` context untouched), unified context (Task 5), reuse of `moveItem`/`moveItemToGroup` (Tasks 1/2/4), 0-refetch optimistic (Task 4), DragOverlay (Task 5) — all mapped.
- **Type consistency:** `moveItemToGroup(itemId, groupId, position?)` identical across cache helper, mutation, and `CellControls`; `crossGroupInsertPosition(targetItems, overId, dropBelow)` identical in helper + caller; draggable `data.type` values `"item" | "group" | "group-container"` consistent between `useSortable`/`useDroppable` and the collision/handler.
- **Placeholder scan:** test harness names in Tasks 4 & 5 are explicitly flagged as repo-specific to match by reading the existing test files — the implementer must grep the existing mock pattern first (called out inline), not invent one.
