---
type: session
date: 2026-09-12-1957
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-12-1252-quiet-grid-inter-table]]"]
---

# Name-column rule, hairline stacking, auto-fit width — and PR #123

## What changed

- **Promoted PR #123** (51 commits): `main` @ `156565eb`, Vercel `state=success`, main CI green.
  Verified by content, not status — `/updates` serves all three new entries and home returns 200.
  Squash divergence healed (`50fc72b4`, `-s ours`).
- **One vertical rule restored, by owner request** (`470d486c`, `29c5329d`): a permanent hairline at
  the frozen Name column's right edge, as a shared `NAME_FREEZE_RULE` spent by every surface that
  spans that column. `AddSubitemRow` was restructured like `AddItemRow` (full-width hairline host +
  inner name-width element) because without it the rule had a visible gap at that row.
- **Row separators were invisible across the Name column** (`ad681cf2`) — `ROW_HAIRLINE`'s `::before`
  had no z-index and the frozen cell is `sticky z-10` with an opaque background, so the cell painted
  over the line. `before:z-20` fixes every surface at once (z-20 matches `.intel-rule`'s precedent).
- **Name column auto-fit was 137px too narrow** (`72d99315`): the flat `PADDING = 60` ignored the
  checkbox, drag handle, chevron, add-subitem button and row menu (all `opacity-0` but space-taking).
  Replaced with browser-measured reserves — 197 editor / 173 viewer / 129 subitem — plus a separate
  `NAME_COL_AUTOFIT_MAX = 640` so one pasted paragraph-name can't swallow the table; manual drag
  still goes to 1200.
- `/updates`: three entries announced (`98e01201`) — the calmer table, the new typeface, the
  truncation fix.

## Why

The redesign shipped with a table that read as too open: the owner wanted exactly one vertical line,
between the item name and the data columns. Looking at that change then exposed two defects the
original work had hidden — separators occluded by the frozen column, and an auto-fit that truncated
names with empty space beside them.

## How to test (for the user)

Production is live at `www.monolith.works`; open any board.

1. Look down the Name column's right edge — one continuous vertical line, top to bottom, through
   every row type including both add-rows. No other vertical lines anywhere in the table.
2. Look across any row boundary — the horizontal separator now runs unbroken across the Name column
   AND the data columns, and meets the vertical rule as a clean single-pixel cross.
3. Find a board with long item names — names that used to truncate with space beside them now fit.
   A board of short names still gets a snug column, not an empty one.
4. Expand a parent: subitem rows show the same rule and separators, and their (indented) names are
   measured for the width they actually need.
5. Drag the Name column past 640px — a deliberate drag still goes up to 1200 and sticks.

## Open threads

- **Both fixes were verified against a static harness** (compiled CSS + real component markup), not a
  live rendered board — the DEV fixture tenants have no items. Box-model numbers are solid; not
  proof against live React/dnd-kit.
- A row with an active Intelligence chip shows a 1px notch in its 2px rule where the separator
  crosses. Deliberate and consistent; give the intel rule the higher z if it should stay unbroken.
- The parent row's "(n)" child-count label isn't separately reserved in the width maths — a safe
  superset for 1–2 digit counts, theoretically ~2px short at three digits.
- `/sync-prod` not run; DEV and PROD data remain out of sync by design.

## Next session entry point

Nothing is owed on this work. `develop` == `main` + the heal commit; the next build starts clean.

## Related

Follows [[2026-09-12-1252-quiet-grid-inter-table]], which shipped the redesign these three fixes
complete.
