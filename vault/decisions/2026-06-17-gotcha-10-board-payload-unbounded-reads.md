---
type: adr
date: 2026-06-17
status: accepted
tags: [gotcha, performance, data-fetching, boards, scaling]
related:
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Gotcha 10 — getBoardPayload reads items/cell_values/dependencies unbounded

## Context

`getBoardPayload` (`src/lib/boards/queries.ts`) fetches `items`, `cell_values`, and
`item_dependencies` with `select("*")` and no `.limit()`. While fixing slow board switching
(see the board-switch perf work, 2026-06-17) we confirmed the DB is currently tiny
(~110 items, ~42 cell_values, ~8 dependencies total), so these reads are NOT the cause of
the switch slowness and cost effectively nothing today.

## Decision

Leave the reads unbounded for now (YAGNI), but record that on a hot path they MUST become
bounded before any board grows to hundreds of items / thousands of cell_values. The filter
columns (`board_id`) are indexed, so the work is pagination/virtualization of the read, not
indexing.

## Consequences

- No change now.
- Before boards scale: page/virtualize the `items`/`cell_values` reads (the board cache and
  Table already virtualize rendering; the _fetch_ would need bounding too), and reassess
  `item_dependencies` growth.
