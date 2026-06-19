---
type: adr
status: accepted
date: 2026-06-19
tags: [adr, gotcha, dnd-kit, boards, frontend]
related:
  - "[[2026-06-19-1633-group-management-reorder-color-delete]]"
---

# Gotcha 20 — `CSS.Transform.toString` stretches variable-height dnd-kit sortable items

## Context

Group reordering uses `@dnd-kit/sortable`'s `useSortable`. The dragged element's
style was set with the library's default serializer:

```ts
style={{ transform: CSS.Transform.toString(transform), transition }}
```

Board groups have very different heights (a 0-item group is short; a 12-row group
is tall), and each group's body is a virtualized list of **absolutely-positioned**
rows (`position:absolute; transform: translateY(...)`).

## The trap

`useSortable`'s `transform` is `{ x, y, scaleX, scaleY }`, and
`CSS.Transform.toString` serializes **all four** → `translate3d(...) scaleX(..) scaleY(..)`.
With items of differing heights, dnd-kit populates non-1 `scaleX/scaleY`, and that
scale is applied to the dragged `<section>`. Because the virtual rows inside are
absolutely positioned, they scale with the parent → the rows render visibly
**stretched/squished**. Paired with an `opacity-70`, the dragged group looked like a
"ghosted, stretched" copy. Purely visual; no console error.

## Resolution / rule

- For sortable items whose **size differs** (or that contain absolutely-positioned
  children), serialize **translate only**: `CSS.Translate.toString(transform)` —
  drops the scale, keeps the follow-the-pointer movement. This matches the codebase's
  own working drag convention (`KanbanCard` emits a bare `translate3d(x,y,0)`).
- Convey "picked up" with an opaque lift (`z-20 shadow-lg`), not `opacity` — a
  translucent in-place item reads as a ghost, especially while it's mid-reflow.
- General lesson: `CSS.Transform` vs `CSS.Translate` is not interchangeable for
  variable-height sortables. Reach for `CSS.Translate` unless every item is identically
  sized and you actually want the morph-scale animation.
- Not unit-testable: the scale only appears under real layout + an active pointer drag,
  neither of which jsdom provides (`useSortable` returns `transform: null` without
  layout). Verify by dragging in the running app.
