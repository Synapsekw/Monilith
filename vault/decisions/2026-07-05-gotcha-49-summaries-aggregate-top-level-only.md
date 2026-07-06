---
type: adr
date: 2026-07-05
status: accepted
tags: [decision, gotcha, boards, summaries, subitems, aggregation]
related:
  - "[[2026-07-05-1054-subitem-aware-summaries]]"
---

# Gotcha 49: column summaries aggregated top-level rows only, so subitem/rollup data was invisible

## Context

The board table's column-summary footer (`SummaryRow` → `FooterCell` → pure `aggregate()`) computes
per-column aggregates (avg/sum/count/distribution/…). A user set **Average** on a **percent** column
and saw nothing rendered.

## The trap

`aggregate()` and `footerColumnValues()` are pure over a **flat list of item ids** — and every caller
passed **top-level ids only** (`topLevel` for the master, a group's top-level rows for each group).
But two things conspire on a percent column:

- A parent's percent cell is a **rollup** — it _displays_ the average of its subitems
  (`rollup.ts`) but that value is **derived at render, never stored**.
- If the real data lives on subitems (DEV board: 82 percent cells, all `parent_id is not null`, **0**
  on top-level), the footer's raw `cellMap` lookup returns all-`null` → `numericValues` is `[]` →
  `aggregate` hits the `nums.length === 0 → EMPTY` early-return → renders nothing.

So the UI shows rolled-up percent bars on parents while the footer, reading only stored top-level
cells, is blind to the data. The pure math was correct and unit-tested — the defect was purely in
**which rows the summary counted**. This is invisible on any board whose data happens to sit on
top-level rows, which is why it survived.

## Decision

Summaries aggregate over the **subitem-expanded** id set, via one pure helper
`withSubitems(itemIds, childrenByParent)` (`item-tree.ts`) fed to both the master footer (whole
board) and each group row (group + its subitems). Every **stored** cell is counted **once**;
render-only rollup parent values are never double-counted (for percent the parent stores `null`).
This applies to **all** aggregations, not just avg — Count/Sum/etc. now include subitems too
(explicitly chosen: "true average of all cells").

## Consequences

- Any **new** summary/aggregation surface must aggregate over `withSubitems(...)`, not raw top-level
  ids, or it will silently miss subitem data. Treat `withSubitems` as the canonical "rows a summary
  counts" source.
- Count/Sum totals on boards with subitems are now **larger** than before (they include subitems) —
  intended, not a regression.
- The pure `aggregate()` math and the rollup cell rendering were left untouched; only the id set fed
  in changed. No schema/migration.
