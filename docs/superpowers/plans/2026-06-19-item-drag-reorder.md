# Top-Level Item Drag-Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag-reorder top-level board items within their group, mirroring the existing sub-item drag.

**Architecture:** Front-end-only change in `BoardTable.tsx`. Wrap each group's virtualized item list in a nested `DndContext` + `SortableContext` (one per group, so drops are group-scoped), make `ItemRow` sortable with a hover-reveal grip handle, and reuse the existing `reorderPosition` helper + `reorderItem` mutation/Server Action (already group-agnostic). Translate-only transform (gotcha-20) keeps variable-height rows from stretching. Virtualization is preserved; dnd-kit auto-scroll covers long groups.

**Tech Stack:** Next.js 16 RSC, React, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/modifiers`, `@tanstack/react-virtual`, Vitest + React Testing Library (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-06-19-item-drag-reorder-design.md`

---

## File Structure

- **Modify:** `src/components/boards/BoardTable.tsx`
  - `GroupSection` — add an item-level `DndContext` + `SortableContext` around the virtualized list; add `itemSensors` + `handleItemDragEnd`.
  - `ItemRow` — add `useSortable`, a `GripVertical` drag handle, translate-only transform, `isDragging` style.
- **Modify (tests):** `src/components/boards/BoardTable.test.tsx` — add a two-top-level-item fixture + handle-presence test + item reorder position-math test.
- **Modify (e2e):** `e2e/subitems.spec.ts` — extend the existing board flow with a top-level item drag-reorder step. (No new spec file — it reuses the same logged-in board.)

**No new imports needed** in `BoardTable.tsx`: `DndContext`, `SortableContext`, `useSortable`, `PointerSensor`, `useSensor`, `useSensors`, `verticalListSortingStrategy`, `restrictToVerticalAxis`, `CSS`, `reorderPosition`, `GripVertical`, and `type DragEndEvent` are all already imported.

---

## Task 1: Unit test — top-level item exposes a drag handle (RED)

**Files:**

- Test: `src/components/boards/BoardTable.test.tsx`

- [ ] **Step 1: Add a two-top-level-item fixture + render helper + handle test**

Append after the existing `childlessPayload`/`renderChildless` block (the file already defines `payloadFixture`, `nestedPayload`, `childlessPayload` with this exact item shape, and mocks `reorderItem` via `vi.mock("@/lib/boards/actions")`):

```typescript
function twoItemsPayload() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board", name_column_width: null },
    groups: [
      {
        id: "g1",
        board_id: "b1",
        org_id: "o1",
        name: "Group 1",
        color: "#0073ea",
        position: 0,
      },
    ],
    columns: [],
    items: [
      {
        id: "t1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Task One",
        position: 0,
      },
      {
        id: "t2",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Task Two",
        position: 1,
      },
    ],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderTwoItems() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={twoItemsPayload()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable item drag handle", () => {
  it("renders a reorder handle for each top-level item", () => {
    renderTwoItems();
    expect(
      screen.getByRole("button", { name: "Reorder Task One" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reorder Task Two" }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- BoardTable`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Reorder Task One"` (no handle rendered yet).

---

## Task 2: Make top-level item rows sortable (GREEN)

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` — `GroupSection` (~lines 558–788) and `ItemRow` (~lines 791–914)

- [ ] **Step 1: Add item sensors + drag-end handler to `GroupSection`**

Inside `GroupSection`, just after the existing `useSortable({ id: group.id })` destructure block (the group's own handle), add:

```typescript
const itemSensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
);

function handleItemDragEnd(e: DragEndEvent) {
  const { active, over } = e;
  if (!over || active.id === over.id) return;
  const position = reorderPosition(
    items.map((i) => ({ id: i.id, position: i.position })),
    String(active.id),
    String(over.id),
  );
  if (position !== null) controls.reorderItem(String(active.id), position);
}
```

- [ ] **Step 2: Wrap the virtualized list in a per-group `DndContext` + `SortableContext`**

In `GroupSection`'s returned JSX, replace the `{items.length > 0 && ( ... )}` block (the `<div ref={scrollRef} ...>` scroll container) with the same markup wrapped in a context. Find this:

```tsx
          {items.length > 0 && (
            <div
              ref={scrollRef}
              className="overflow-auto"
              style={{ height: viewportHeight }}
            >
              <div
                className="relative"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualRows.map((vr) => {
```

and change the opening so it becomes:

```tsx
          {items.length > 0 && (
            <DndContext
              sensors={itemSensors}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleItemDragEnd}
            >
              <SortableContext
                items={items.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  ref={scrollRef}
                  className="overflow-auto"
                  style={{ height: viewportHeight }}
                >
                  <div
                    className="relative"
                    style={{ height: virtualizer.getTotalSize() }}
                  >
                    {virtualRows.map((vr) => {
```

Then close the two new wrappers: at the end of the same block, find the existing closing of the scroll container:

```tsx
                })}
              </div>
            </div>
          )}
```

and replace it with:

```tsx
                })}
                  </div>
                </div>
              </SortableContext>
            </DndContext>
          )}
```

(The `{virtualRows.map(...)}` body in between — `ItemRow` + conditional `SubitemBlock` inside the absolutely-positioned wrapper — is unchanged. Re-indentation of the inner lines is cosmetic; Prettier normalizes it on commit.)

- [ ] **Step 3: Make `ItemRow` a sortable row with a grip handle**

In `ItemRow`, add the sortable hook at the top of the function body (before the `chevron` const):

```typescript
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const dragHandle = (
    <button
      type="button"
      aria-label={`Reorder ${item.name}`}
      {...attributes}
      {...listeners}
      className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/name:opacity-100 active:cursor-grabbing"
    >
      <GripVertical className="size-3.5" />
    </button>
  );
```

- [ ] **Step 4: Apply the handle + drag transform to `ItemRow`'s markup**

In `ItemRow`'s returned JSX, change the root `<div>` and the `NameCell` `leading` prop. Find:

```tsx
  return (
    <div
      className="hover:bg-surface grid w-full border-b transition-colors"
      style={{ height: ROW_HEIGHT, gridTemplateColumns: template }}
    >
      <NameCell
        item={item}
        controls={controls}
        leading={chevron}
```

and replace with (translate-only transform per gotcha-20 — items are variable-height when expanded):

```tsx
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "hover:bg-surface grid w-full border-b transition-colors",
        isDragging && "relative z-10 shadow-lg",
      )}
      style={{
        height: ROW_HEIGHT,
        gridTemplateColumns: template,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    >
      <NameCell
        item={item}
        controls={controls}
        leading={
          <>
            {dragHandle}
            {chevron}
          </>
        }
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `pnpm test -- BoardTable`
Expected: PASS — including the new "renders a reorder handle for each top-level item" test, and all pre-existing BoardTable tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.test.tsx
git commit -m "feat(boards): drag-reorder top-level items within a group"
```

---

## Task 3: Item reorder position-math test (scope guard)

**Files:**

- Test: `src/components/boards/BoardTable.test.tsx`

- [ ] **Step 1: Add a pure position-math test mirroring the subitem one**

Append after the existing `describe("BoardTable subitem drag-reorder (pure position math)", ...)` block:

```typescript
describe("BoardTable item drag-reorder (pure position math)", () => {
  it("computes a top-level item reorder position among siblings", () => {
    const siblings = [
      { id: "t1", position: 0 },
      { id: "t2", position: 1 },
      { id: "t3", position: 2 },
    ];
    // drop t3 above t1 → strictly less than 0
    expect(reorderPosition(siblings, "t3", "t1")!).toBeLessThan(0);
    // dropping an item on itself is a no-op
    expect(reorderPosition(siblings, "t2", "t2")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm test -- BoardTable`
Expected: PASS (helper already exists; this locks the contract `handleItemDragEnd` relies on, including the self-drop no-op the guard short-circuits).

- [ ] **Step 3: Commit**

```bash
git add src/components/boards/BoardTable.test.tsx
git commit -m "test(boards): item reorder position-math + self-drop no-op"
```

---

## Task 4: e2e — drag a top-level item to reorder

**Files:**

- Modify: `e2e/subitems.spec.ts`

- [ ] **Step 1: Add a top-level item before the existing subitem drag step**

The existing test creates one top-level item "Epic". Immediately after the step that creates "Epic" (the inline "Item name" input around line 116–118), add a second top-level item and drag it above the first. Insert this block (it mirrors the file's existing subitem drag mechanics: `page.mouse` with ≥6px steps to satisfy dnd-kit's `activationConstraint.distance`, then `networkidle`):

```typescript
// ── Create a second top-level item, then drag it above "Epic" ────────────
const itemInput = page.getByLabel("Add item");
await itemInput.fill("Story");
await itemInput.press("Enter");
await expect(page.getByRole("button", { name: "Story name" })).toBeVisible({
  timeout: 10_000,
});

const storyHandle = page.getByRole("button", { name: "Reorder Story" });
const epicHandle = page.getByRole("button", { name: "Reorder Epic" });

// Hover the row to reveal the opacity-0 handle, then drag.
await page.getByRole("button", { name: "Story name" }).hover();
await expect(storyHandle).toBeVisible({ timeout: 10_000 });
const storyBox = await storyHandle.boundingBox();
const epicBox = await epicHandle.boundingBox();
expect(storyBox, "Story drag handle must be visible").not.toBeNull();
expect(epicBox, "Epic drag handle must be visible").not.toBeNull();

const storyCx = storyBox!.x + storyBox!.width / 2;
const storyCy = storyBox!.y + storyBox!.height / 2;
const epicCy = epicBox!.y + epicBox!.height / 2;

await page.mouse.move(storyCx, storyCy);
await page.mouse.down();
await page.mouse.move(storyCx, storyCy - 4);
await page.mouse.move(storyCx, storyCy - 8);
await page.mouse.move(storyCx, epicCy - 4);
await page.mouse.up();

await page.waitForLoadState("networkidle", { timeout: 15_000 });

// Assert "Story" is now the first top-level row (above "Epic").
const firstItem = page
  .locator('[aria-label="Story name"], [aria-label="Epic name"]')
  .first();
await expect(firstItem).toHaveAttribute("aria-label", "Story name", {
  timeout: 10_000,
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm e2e`
Expected: PASS — the new reorder assertions pass and the rest of the subitem flow (which still runs against "Epic") is unaffected.

> Note: e2e needs `SUPABASE_URL` + `SERVICE_ROLE_KEY` env (see `e2e/subitems.spec.ts:54-70`). If e2e can't run in this environment, log that it was skipped and rely on the unit tests + build for verification — do not claim e2e passed without seeing it pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/subitems.spec.ts
git commit -m "test(boards): e2e drag-reorder top-level item within a group"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full required suite**

Run each and confirm it passes (per AGENTS.md rule 4):

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # ESLint
pnpm test        # Vitest
pnpm build       # production build
```

Expected: all four succeed. Fix any failure before proceeding — do not claim done without the passing output.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Use the `verify` or `run` skill to launch the app, open a board with ≥2 items in a group, drag the second item above the first by its grip handle, and confirm the order persists after a refresh. Confirm dragging an item past the 12-row viewport edge auto-scrolls.

- [ ] **Step 3: Final commit (if Step 1 produced any fixups)**

```bash
git add -A
git commit -m "chore(boards): verification fixups for item drag-reorder"
```

---

## Self-Review Notes (author)

- **Spec coverage:** grip handle (Task 2), per-group `SortableContext` scoping (Task 2 Step 2), `reorderPosition` → `reorderItem` wiring with self-drop guard (Task 2 Step 1 + Task 3), translate-only transform / gotcha-20 (Task 2 Step 4), virtualization preserved + 0 round-trips until drop (no virtualizer changes; only drop calls the action), tests unit + e2e (Tasks 1, 3, 4), full verification (Task 5). All spec sections map to a task.
- **No new dependencies or imports** — every symbol used is already imported in `BoardTable.tsx`.
- **Type consistency:** `reorderPosition(list, activeId, overId): number | null`, `controls.reorderItem(itemId: string, position: number)`, `handleItemDragEnd(e: DragEndEvent)` — names match the verified signatures in `group-reorder.ts`, `use-board-mutations.ts`, and the `CellControls` type.
