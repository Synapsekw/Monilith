---
type: adr
status: accepted
date: 2026-08-27
tags:
  [project/monolith, adr, decision, accessibility, dnd-kit, boards, deferred-debt]
related:
  - "[[00-north-star]]"
  - "[[2026-08-11-gotcha-89-five-tests-that-could-not-fail-in-one-plan]]"
  - "[[2026-08-27-1400-sidebar-folders-hardening]]"
---

# Decision 41 — Seven drag surfaces announce a keyboard lift they do not have, and that is deferred on purpose

> If you are here because a screen-reader user reported "Space does nothing on this drag handle":
> that is this. It is known, it is listed below, and the fix is **not** "turn the keyboard sensor on
> globally" — read [Why not just enable it everywhere](#why-not-just-enable-it-everywhere) first.

## Context

`@dnd-kit` spreads a `attributes` object onto every drag handle. Among those attributes is
`aria-roledescription="draggable"` plus the default screen-reader instructions, which announce
some variant of **"To pick up a draggable item, press the space bar."**

That announcement is only true if the `DndContext` carries a `KeyboardSensor`. Ours did not — on any
surface. Every drag handle in the app told assistive-technology users about a keyboard affordance
that did nothing when they used it.

The 2026-08-27 sidebar-folders hardening slice fixed exactly one surface (the Boards nav) by making
`useTouchAwareSensors` take an **opt-in** coordinate getter:

```ts
useTouchAwareSensors(options?: { keyboardCoordinateGetter?: KeyboardCoordinateGetter })
```

With no argument the returned sensor list is byte-identical to before — PointerSensor + TouchSensor.
`BoardsNavSortable` is the only caller that passes one (`sortableKeyboardCoordinates`).

That leaves the rest untouched, and this ADR is the record of which "rest".

## The complete inventory

Eight `DndContext` instances ship in `src/`. One now has a keyboard path; **seven do not.**

| # | `DndContext` owner | Handle component that spreads `attributes` | Geometry | Keyboard path today |
| - | ------------------ | ------------------------------------------ | -------- | ------------------- |
| 1 | `src/components/boards/BoardsNavSortable.tsx` | `SortableBoardRow`, `DraggableSharedRow`, filed rows | vertical list + folder drop targets | ✅ `sortableKeyboardCoordinates` |
| 2 | `src/components/boards/KanbanBoard.tsx` | `KanbanBoard.tsx:535` | **cross-container** — card moves between columns | ❌ none |
| 3 | `src/components/boards/GanttBoard.tsx` | `src/components/boards/gantt/GanttRowItem.tsx` (`dragHandlers = {...listeners, ...attributes}`) | **horizontal** — bar slides along a day axis | ❌ none |
| 4 | `src/components/boards/CalendarBoard.tsx` | `src/components/boards/calendar/EventBar.tsx` (3 spread sites: month, week, agenda) | **2-D grid** — drops onto a date cell | ❌ none |
| 5 | `src/components/boards/table/BoardTableInner.tsx` | `table/ItemRow.tsx:89`, and group headers via `table/GroupSection.tsx:207` → `table/GroupHeaderRow.tsx:122` | vertical rows **and** whole groups, nested | ❌ none |
| 6 | `src/components/boards/table/GroupHeaderRow.tsx` (its own inner context, for column reorder) | `table/SortableColumnHeader.tsx` → `ColumnHeader`'s `handleAttributes` | **horizontal** — column order | ⚠️ partial: the header menu offers "Move left" / "Move right", which ARE keyboard-reachable. The space-bar announcement is still false. |
| 7 | `src/components/boards/table/SubitemBlock.tsx` | `table/SortableSubitemRow.tsx:57` | vertical list, nested inside a row | ❌ none |
| 8 | `src/components/boards/ColumnOptionsDialog.tsx` | `ColumnOptionsDialog.tsx:284` | vertical list **inside a modal** — Space/Escape already mean something to the dialog | ❌ none |

**Correction to the spec.** `docs/superpowers/specs/2026-08-27-sidebar-folders-hardening-design.md`
says "eight surfaces" remain. The prose is off by one: eight `DndContext`s exist in total, of which
the Boards nav is now fixed, so **seven** remain. The spec's own *named* list (Kanban, Gantt,
Calendar, BoardTable, GroupHeaderRow, SubitemBlock, ColumnOptionsDialog) is seven and is correct.

## Decision

**Accept the gap for now, on the record.** Do not enable a keyboard sensor on surfaces 2–8, and do
not suppress the announcement either. Schedule the real fix as its own slice.

## Why not just enable it everywhere

`sortableKeyboardCoordinates` resolves arrow keys by picking the nearest droppable **in the pressed
direction**. It is the right strategy for a vertical sortable list. It is wrong, or merely
arbitrary, for most of the table above:

- **Kanban** is cross-container. Up/Down should walk within a column and Left/Right should change
  column; `sortableKeyboardCoordinates` has no notion of that distinction and would announce a move
  that lands somewhere the user did not mean.
- **Gantt** bars move along a continuous day axis, not between discrete droppables. There is no
  "next droppable up" to snap to.
- **Calendar** is a 2-D date grid where Left/Right and Up/Down have obvious, different meanings
  (day vs. week) that a generic nearest-rect strategy does not encode.
- **BoardTable** drags rows *and* groups *and* columns, in nested contexts.
- **ColumnOptionsDialog** is a modal: Space and Escape are already claimed by the dialog, so a lift
  bound to Space needs an explicit interaction contract, not a default.

Turning the sensor on globally would swap one accessibility lie ("Space picks it up" → nothing
happens) for a subtler and harder-to-notice one ("Space picks it up" → arrows move it somewhere
unannounced or wrong), across seven surfaces, none of which would get a manual acceptance pass in a
debt-paydown slice. It would also re-open five test files for no verified benefit.

## Why not suppress the announcement instead

Overriding each `DndContext`'s `accessibility.screenReaderInstructions` would make the announcement
truthful by *removing the promise*. It is small per surface, but it is seven surfaces and seven test
files, and it moves us further from the correct end state rather than closer. We would be paying to
make the app quieter about a missing feature.

## Consequences

- **Assistive-technology users are told about a keyboard drag that does not work on seven surfaces.**
  That is a real, live defect, not a hypothetical. It is accepted for now, not fixed.
- Every affected surface still has a non-drag path to the same outcome — the `⋯` menus, the column
  header's Move left/right, the item panel — so nothing is *unreachable* by keyboard. Only the drag
  gesture itself is.
- `useTouchAwareSensors()` with no argument returning **exactly two sensors** is asserted by
  `src/lib/dnd/sensors.test.ts`. That test is what keeps surfaces 2–8 frozen: if someone enables the
  keyboard sensor globally, it goes red before their change reaches those seven test files.

## The follow-up this defers to

One slice per geometry group, each with its own coordinate strategy and its own manual acceptance
pass:

1. **Vertical lists** — `SubitemBlock`, `ColumnOptionsDialog`, `BoardTableInner`'s row/group drags.
   `sortableKeyboardCoordinates` is very likely correct; the work is the acceptance pass, plus the
   modal's Space/Escape contract.
2. **Horizontal** — column reorder. Probably a bespoke getter, or just formally adopt the existing
   Move left/right menu items as *the* keyboard path and drop the false announcement on that one
   surface only.
3. **Cross-container / 2-D** — Kanban, Calendar, Gantt. Each needs a real coordinate getter and a
   real design decision about what the arrow keys mean. This is the expensive third.

Until (1)–(3) land, this file is the answer to "why does Space do nothing here".
