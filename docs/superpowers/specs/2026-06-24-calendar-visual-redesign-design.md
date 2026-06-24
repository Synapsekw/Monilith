# Calendar view — visual redesign (timeline / duration-first)

**Date:** 2026-06-24
**Status:** Spec — pending review
**Surface:** `src/components/boards/CalendarBoard.tsx` (+ `src/lib/boards/calendar.ts`)
**Scope:** Visual redesign of the board Calendar view. Restyle the month grid, add **true
multi-day spanning bars**, and add **Week** and **Agenda** view modes. No schema changes.

---

## 1. Why

The current Calendar view is a functional but flat month grid with three concrete problems:

1. **Multi-day events don't span.** The data layer already computes `spanDays` / `startsHere`
   (`src/lib/boards/calendar.ts`), but the UI drops a _separate identical chip on each day_, so a
   5-day task reads as 5 unrelated items. This is the biggest visual defect.
2. **Undifferentiated grid.** Today, weekends, and out-of-month days barely separate; every cell
   reads at the same weight.
3. **Month-only.** No Week or Agenda mode — a baseline expectation for a calendar, and the natural
   "escape hatch" when a month gets too dense to show every span.

## 2. Chosen direction — "Timeline" (Option C)

Selected from three mocked directions (Crisp Grid / Soft Tinted / Timeline). The calendar is
built around **duration**: multi-day events are continuous bars laid into **lanes** so spans and
overlaps read instantly, with a thin monochrome "busyness" hint per day. Three view modes share
one lane-packing engine:

- **Month** — 6×7 grid; spans flow across days as bars; lanes **capped at 3**, overflow → popover.
- **Week** — all-day 7-column strip; full lanes, **no cap** (room to scroll). The detail escape hatch.
- **Agenda** — chronological, day-grouped list; naturally density-proof.

All three honor Pulse's **monochrome chrome + earned color**: chrome stays neutral, the brand
indigo marks today/active/focus, and the 8-color status palette is the only multi-color surface.

### Locked decisions

| Decision                 | Choice                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Overflow strategy        | **C1** — fixed-height rows, capped lanes + "+N more"                               |
| Month lane cap           | **3**                                                                              |
| "+N more" affordance     | **Day popover** (stay in Month; list that day's full set)                          |
| Single-day items (Month) | **Neutral/elevated bar + status-colored dot + name** (color reserved for spans)    |
| Multi-day spans          | **Solid status-colored bar**, rounded ends only at true start/end, name at start   |
| Unscheduled drawer       | **Removed** — undated items live in table/kanban; Calendar is date-based           |
| View mode state          | **Client state (`useState`)**, no persistence — matches existing `monthISO` cursor |

## 3. Data model — no changes

Reuse what exists; **no migration, no `database.types.ts` regen.**

- `resolveDateColumn(columns, config)` → active date column (unchanged).
- `itemDateRange(itemId, cellValues, dateColumnId)` → `{ start, end }` or `null` (unchanged).
  A single-day item has `start === end`; a span has `end > start`.
- `buildCalendarMonth(...)` already produces per-day `CalendarEvent[]` with `startsHere`/`spanDays`.
  It will be **extended** (not replaced) to also return per-week **lane assignments** so bars can be
  positioned with CSS grid `grid-column` spans.

## 4. Component & module design

Keep units small and single-purpose. New/changed pieces:

### 4.1 `src/lib/boards/calendar.ts` (extend)

- **`packLanes(spans, weekStartISO)`** — pure function. Greedy interval packing: sort spans by
  `(start asc, length desc)`, assign each the lowest lane whose last occupant ends before this
  span starts. Returns `{ lane, colStart, colEnd, continuesLeft, continuesRight }` per span, clipped
  to the week. Deterministic, fully unit-testable, no DOM, no `Date.now()`.
- **`weekBuckets(...)`** / **`agendaGroups(...)`** — helpers that bucket items into a single week
  (Sun–Sat) and into an ordered list of non-empty days, respectively. Pure.

### 4.2 `CalendarBoard.tsx` (restructure)

Becomes a thin shell: header + controls bar + `useState<'month'|'week'|'agenda'>` + `monthISO`/week
cursor, delegating to one of three presentational sub-views. Mutations (drag-to-reschedule, click
-to-create) stay as today via `useBoardMutations`. Split into:

- **`CalendarControls`** — month/week nav (‹ Today ›), period label, segmented **Month/Week/Agenda**
  toggle, "Date by" column picker. The segmented control is a monochrome `bg-elevated` track with
  the active segment in `bg-primary`.
- **`CalendarMonth`** — 6×7 ruled grid. Per week: render date headers + busyness hint, then a
  lane overlay (`packLanes`) of bars positioned by `grid-column`. Cap = 3 lanes; a per-day "+N more"
  pill row sits under the cap line and opens **`DayPopover`**.
- **`CalendarWeek`** — 7 day-column headers + a lane overlay with **no cap**; single-day items
  render below spans in their column. Scrolls vertically.
- **`CalendarAgenda`** — day-grouped list; each day shows date gutter + rows (status dot, name,
  span range pill `Jun 9–16`, status label). Empty days collapse to a thin "No items" row.
- **`DayPopover`** — shadcn `Popover`/`Dialog` anchored to a day; lists that day's full item set
  (reuses `EventChip`-style rows). Read + click-through to the item panel.

### 4.3 Shared leaf

- **`EventBar`** — replaces `EventChip`. Renders a span bar (filled status color, rounded ends
  gated on `continuesLeft/Right`) or a single-day bar (neutral surface + status dot). Keeps the
  existing **draggable** wiring (`useDraggable`, `presenceTarget.event`, `PresenceRing`) and status
  via `CellRenderer`. Status is **always dot/label + text**, never color-only (AA + colorblind).

### Visual tokens (reference)

Bars `rounded-md`; status fills from `bg-status-*`; single-day neutral bar `bg-surface-muted` +
hairline; today = `text-primary` date + `bg-primary/8` column tint; weekends `bg-surface-muted`;
out-of-month `opacity-50`; busyness hint = a 2px `bg-border-light`→`bg-muted-foreground` bar scaled
by item count (monochrome). Lucide icons `size-3.5`. Motion 150–250ms ease-out on popover/drag only.

## 5. Performance & data-fetching budget (working-agreement #5)

- **First paint:** unchanged — the RSC board page loads the board payload once into `useBoardCache`.
  No new server reads are introduced by this redesign.
- **Per interaction:** **0 server round-trips** for view-mode switch, month/week navigation, and
  "+N more" popover — all are client state / derived memo over the already-loaded cache. View mode
  is local `useState` (no `?view=` navigation, no `router.refresh`, no config write on toggle).
  - _Server writes only on genuine data change:_ drag-to-reschedule and click-to-create go through
    the existing `useBoardMutations` (optimistic) — same as today. "Date by" column change keeps the
    existing single `updateBoardView` Server Action + `router.refresh`.
- **Bounded & indexed:** the Calendar reads the in-memory board cache (already bounded by the board
  page's existing item query); lane packing is `O(items · lanes)` per visible week, computed in
  `useMemo` keyed on `cellValues`/cursor — no unbounded `select *`, no new query. If a board's item
  count later demands it, windowing the agenda list is a follow-up, not part of this spec.

## 6. Component isolation summary

| Unit               | Does                                | Used by              | Depends on                            |
| ------------------ | ----------------------------------- | -------------------- | ------------------------------------- |
| `packLanes`        | Pure lane assignment for a week     | Month, Week          | nothing (pure)                        |
| `CalendarControls` | Nav + mode toggle + date-col picker | `CalendarBoard`      | view-actions (date col only)          |
| `CalendarMonth`    | 6×7 grid + capped lanes + +N        | `CalendarBoard`      | `packLanes`, `EventBar`, `DayPopover` |
| `CalendarWeek`     | 7-col all-day strip, full lanes     | `CalendarBoard`      | `packLanes`, `EventBar`               |
| `CalendarAgenda`   | Day-grouped list                    | `CalendarBoard`      | `agendaGroups`, `CellRenderer`        |
| `DayPopover`       | Full day item list                  | `CalendarMonth`      | shadcn Popover, item panel link       |
| `EventBar`         | One span/single bar (draggable)     | Month, Week, Popover | dnd, presence, `CellRenderer`         |

Each is independently testable; `CalendarBoard` only wires state + cache.

## 7. Testing plan (mandatory — write + run)

**Unit (Vitest, pure — highest value):**

- `packLanes`: non-overlapping → all lane 0; two overlapping → lanes 0/1; greedy reuse of a freed
  lane; week-boundary clipping sets `continuesLeft/Right`; deterministic order for equal starts.
- `weekBuckets` / `agendaGroups`: correct day membership, empty-day handling, ordering.
- Extend existing `calendar.test.ts`; keep `onEventDropped` duration-preservation tests.

**Component (Vitest + Testing Library):**

- Month: a 4-lane week shows 3 bars + a "+1 more" pill on the right days; popover opens with the
  full set. Single-day = neutral bar + dot; span = filled bar spanning N columns.
- Mode toggle flips Month↔Week↔Agenda with **no router navigation** (assert no `router.push`/refresh).
- Today/weekend/out-of-month styling hooks present; empty state (no date column) unchanged.
- Drag-to-reschedule still fires `setCell` with shifted range (carry over current behavior).

**Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before merge.

## 8. Execution DAG (working-agreement #6)

**Interfaces:** T1 _produces_ `packLanes`/bucket helpers; T2–T4 _consume_ them; T5 is leaf used by
T2/T3; T6 wires all.

```
T1  packLanes + week/agenda helpers + unit tests        (lib, pure)        ── no deps
T5  EventBar leaf (span/single, draggable)              (component)        ── no deps
        │                                   │
        ▼                                   ▼
T2 CalendarMonth+DayPopover   T3 CalendarWeek   T4 CalendarAgenda  ── dep: T1 (+ T5 for T2,T3)
        └─────────────┬───────────────┴───────────────┘
                      ▼
T6  CalendarBoard shell: controls + mode state + wire-up + component tests ── dep: T2,T3,T4
```

- **Batch 1 (parallel):** T1, T5 — independent, no shared files.
- **Batch 2 (parallel):** T2, T3, T4 — each its own new file; depend on T1 (T2/T3 also on T5).
- **Batch 3:** T6 — integrates; touches `CalendarBoard.tsx`.
- **Critical path:** T1 → T2 → T6 (lane engine → month grid+popover → shell).
- Batch-2 tasks mutate separate new files; if run as parallel agents, isolate in worktrees per
  working-agreement #1.

## 9. Out of scope (YAGNI)

- No hourly/time-of-day grid (date columns are all-day).
- No schema/migration/types changes.
- No drag in Week/Agenda (Month drag carries over); no resize-to-extend-duration.
- No persisting view mode to `view.config` (client state only for now).
- No agenda virtualization (revisit only if board item counts demand it).
