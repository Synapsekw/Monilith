---
type: session
date: 2026-09-12-1252
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  [
    "[[2026-09-12-gotcha-105-tailwind-merge-classifies-custom-text-tokens-as-colour]]",
    "[[2026-09-12-gotcha-106-a-group-hover-variant-on-its-own-group-element-never-matches]]",
  ]
---

# Quiet Grid board table + Inter everywhere

## What changed

- **Merged `e38287b7`** (`task/quiet-grid-inter`, 9 task commits + fix waves). Spec
  `docs/superpowers/specs/2026-09-12-quiet-grid-inter-design.md`, plan
  `docs/superpowers/plans/2026-09-12-quiet-grid-inter.md`.
- **Inter replaces Nunito Sans app-wide** — `layout.tsx` (`--font-inter`), `globals.css`
  (`--font-sans`/`--font-heading`, heading tracking `-0.02em`, `font-optical-sizing`), the landing
  module CSS, and the `pulse-ui` skill so a future session cannot restore the old face. **Nunito 800
  stays as the MONOLITH wordmark** (`src/lib/fonts.ts`) — documented in both brand files.
- **The board table lost its cage**: every `border-l` gone, gutters 12 → 16px, rows 36 → **42px**
  with an inset top hairline (`ROW_HAIRLINE`), a 2px periwinkle hover seam on the frozen name cell,
  an inset cell-hover outline, threaded **38px** subitems at a 40px indent, dashed add-rows, and the
  3px group rail replaced by an 8px dot on all three group surfaces.
- **Two new rem tokens** — `--text-cell` (13px), `--text-item` (13.5px). The plan had specified
  literal `text-[13px]`, which `scripts/check-px-text.mjs` rejects; design values unchanged, only
  the mechanism.
- **Choice was made from live prototypes, not screenshots**: four table directions, then four
  Quiet Grid build-outs crossed with four type systems, driven in-browser (the lab is scratch, not
  committed).
- `/updates`: **nothing announced yet** — this is on `develop`, unpromoted. Announce at promotion.

## Why

The table read as a spreadsheet: a hairline under every row and to the left of every cell, so the
grid competed with the data it held. Nunito Sans is a rounded humanist face whose numerals go soft
at the 13–14px a dense board uses. Both were judged together because a type swap changes how much
chrome a table needs.

## How to test (for the user)

1. `git checkout develop && git pull && pnpm install && pnpm dev`, then open any board.
2. **Look across a row** — there should be no vertical lines between columns at all. Scroll the
   board sideways: a soft shadow appears at the right edge of the frozen Name column, and only then.
3. **Hover a row** — a 2px periwinkle seam wipes in at the far left. **Click the row's checkbox** —
   the seam is replaced by a thicker 3px bar plus a periwinkle wash. The seam must never show on a
   selected row.
4. **Hover a single cell** — a rounded outline appears inside the cell ("this is editable"). Click
   it: the editor opens as before.
5. **Expand a parent item** (chevron). Subitems sit in a recessed band, indented, each hung off a
   thin thread line with a short elbow, and their names are one step smaller and lighter than the
   parent's. Collapse it again: the parent's cells show the rolled-up summary of its children.
6. **Check the separators** — every row boundary draws exactly one line, and all of them start at
   the same left inset, including above the "Add item" row and the group summary row.
7. **Scroll sideways with the "Add item" row visible** — it must stay frozen under the Name column,
   not scroll away with the data columns.
8. **Group headers** — a small colour dot sits next to the group name (not beside the checkbox),
   and the group name renders in full foreground, not grey.
9. Repeat 2–8 in **light mode** and in the **graphite** and **ember** theme presets
   (Settings → Preferences → Theme).

## Open threads

- **Unpromoted.** This rides the next `develop → main` promotion, together with the Board
  Intelligence latency fix. `/updates` entry owed at that point.
- `src/app/pricing/page.tsx:40` applies the Nunito wordmark face to the page `h1`, so the /pricing
  headline is now the only non-Inter heading in the app. Pre-existing, out of this branch's scope.
- `requestShapeFor`'s `/haiku/i` split is still wrong about five active models (carried from the
  previous session, untouched here).
- Deliberately shipped: `EditableCell`'s mirror-no-target em-dash is still `text-sm`, and a
  collapsed empty group draws no bottom line (whitespace carries it).

## Next session entry point

Promote `develop → main` (`/promote`) — the delta is this redesign plus the intelligence latency
fix — and announce the table redesign on `/updates` as part of it.
