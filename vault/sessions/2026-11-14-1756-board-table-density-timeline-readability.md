---
type: session
date: 2026-11-14-1756
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Board table density and timeline readability

## What changed

- **Board table** (`task/board-table-density`, merged `8b4283f6`): rows 42px → 28px (44px on coarse pointers) through `useRowHeight()`; Name cell with a narrow gutter, overlay hover buttons and a one-line hover peek; one sticky `BoardColumnHeader` per board and slim sticky group rows with count and "% done"; value columns with no saved width fit their content (`fitColumnWidth`, `resizeColumn(null)`, new `resetColumnWidths` action, "Fit all columns" in the board menu, double-click reset); value columns, headers and footers centered.
- **Timelines** (`task/timeline-readability`, merged `8e657170`): shared canvas opens on today with a Today handle, weekend shading, resizable name rail (`label_width` in the view config, localStorage per folder), date or "Nd late" beside short bars, band summary bars, collapsible group bands. Board timeline is grouped by board group with collapse shared with the table and the Board Intelligence late rule. Folder timeline opens roll-up first (one row per board). `FilterBar` shows a "Stages" menu above eight stages.
- **Group rows take the theme tint** (`6b2ed19c`, straight on `develop`): 8% brand mixed into the surface, Board Total stays at 14%.
- Process: two specs and plans, 17 build tasks by subagents in per-task worktrees, a review per task, a whole-branch review per branch. The whole-branch reviews found four cross-task defects (touch auto-fit reserve, focus under sticky rows, email/phone editor taller than the row, no-op rail writes); a browser pass on live DAAS data found a fifth (wide pills clipped on both sides, fixed with `justify-center-safe`).
- `/updates`: announced four entries for 2026-11-14 (see commit after this note).

## Why

On the real DAAS boards 32 of 33 visible item names were cut off, group titles read like column labels, a 22-column board was 4,615px wide, and both timelines opened nine months left of today. The folder timeline listed 2,127 items flat.

## How to test (for the user)

Setup: pull `develop`, `pnpm dev`, open `localhost:3000`. Nothing is in production until promotion.

1. DAAS → Programme Governance & PMO → Main Table: dense rows, one column header, tinted group row with "52" and "% done".
2. Scroll down: the column header and the current group title stay pinned.
3. Rest on a row whose name ends in "…": the full name unrolls with three buttons at its end.
4. Board menu → "Fit all columns": the Name column (saved at 830px on that board) and all value columns snap to content.
5. Drag a column edge, then double-click it: back to fitted width.
6. Timeline view: today's line about a third in; rows under group bands with "29% · 28 late"; late bars red-edged with "Nd late".
7. Collapse a group in Timeline, switch to Main Table: same group collapsed.
8. DAAS folder → Timeline: 11 board rows with % and late counts, one "All stages" menu; click a board for groups, a group for items.
9. Settings → Preferences → Theme: change preset, group rows change tint.

## Open threads

- Not browser-checked: iPad or coarse pointer, dark theme, the email/phone error popup, keyboard focus near pinned rows, rail width surviving a reload.
- Centering covers long text columns (Milestone, Notes); owner has not said whether to keep that.
- Email/phone cells now discard an invalid value on blur (matches number cells).
- Folder and board timelines can show slightly different "% · late" for one group (folder rollup counts top-level items only); aligning needs a migration.
- Timeline rows are 32px on touch, so 44px targets overlap neighbours; the table got 44px touch rows, the timeline did not.
- Font-loading logic exists twice (`useFontsReady`, `useTextMeasurer`) and `use-column-auto-fit.ts` has its own canvas measurer; unify on `src/lib/text-measure.ts`.
- `NameResizeHandle` still commits on a plain click for the table's Name column; `BoardTableInner.tsx` is over the max-lines warning.
- Two auto-drafts from other sessions (`_draft-2026-11-14-1100.md`, `_draft-2026-11-14-1301.md`) left untouched.

## Next session entry point

Promote `develop → main` when ready (`/promote`); before that, do the touch and dark-theme checks above on the DAAS boards. Then the font-measuring unification is the first cleanup.
