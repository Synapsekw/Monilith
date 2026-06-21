---
type: adr
date: 2026-06-21
status: accepted
tags: [decision, gotcha]
related:
  - "[[2026-06-21-1946-name-col-resize-snapback-fix]]"
  - "[[2026-06-19-1018-name-column-resize-autofit]]"
---

# Gotcha 33: pointer-drag widths must be rounded before they hit an int-validated action

## Context

Column resize handles computed `startW + (event.clientX - startX)` and sent the
result straight to a server action validated with `z.number().int()`. On a Retina
Mac under browser zoom or fractional display scaling, `clientX` is **sub-pixel**,
so the width was a non-integer (e.g. `347.5`). Zod rejected it, the action
returned `fail()`, the React Query mutation threw, and `onError` rolled back the
optimistic cache.

The failure was asymmetric and so easy to misdiagnose: the **Name** column
cleared its live drag width on release, so the rollback was visible as a
snap-back to auto-fit; the **configurable** columns kept their `liveWidths`
entry, so the identical server failure was invisible (the width just never
persisted across reload).

## Decision

Round + clamp any pointer-derived numeric value to the action's contract before
it leaves the client. Added a pure `clampDragWidth(value, min, max)` =
`Math.round(clamp(...))` in `src/lib/boards/name-column-width.ts`, used by both
resize handlers.

## Rationale

The server's `.int()` schema is the contract; the client must satisfy it. Fixing
at the source (the drag math) is cheaper and more correct than loosening the
schema to `z.number()`, which would let fractional widths into the DB and the
CSS grid. A masked optimistic-rollback (the configurable-column case) is a trap —
prefer not clearing live state OR guarantee the persisted value is valid; here we
do the latter.

## Consequences

- Positive: Name resize persists; configurable columns now actually persist too;
  one shared helper, unit-tested.
- Negative: none material — widths are integer pixels by design.
- Open follow-ups: any future pointer-derived value sent to an int-validated
  action (offsets, positions, scroll) needs the same rounding at the boundary.

## Related

- [[2026-06-21-1946-name-col-resize-snapback-fix]]
- [[2026-06-19-1018-name-column-resize-autofit]]
