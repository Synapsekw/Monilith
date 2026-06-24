---
type: session
date: 2026-06-24-2327
branch: develop
trigger: wrapup
status: complete
tags: [session, boards, calendar]
related:
  - "[[platform-roadmap]]"
---

# Calendar view — timeline (duration-first) redesign

## What changed

- Shipped the Calendar view redesign as merge `c549f82` on `develop` (14 task commits). New folder
  `src/components/boards/calendar/`: `EventBar`, `CalendarMonth`, `CalendarWeek`, `CalendarAgenda`,
  `CalendarControls`; pure helpers in `calendar.ts` (`packLanes`/`layOutWeek`/`weekStartOnOrBefore`)
  - new `calendar-agenda.ts`. `CalendarBoard.tsx` rewritten from a 567-line monolith into a ~237-line
    shell (client `mode`/`cursor` state, 0-refetch view switching).
- Features: true multi-day **spanning bars** in greedy-packed lanes; **Month / Week / Agenda** toggle;
  Month capped at 3 lanes with a **"+N more" day popover**; neutral single-day bars vs status-filled
  spans; weekend + today differentiation; per-day click-to-create; drag-to-reschedule retained; the
  Unscheduled drawer **removed** (undated items no longer render).
- Process: brainstormed via the visual companion (3 directions → "Timeline" chosen), spec + plan
  committed (`docs/superpowers/specs|plans/2026-06-24-calendar-visual-redesign-*`), built with
  subagent-driven development — 8 tasks, per-task spec+quality review, then a whole-branch review.
- Whole-branch review caught a cross-cutting bug task-scoped reviews couldn't: week-crossing spans
  registered the **same dnd-kit draggable id** per segment (`itemId-realStart`), colliding in the
  registry and breaking drag for Sat→Sun spans. Fixed: id discriminated by `weekStartISO`,
  `data.fromDayISO` kept as real start; added segment `aria-label`s.

## Why

The Calendar dropped a separate chip on each day of a multi-day item (a visual lie — a 5-day task
looked like 5 unrelated ones) and offered only a month grid. This gives duration-first spanning bars
plus Week/Agenda modes, in the dark-first monochrome + earned-color system. Pure visual/UX refresh of
the existing Phase 3 Calendar view; no schema changes.

## How to test (for the user)

1. Pull `develop`, `pnpm dev`, open a board with a **Date column**, open/add a **Calendar** view.
2. Give an item a **date range** (date cell start + end a few days apart) → Month view shows ONE
   continuous status-colored bar across those days (not a chip per day). Single-day items = neutral
   bar + status dot.
3. Pile 4+ overlapping multi-day items on the same days → only 3 lanes show; extra days show
   **"+N more"** → click it for a popover listing that day's hidden items.
4. Today is brand-highlighted, weekends subtly tinted, out-of-month dimmed.
5. Toggle **Month → Week → Agenda** — instant, no reload/refetch (check network tab). Week shows all
   overlapping spans uncapped; Agenda is a day-grouped list with date-range pills.
6. Click an empty day → creates a "New item" on that date. Drag a bar (incl. one crossing a week
   boundary) → dates shift by the delta.
7. An undated item does **not** appear anywhere in the calendar.

## Open threads

- **Bar/popover click → item panel** is wired end-to-end (`onOpenItem`) but `CalendarBoard` passes
  `undefined` — a deliberate stub (no regression; clicking a bar is a no-op today). A one-line caller
  lands the open-panel behavior later.
- Drop semantics: dropping a span sets its start to the target day (delta from real start). Confirm
  this matches desired UX vs. a grab-offset model.
- Ops gotcha: `finish-task.sh` gates on the full `pnpm test` (both vitest projects), so the live-DB
  integration flake blocks it; and `git worktree remove` fails "Directory not empty" when
  `.superpowers/` scratch lingers — needs a manual `git worktree remove --force` + `prune` after the
  merge has already landed.
- Production promotion still owed (gated on `ANTHROPIC_API_KEY` in Vercel) — unchanged by this session.

## Next session entry point

Calendar redesign is live on `develop`. Optional quick win: wire `onOpenItem` (bar/popover click →
ItemPanel). Otherwise resume Phase 9.3 cache / 9.4 skeletons, or run `/promote`.
