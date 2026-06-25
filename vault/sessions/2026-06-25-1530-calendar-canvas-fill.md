---
type: session
date: 2026-06-25-1530
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-24-2327-calendar-timeline-redesign]]"
---

# Calendar view — fill the canvas height

## What changed

- `CalendarMonth.tsx` — each week row gets `flex-1 min-h-0` so the 5–6 week rows distribute the full available height instead of piling at their `min-h-[6.5rem]` floor.
- `CalendarWeek.tsx` — the day-body grid gets `flex-1 min-h-0` so it expands below the header instead of stopping at its fixed `minHeight` (now just a floor).
- Committed `15d83b3` on `develop`, pushed to `origin/develop`. Calendar tests 27/27 green, lint clean.

## Why

Post-redesign, the month/week grids were sized to their minimum content height, so on tall viewports the rows stopped partway down and the leftover space showed as a solid `bg-border` (gray) block — the "not using the whole canvas" complaint. Pure layout polish on top of [[2026-06-24-2327-calendar-timeline-redesign]].

## How to test (for the user)

1. Pull `develop`.
2. Open any board with a Date column → switch to the **Calendar** view.
3. **Month** mode: the grid should now reach the bottom of the page — no gray empty band under the last week.
4. **Week** mode: the seven day columns should extend down the full available height.

## Open threads

- "Looks clean" is subjective — only the concrete canvas-fill issue was fixed. Possible follow-ups if it still feels off: month cell date contrast/sizing, week-view row guides for the now-taller empty columns, outer `px-4 py-3` vs edge-to-edge.
- Unrelated uncommitted edits remain untouched in the main checkout (`DashboardsNav`, deleted `GenerateWithAiButton`) — another session's.

## Next session entry point

`develop` bundle (calendar redesign + canvas-fill + everything since #30) is still un-promoted — run `/promote`, but first add `ANTHROPIC_API_KEY` to Vercel or the AI dashboard button errors in prod.
