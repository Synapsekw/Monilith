# Frozen Name column on horizontal scroll — design

**Date:** 2026-06-21
**Status:** Approved (brainstorm)
**Scope:** `src/components/boards/BoardTable.tsx` + its tests. No DB / server / API changes — purely client rendering.

## Problem

On the board table, scrolling **horizontally** carries the item Name column off-screen with
the data columns. The user wants the Name column to stay frozen on the left (Excel-style freeze
pane) so the row a value belongs to is always identifiable.

The Name column is **already coded to freeze** — `sticky left-0` is present on the Name header
(`NameColumnHeader`), the group bands, and the per-row name cells (`NameCell`). It only half
works: the header and group bands stay pinned, but the **item name cells scroll away**.

## Root cause

`BoardTable` has **two nested scroll containers**:

- Outer (`BoardTable.tsx:392`) — `flex-1 overflow-auto`, scrolls both axes. The sticky header
  (`sticky top-0`) and `NameColumnHeader`/group bands (`sticky left-0`) are direct children of
  this box, so they freeze correctly.
- Inner, per group (`BoardTable.tsx:937`) — `<div ref={scrollRef} className="overflow-auto"
style={{ height: viewportHeight }}>`. Caps each group at ~12 rows and scrolls within itself.
  The virtualized item rows (and their `NameCell`s) live **inside** this container.

`position: sticky` resolves to its **nearest** scroll-container ancestor. The name cells stick
to the _inner_ container, which never scrolls horizontally; when the _outer_ container scrolls
sideways, the whole inner block — name cells included — translates away with the content.

There is **no pure-CSS fix** on the inner container: `overflow-y: auto` forces it to be a scroll
container on both axes, which always captures the sticky. The nested horizontal-scroll situation
must be removed.

This is corroborated by observed behaviour: the Add-item / Add-subitem rows (rendered _outside_
the inner scroller) already freeze correctly; only the inner item rows do not.

## Decision

**One continuous scroll container** (the standard Monday/Airtable model). The outer container
becomes the sole scroll container for both axes; the per-group inner scroller is removed. This is
the lower-risk fix and makes the existing `sticky left-0` styling work with no change to the
sticky CSS itself.

**Trade-off accepted by the user:** groups no longer cap at ~12 rows with an inner scrollbar.
The whole board scrolls as one. (Approved.)

### Alternative considered (rejected)

Keep the per-group caps and freeze the Name column via a **two-pane split** (frozen left pane +
scrollable right pane) with JS-synced vertical scroll. Rejected: significantly more complex and
higher risk, with no benefit the user wants.

## Approach

### 1. Single scroll container

- The outer `flex-1 overflow-auto` (`:392`) stays as the only scroll container.
- Remove the per-group inner scroller: drop `overflow-auto` and the capped
  `style={{ height: viewportHeight }}` (`:937–940`). Each group renders its rows in a plain
  `position: relative` block sized to its full virtual height (`virtualizer.getTotalSize()`).
- With no scroll container between the name cells and the outer box, the existing
  `sticky left-0` on `NameColumnHeader`, group bands, and `NameCell` works unchanged.

### 2. Keep virtualization (bounded reads are a project invariant)

Per `CONTRIBUTING.md` / AGENTS.md, hot-path board reads must stay bounded — virtualization is
kept. Use the documented `@tanstack/react-virtual` (v3.14) "multiple lists, one scroll container"
pattern:

- `BoardTable` owns the outer scroll container ref and passes it to every `GroupSection` as a
  shared `scrollRef`.
- Each group's `useVirtualizer` uses `getScrollElement: () => sharedScrollRef.current` and
  `scrollMargin: <group row-area top offset within the scroll content>`.
- Each group measures its own row-area top offset via a ref + `useLayoutEffect`, re-measured when
  groups above it change height (expand/collapse, add/remove items). Rows position by
  `vr.start - virtualizer.options.scrollMargin`; the spacer block height stays
  `virtualizer.getTotalSize()`.

This preserves large-board performance (only visible rows render) while removing the nested
scroll that broke the freeze.

### 3. Frozen-column edge shadow (polish — included)

Add a subtle right-edge shadow on the frozen Name column that appears once the outer container's
`scrollLeft > 0`, so the column reads as a floating frozen pane. Implementation: track
`scrolledX` (boolean) from the outer container's scroll position and toggle a shadow utility
(e.g. an `inset`/`box-shadow` on the right edge of the sticky name header + cells). Uses Monolith
tokens; no new color. Disappears at `scrollLeft === 0`.

## Out of scope

- Freezing anything other than the Name column. The Add-item / Add-subitem rows already freeze
  correctly and are unchanged. No row-select checkbox or drag-handle pinning.
- Data-layer pagination (virtualization remains the bounding mechanism).

## Performance & data-fetching budget

- **First paint vs interaction:** unchanged. Horizontal/vertical scroll and the freeze are pure
  in-page client rendering — **0 new server round-trips**. No Server Action, no RSC navigation.
- **Server data:** the change touches none. No revalidation.
- **Bounded read:** rows remain virtualized (now against the shared outer scroll element). No
  unbounded `select *`; no change to queries or indexes.

## Testing

Vitest (jsdom). Sticky offsets aren't computed in jsdom, so tests assert the **structure that
makes the freeze correct**, not pixel positions:

1. **No nested scroll container** inside a group — the group row-area block is not
   `overflow-auto` (regression guard for the root cause).
2. **Sticky wiring present** — Name header and name cells carry `sticky left-0` and the expected
   stacking z-index above data cells.
3. **Virtualizer wiring** — groups virtualize against the shared outer scroll element with a
   `scrollMargin`, and render the expected subset of rows for a tall group.
4. **Edge shadow** — the frozen-column shadow class is absent at `scrollLeft === 0` and present
   once `scrolledX` is set.

Manual verification before "done": run the app, open a board wide enough to scroll horizontally,
confirm the Name column (header + cells + group bands) stays pinned while data columns scroll,
the edge shadow appears on horizontal scroll, and vertical scroll of a long board still works.

## Execution DAG

Single coherent change to one component + its tests — no independent parallelizable units.
One task, sequential: write tests (structure guards) → make the scroll-container/virtualizer
change → add edge shadow → verify gates + manual browser check.
