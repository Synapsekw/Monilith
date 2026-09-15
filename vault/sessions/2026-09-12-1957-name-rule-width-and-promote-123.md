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

- ~~Both fixes were verified against a static harness, not a live board~~ — **CLOSED**: the owner
  ran a full authenticated browser pass on 2026-09-12 across every shipped surface and reported
  everything OK. That also cleared the walkthroughs six earlier sessions had been carrying.
- ~~A row with an active Intelligence chip shows a 1px notch in its 2px rule~~ — **THE NOTCH NEVER
  EXISTED.** See the addendum below.
- The parent row's "(n)" child-count label isn't separately reserved in the width maths — a safe
  superset for 1–2 digit counts, theoretically ~2px short at three digits.
- `/sync-prod` not run; DEV and PROD data remain out of sync by design.

## Addendum (2026-09-12 21:00) — the notch that was never there

The whole-branch reviewer wrote that raising the row hairline to `z-20` cut "a deliberate 1px notch"
into the Board Intelligence tone rule. **That was an inference from class names, not an observation,
and it was wrong** — I relayed it to the owner as fact, and the owner reasonably asked for it to be
fixed. Measured against the compiled CSS in Chromium: `.intel-rule` occupies x=[0, 2] inside the
frozen Name cell, `ROW_HAIRLINE` is inset to `before:left-4` and occupies x=[16, row-width]. The two
boxes never share a horizontal pixel, so no z-index relationship between them is ever evaluated; the
rule was already unbroken, scrolled or not.

The fix, therefore, was to the comment, not the CSS (`1e073718`): the false claim is replaced with
the measured geometry, plus a test that reads the rule's real width out of `globals.css` and asserts
the hairline's inset still clears it — so genuine overlap fails CI instead of being re-argued from
class names.

**The lesson is about how a claim travels.** A reviewer's reasoning, a plan's assertion and a
measurement all arrive as prose and read alike; only one of them is evidence. Three defects on this
branch shared the shape "the class is right in the source and absent from the rendered page", so
the reviewer's story was *plausible* — which is exactly why it was repeated without being checked.
Say which one you have. See [[2026-09-12-gotcha-106-a-group-hover-variant-on-its-own-group-element-never-matches]].

Also in this addendum's window: **PR #124 promoted** (7 commits — the correction above, the
board-brief `/updates` entry, vault refreshes). `main` @ `4b4828df`, main CI green, Vercel
`state=success`, `/updates` verified serving "Board briefs arrive in seconds".

## Next session entry point

Nothing is owed on this work, and the visual debt is cleared — the owner's browser pass found no
defects. `develop` == `main` + the heal commit. The board's rank-1 item is now `requestShapeFor`,
which is wrong about five active models and exposes every adapter-routed feature.

## Related

Follows [[2026-09-12-1252-quiet-grid-inter-table]], which shipped the redesign these three fixes
complete.
