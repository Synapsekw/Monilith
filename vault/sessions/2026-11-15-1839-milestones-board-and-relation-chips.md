---
type: session
date: 2026-11-15-1839
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Milestones board and status-tinted relation chips

## What changed

- **Milestone became a link, on live DEV data.** The 11 boards in folder "DAAS, RAAS" held Milestone
  as free text (162 labels over 2,127 items, 38 labels shared by several boards). New **Milestones**
  board `199711ae…` in the folder: 162 rows grouped MVP / Pilot / Scale, with Status, Start, Due and
  Programme. Each board got a relation column "Milestone" and 2,127 `relation_links`; the old column
  is kept as "Milestone (text)". Every step ran as one transaction after a rolled-back dry run;
  all links verified against the old text.
- Milestones Timeline now draws Start to Due bars (Start = earliest linked task start). The seven
  board editors were added as viewers of the Milestones board.
- **Relation column polish** merged to `develop` (`1c846265`, 24 files). Chips take the linked
  item's status colour, fill the cell, and open the linked item; editing moved to a hover pencil.
  Relation columns now auto-fit, and work in board filter (contains, equals, empties), quick search,
  sort and spreadsheet export. `getBoardPayload` reads linked items' status in two bounded reads
  alongside the names.
- Gates on the merged state: typecheck, lint (0 errors), 14,478 tests, build. Browser-checked on a
  local production build against Platform & Integrations.
- `/updates`: nothing announced. Not on `main` yet; announce at promotion.

## Why

The owner wanted Milestone to point at a real row so boards can be connected through it, then
found the new column unreadable (grey truncated pills) and the timeline empty of bars.

## How to test (for the user)

Run `develop` locally, or wait for promotion. The data side is already live.

1. Open folder "DAAS, RAAS", board "Platform & Integrations". Expect full-name Milestone chips:
   blue In Progress, green Completed, grey Not Started.
2. Click a chip. Expect the Milestones board with that milestone's panel open.
3. Back on the board, hover a row and click the pencil. Pick another milestone; the chip updates.
4. Type part of a milestone name in board search. Expect only rows linked to it.
5. Filter, add condition, Milestone, "contains", a word from a name. Expect the same rows.
6. Sort by Milestone. Expect rows ordered by milestone name.
7. Export the board. Expect names in the Milestone column.
8. Open Milestones, Timeline view. Expect bars from Start to Due, coloured by Status.

## Open threads

- "Milestone (text)" still exists on all 11 boards. Delete only after the owner confirms steps 5-7.
- Milestone Status, Start and Due are a one-time snapshot, not a roll-up from tasks; Owner is blank.
- Not browser-checked: the filter condition, sort result, export, dark theme, touch.
- A board viewer still gets the relation editor; the save fails with a toast (`EditableCell` never
  passes `readOnly`, pre-existing).
- Dashboard widgets and automations filter in SQL over `cell_values`, so they cannot match a
  relation column; reports render relation cells blank.
- Smaller: fit width misjudges multi-link cells; a self-relation chip does a full navigation; a
  newly picked item no other row links to stays neutral until reload.
- The Monolith MCP connector failed with "Invalid Refresh Token"; data work went through SQL.

## Next session entry point

Promote `develop`, walk the test list on production, then decide on deleting "Milestone (text)".
The natural next build is a live milestone roll-up (status and dates from linked tasks).
