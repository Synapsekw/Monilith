---
type: session
date: 2026-11-12-2224
branch: develop
trigger: wrapup
status: complete
tags: [session, design-system, theming]
related:
  - "[[2026-11-12-decision-42-themes-reach-the-content-and-may-carry-two-accents]]"
  - "[[2026-11-12-visual-refresh-design]]"
---

# Visual refresh — themes reach the content

## What changed

- **Theme reach** (`data-theme-reach`: Subtle / Tinted / Vivid, Tinted default): a derived layer in
  `globals.css` mixes the preset's brand into the content card, raised surfaces, hover and selected.
  New Preferences rows "Theme reach" and "Celebrate completed items"; migration
  `20261112164935_profile_theme_reach` (two additive `profiles` columns), DEV ledger 177/177.
- **Three gradient presets** (Aurora, Sunset, Nebula) through a new seed token `--brand-2`; gradient
  sanctioned on primary button, active sidebar indicator, progress fills and chart spectrum only.
- **Charts**: `--chart-1..5` follow the brand; categorical colours 2–6 are hue rotations of the
  brand (`oklch(from var(--brand) …)`); circular charts draw at rest; new legend with colour key,
  name and value; donut centre total (hidden for averages).
- **Mono + empty states** on Goals, Portfolios, My Time, Ask; page/board/dashboard titles at one
  20px bold scale; **done burst + pill pop** on the user's own status edit in the board table.
- Process: 9 tasks in 4 batches via subagents, then a whole-branch review (4 Important, all fixed)
  and a 36-shot real-browser harness pass (6 defects fixed). Merged `a25d1249`; gates: typecheck,
  lint 0 errors, 10,993 tests / 1 skipped, build.
- `/updates`: announced the theme reach, gradient themes, chart and celebration changes for
  2026-11-12.

## Why

The owner asked for a UI review and found the first, structural pass thin: the app should look and
feel better. The review showed presets only repainted the frame (content card identical in every
theme) and the app had none of the landing page's personality. Decision-42 changes the
monochrome-chrome and single-accent rules on purpose.

## How to test (for the user)

After the promotion PR is merged, on https://www.monolith.works (hard refresh once):

1. Open any board. Expected: the content area carries a faint tint of your theme colour (you are on
   Forest: slightly green), not flat black. Hover a row: the hover is tinted too.
2. Settings → Preferences → **Theme**: pick **Aurora**, **Sunset**, then **Nebula**. Expected: tiles
   show a gradient pill; the primary buttons (e.g. "New agent", "New goal") become a two-colour
   gradient; the selected tile has a ring and a check.
3. Same page → **Theme reach**: switch Subtle → Tinted → Vivid. Expected: Subtle is the old look;
   Vivid is stronger and adds a soft glow behind the page header (most visible in dark mode). Reload:
   the choice sticks with no flash.
4. Folders → **DAAS Launch Plan Overview** dashboard. Expected: pie/donut charts are full circles,
   the donut shows a total in the centre, every legend entry has a colour key and a value, and chart
   colours follow your theme.
5. Open a board whose FIRST status column has an option containing "Done" or "Complete"; change an
   item to it in the table. Expected: the pill pops and a short burst of small squares plays. Change
   it to a non-done status: pop only.
6. Preferences → turn **Celebrate completed items** off, repeat step 5. Expected: nothing plays.
7. Open **My Time** on a week with no rows (or Goals/Portfolios in an empty org, or Ask → New chat).
   Expected: Mono with a title, one line of guidance and the page's existing action button.
8. Click a board title to rename it. Expected: the text stays 20px bold while editing.

## Open threads

- **Board-table selected row is weaker than a hovered row** at Tinted/Vivid: `ItemRow.tsx` /
  `NameCell.tsx` use `bg-primary/[0.08]`, not `bg-state-selected`. Hot surface; needs its own change.
- Theme **preset** still survives sign-out on a shared browser (reach and celebrate are cleared).
- Celebration is table-only (not Kanban, item panel, quick-edit) and plays before the save confirms.
- The "clipped pie" seen in the review could not be reproduced on a clean load; likely frame
  throttling in the automated browser. The fix stands (charts no longer depend on an animation).
- Chart side-legend overflow fix and light-mode chart fade were not verified in a browser.
- Deferred by spec: custom accent colour, daily ring, component polish (item panel, group spine,
  list pages, ⌘K), and the structural work (Home page, My Work rebuild, sidebar regroup).
- No local authenticated browser check was possible (no test account; DEV is live data) — the
  harness at `node_modules/.cache/visual-harness/` rendered real components with the real stylesheet.

## Next session entry point

Verify the walkthrough above on production after the promotion merges, then pick up the board-table
selected-row fix or the Home / My Work spec from the first review
(https://claude.ai/artifact/JgTmDjhP8gTGhbQWZRb1rn).
