# Frozen Name Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI styling steps must load the `pulse-ui` skill first.

**Goal:** Make the board table's Name column stay frozen on the left during horizontal scroll (Excel-style freeze pane), with a right-edge shadow once scrolled.

**Architecture:** The freeze styling (`sticky left-0`) already exists but is defeated by a per-group nested scroll container. Collapse to a **single scroll container** (the existing outer `flex-1 overflow-auto`), keep `@tanstack/react-virtual` virtualization by pointing every group's virtualizer at the shared outer scroll element with a measured `scrollMargin` (the documented "multiple lists, one scroll container" pattern). Add a theme-aware right-edge shadow on the frozen column driven by a `data-scrolledx` flag on the scroll container.

**Tech Stack:** Next.js 16 RSC + client components, React 19, `@tanstack/react-virtual` v3.14, Tailwind v4, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-21-frozen-name-column-design.md`

**Single file touched:** `src/components/boards/BoardTable.tsx` (+ `BoardTable.test.tsx`). No DB / server / API changes.

---

## File Structure

- `src/components/boards/BoardTable.tsx` — `BoardTable` owns the shared scroll container ref + `scrolledX` state; `GroupSection` switches from a private scroll container to the shared element with `scrollMargin`; `NameColumnHeader` + `NameCell` gain the freeze-edge shadow.
- `src/components/boards/BoardTable.test.tsx` — structural regression guards (jsdom can't compute sticky offsets, so we assert the structure that makes the freeze correct).

### Key reference points (line numbers approximate — verify before editing)

- Outer scroll container: `BoardTable.tsx:392` — `<div className="flex-1 overflow-auto">`
- Content wrapper: `:393` — `<div className="min-w-fit">`
- `GroupSection` render site (props passed): `:452-474`
- `GroupSection` definition + props type: `:747-785`
- `GroupSection` private `scrollRef`: `:789`
- `useVirtualizer`: `:816-824`
- `viewportHeight` cap: `:828-829`
- Per-group scroll container + spacer + rows: `:937-991`
- `NameColumnHeader` sticky header: `:587`
- `NameCell` editing branch sticky: `:1607`
- `NameCell` display branch sticky: `:1633`
- Constants: `ROW_HEIGHT = 36` (`:166`), imports at `:3`.

---

## Task 0: Create the worktree

**Files:** none (environment setup)

- [ ] **Step 1: Cut a task worktree off latest `origin/develop`**

Run from the main checkout (`/Users/danijeljovanovic/Dev/Monolith`):

```bash
scripts/start-task.sh frozen-name-column
```

Expected: creates branch `task/frozen-name-column` in worktree `.claude/worktrees/frozen-name-column`, pins commit identity to `Danijel Jovanovic <info@synapse-solutions.ai>`.

- [ ] **Step 2: Re-root the session into the worktree**

Use the `EnterWorktree` tool: `EnterWorktree({ path: ".claude/worktrees/frozen-name-column" })`. All subsequent edits/commands run there. (Tooling note: inside the worktree, CLI bins resolve via the inherited main `node_modules`; if a bin isn't on PATH, prefix with `node_modules/.bin/`. Run `pnpm build` from the main checkout if it fails to resolve in the worktree — per the worktree-gates memory.)

---

## Task 1: Failing structural tests

**Files:**

- Test: `src/components/boards/BoardTable.test.tsx`

These guard the three things that make the freeze correct: (a) no nested scroll container inside a group, (b) the frozen column carries the freeze-edge marker, (c) the scroll container flips `data-scrolledx` on horizontal scroll. They also keep virtualization alive (tall group renders a subset).

- [ ] **Step 1: Add a many-items fixture + the failing tests**

Append to `src/components/boards/BoardTable.test.tsx`:

```tsx
function manyItemsPayload(count: number) {
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
    items: Array.from({ length: count }, (_, i) => ({
      id: `t${i + 1}`,
      board_id: "b1",
      org_id: "o1",
      group_id: "g1",
      parent_id: null,
      name: `Task ${i + 1}`,
      position: i,
    })),
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderMany(count: number) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={manyItemsPayload(count)} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable frozen Name column", () => {
  it("does not wrap group rows in a nested scroll container (regression: sticky freeze)", () => {
    renderMany(3);
    const rows = screen.getByTestId("group-rows-g1");
    expect(rows.className).not.toMatch(/overflow-(auto|scroll|x|y)/);
  });

  it("keeps virtualization: a tall group renders a subset of its rows", () => {
    renderMany(60);
    // Top rows render; far-bottom rows are virtualized out of the DOM.
    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.queryByText("Task 60")).not.toBeInTheDocument();
  });

  it("marks the Name header and name cells as the freeze edge", () => {
    renderMany(1);
    // Name column header carries the freeze-edge marker.
    const headers = document.querySelectorAll(".name-freeze-edge");
    expect(headers.length).toBeGreaterThan(0);
  });

  it("flips data-scrolledx on the scroll container during horizontal scroll", () => {
    renderMany(1);
    const scroller = screen.getByTestId("board-scroll");
    expect(scroller).toHaveAttribute("data-scrolledx", "false");
    scroller.scrollLeft = 120;
    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute("data-scrolledx", "true");
  });
});
```

- [ ] **Step 2: Run the new tests; verify they FAIL**

Run: `pnpm test -- BoardTable.test.tsx -t "frozen Name column"`
Expected: FAIL — `getByTestId("group-rows-g1")` and `getByTestId("board-scroll")` not found, `.name-freeze-edge` count 0. (The "subset" test may currently pass or fail depending on current structure — that's fine; it must pass after the change.)

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/components/boards/BoardTable.test.tsx
git commit -m "test(boards): structural guards for frozen Name column"
```

---

## Task 2: Shared scroll container + scrolledX in `BoardTable`

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`

- [ ] **Step 1: Add the isomorphic-layout-effect import + helper**

Change the React import at `:3` from:

```tsx
import { useMemo, useRef, useState, useTransition } from "react";
```

to:

```tsx
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
```

Add directly below the imports block (near the top-level constants, e.g. after `:60`):

```tsx
// useLayoutEffect warns during SSR; this client component still pre-renders on
// the server, so fall back to useEffect there.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
```

- [ ] **Step 2: Add the scroll refs + scrolledX state in `BoardTable`**

Inside the `BoardTable` component body (near the other `useState`/`useRef` hooks — search for the first `useState(` inside `export function BoardTable`), add:

```tsx
const scrollContainerRef = useRef<HTMLDivElement>(null);
const contentRef = useRef<HTMLDivElement>(null);
const [scrolledX, setScrolledX] = useState(false);
```

- [ ] **Step 3: Wire the outer scroll container (`:392-393`)**

Replace:

```tsx
      <div className="flex-1 overflow-auto">
        <div className="min-w-fit">
```

with:

```tsx
      <div
        ref={scrollContainerRef}
        data-testid="board-scroll"
        data-scrolledx={scrolledX}
        onScroll={(e) => {
          const next = e.currentTarget.scrollLeft > 0;
          // setState bails out when unchanged, so this only re-renders on the
          // 0 ⇄ >0 boundary (cheap during scroll).
          setScrolledX(next);
        }}
        className="group/scroll flex-1 overflow-auto"
      >
        <div ref={contentRef} className="min-w-fit">
```

- [ ] **Step 4: Pass the refs down to every `GroupSection` (`:452-474`)**

Add these two props to the `<GroupSection ... />` JSX (alongside the existing props):

```tsx
scrollContainerRef = { scrollContainerRef };
contentRef = { contentRef };
```

- [ ] **Step 5: Typecheck (expect a type error in `GroupSection` props — proceed to Task 3)**

Run: `pnpm typecheck`
Expected: errors that `GroupSection` has no props `scrollContainerRef` / `contentRef` (resolved in Task 3). No commit yet.

---

## Task 3: Single-scroll virtualization in `GroupSection`

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`

- [ ] **Step 1: Add the new props to `GroupSection`'s destructure + type (`:747-785`)**

Add to the destructured params:

```tsx
  scrollContainerRef,
  contentRef,
```

Add to the props type object:

```tsx
scrollContainerRef: React.RefObject<HTMLDivElement | null>;
contentRef: React.RefObject<HTMLDivElement | null>;
```

- [ ] **Step 2: Replace the private `scrollRef` (`:789`) with row-area ref + scrollMargin state**

Replace:

```tsx
const scrollRef = useRef<HTMLDivElement>(null);
```

with:

```tsx
const rowAreaRef = useRef<HTMLDivElement>(null);
const [scrollMargin, setScrollMargin] = useState(0);

// The group's row-area offset within the shared scroll content. Re-measured
// whenever the content height changes (any group expand/collapse/add/remove)
// and on every render (covers DnD reorder, which shifts offsets without
// changing total height). Guarded setState avoids a layout-effect loop.
useIsoLayoutEffect(() => {
  const measure = () => {
    const area = rowAreaRef.current;
    const scroller = scrollContainerRef.current;
    if (!area || !scroller) return;
    const top =
      area.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin((prev) => (prev === top ? prev : top));
  };
  measure();
  const content = contentRef.current;
  if (!content) return;
  const ro = new ResizeObserver(measure);
  ro.observe(content);
  return () => ro.disconnect();
});
```

- [ ] **Step 3: Point the virtualizer at the shared scroll element + scrollMargin (`:816-824`)**

Replace:

```tsx
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => ROW_HEIGHT,
  overscan: 6,
  // getBoundingClientRect().height returns 0 in jsdom — fall back to ROW_HEIGHT
  // so tests don't collapse all virtual rows to 0px height.
  measureElement: (el) => el.getBoundingClientRect().height || ROW_HEIGHT,
});
```

with:

```tsx
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => ROW_HEIGHT,
  overscan: 6,
  scrollMargin,
  // getBoundingClientRect().height returns 0 in jsdom — fall back to ROW_HEIGHT
  // so tests don't collapse all virtual rows to 0px height.
  measureElement: (el) => el.getBoundingClientRect().height || ROW_HEIGHT,
});
```

- [ ] **Step 4: Remove the `viewportHeight` cap (`:826-829`)**

Delete these lines:

```tsx
const virtualRows = virtualizer.getVirtualItems();
// Cap the scroll viewport; long/expanded groups scroll inside it.
const viewportHeight =
  Math.min(virtualizer.getTotalSize(), 12 * ROW_HEIGHT) || ROW_HEIGHT;
```

and replace with:

```tsx
const virtualRows = virtualizer.getVirtualItems();
```

- [ ] **Step 5: Collapse the nested scroll container to a single relative spacer (`:937-945` and its closing tags)**

Replace the opening:

```tsx
                <div
                  ref={scrollRef}
                  className="overflow-auto"
                  style={{ height: viewportHeight }}
                >
                  <div
                    className="relative"
                    style={{ height: virtualizer.getTotalSize() }}
                  >
```

with:

```tsx
                <div
                  ref={rowAreaRef}
                  data-testid={`group-rows-${group.id}`}
                  className="relative"
                  style={{ height: virtualizer.getTotalSize() }}
                >
```

Then remove the now-extra closing `</div>` that previously closed the outer `overflow-auto` wrapper. The block that was `:990-991`:

```tsx
                  </div>
                </div>
```

becomes a single:

```tsx
                </div>
```

(Net: one fewer `<div>` open and one fewer close. Verify the JSX still balances with `pnpm typecheck`.)

- [ ] **Step 6: Offset rows by scrollMargin (`:955-956`)**

Replace the virtual row wrapper style:

```tsx
                          className="absolute top-0 left-0 w-full"
                          style={{ transform: `translateY(${vr.start}px)` }}
```

with:

```tsx
                          className="absolute top-0 left-0 w-full"
                          style={{
                            transform: `translateY(${
                              vr.start - virtualizer.options.scrollMargin
                            }px)`,
                          }}
```

- [ ] **Step 7: Run typecheck + the structural tests**

Run: `pnpm typecheck`
Expected: PASS (no missing-prop or balance errors).

Run: `pnpm test -- BoardTable.test.tsx -t "frozen Name column"`
Expected: the "nested scroll container", "subset", and "data-scrolledx" tests PASS; the "freeze edge" test still FAILS (shadow added in Task 4).

- [ ] **Step 8: Commit**

```bash
git add src/components/boards/BoardTable.tsx
git commit -m "fix(boards): single scroll container so Name column freezes on horizontal scroll"
```

---

## Task 4: Freeze-edge shadow on the Name column

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`

> **Load the `pulse-ui` skill before this task** (UI styling). The shadow must use Pulse's dark-first tokens; tune the gradient opacity to read as depth on both themes. The classes below are the starting point.

- [ ] **Step 1: Define the shared freeze-edge class constant**

Add near the top-level constants (after `ROW_HEIGHT`, ~`:166`):

```tsx
// Right-edge shadow for the frozen Name column. The `group/scroll` ancestor
// (the scroll container) toggles `data-scrolledx`; the ::after only shows once
// scrolled, so it reads as a floating frozen pane over the data columns.
const NAME_FREEZE_EDGE =
  "name-freeze-edge after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-4 after:translate-x-full after:bg-gradient-to-r after:from-black/15 after:to-transparent after:opacity-0 after:transition-opacity after:content-[''] group-data-[scrolledx=true]/scroll:after:opacity-100";
```

- [ ] **Step 2: Apply to the Name column header (`:587`)**

Append `${NAME_FREEZE_EDGE}` to the `NameColumnHeader` sticky wrapper className. Change:

```tsx
    <div className="bg-surface-muted sticky left-0 z-10 flex items-center truncate px-4 py-1.5">
```

to:

```tsx
    <div
      className={cn(
        "bg-surface-muted sticky left-0 z-10 flex items-center truncate px-4 py-1.5",
        NAME_FREEZE_EDGE,
      )}
    >
```

(`cn` is already imported in this file.)

- [ ] **Step 3: Apply to the `NameCell` display branch (`:1633`)**

Change:

```tsx
    <div className="group/name bg-surface hover:bg-surface-muted sticky left-0 z-10 flex h-full items-center pr-2 transition-colors">
```

to:

```tsx
    <div
      className={cn(
        "group/name bg-surface hover:bg-surface-muted sticky left-0 z-10 flex h-full items-center pr-2 transition-colors",
        NAME_FREEZE_EDGE,
      )}
    >
```

- [ ] **Step 4: Apply to the `NameCell` editing branch (`:1607`)**

Change:

```tsx
      <div className="bg-surface sticky left-0 z-10 flex items-center px-4">
```

to:

```tsx
      <div
        className={cn(
          "bg-surface sticky left-0 z-10 flex items-center px-4",
          NAME_FREEZE_EDGE,
        )}
      >
```

- [ ] **Step 5: Run the full freeze test group**

Run: `pnpm test -- BoardTable.test.tsx -t "frozen Name column"`
Expected: all four tests PASS (including the `.name-freeze-edge` marker test).

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/BoardTable.tsx
git commit -m "feat(boards): freeze-edge shadow on the frozen Name column"
```

---

## Task 5: Full gate

**Files:** none (verification)

- [ ] **Step 1: Run the full board test file**

Run: `pnpm test -- BoardTable.test.tsx`
Expected: PASS (all existing tests + the 4 new ones).

- [ ] **Step 2: Run the complete gate**

Run (from the main checkout if `build` won't resolve in the worktree):

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four PASS. Do not claim done until every one passes (evidence before assertions — `verification-before-completion`).

- [ ] **Step 3: Manual browser verification**

Run the app, open a board with enough columns to scroll horizontally and a group with >12 items:

1. Scroll right → the Name column (header + cells) and group bands stay pinned on the left; data columns scroll under them.
2. The freeze-edge shadow appears once scrolled right and disappears back at the left edge.
3. Scroll down a long board → vertical scroll works as one continuous board (no per-group inner scrollbars); rows virtualize (no jank).
4. Expand/collapse a group and a subitem parent → rows below reposition correctly (scrollMargin re-measures).

---

## Task 6: Finish + handoff

**Files:** none (integration)

- [ ] **Step 1: Merge to develop + clean up**

Run from inside the worktree:

```bash
scripts/finish-task.sh
```

Expected: merges `task/frozen-name-column` into `develop`, pushes, removes the worktree, deletes the branch. If gate checks fail spuriously inside the worktree (binaries/build), run them manually per the worktree-gates memory, then merge by hand.

- [ ] **Step 2: Hand the user a "How to test this" walkthrough**

Provide the numbered manual-test guide (Task 5 Step 3) in the closing message, and include it in the `/wrapup` session note.

---

## Self-Review (completed by plan author)

- **Spec coverage:** single scroll container (Task 3) ✓; keep virtualization via shared element + scrollMargin (Task 3) ✓; edge shadow (Task 4) ✓; tests for no-nested-scroll / sticky marker / virtualization / shadow toggle (Tasks 1, 3, 4) ✓; performance budget — 0 new round-trips, virtualization retained (no server changes in any task) ✓; out-of-scope items untouched (no row-select/handle pinning) ✓.
- **Type consistency:** `scrollContainerRef` / `contentRef` defined in Task 2, consumed with matching `React.RefObject<HTMLDivElement | null>` type in Task 3; `rowAreaRef`, `scrollMargin`, `NAME_FREEZE_EDGE`, `useIsoLayoutEffect` all defined before use.
- **No placeholders:** every code step shows the exact before/after.

## Execution DAG

Strictly sequential — one file, interdependent edits. Task 0 → 1 → 2 → 3 → 4 → 5 → 6. No parallelizable batch (single coherent component change). Critical path = the whole chain.
