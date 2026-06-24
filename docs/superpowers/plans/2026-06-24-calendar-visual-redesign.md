# Calendar View Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the board Calendar view around duration — true multi-day spanning bars laid into lanes, plus Month / Week / Agenda view modes — without any schema change.

**Architecture:** A pure lane-packing core in `src/lib/boards/calendar.ts` (greedy interval packing per week) feeds three presentational sub-views (Month, Week, Agenda) and a controls bar. `CalendarBoard.tsx` becomes a thin shell holding `viewMode` + `cursorISO` client state and wiring the existing board cache + mutations. View-mode switching and navigation are pure client state (0 server round-trips). Multi-day data already exists in `itemDateRange`.

**Tech Stack:** Next.js 16 (App Router, RSC), React, TypeScript (strict), Tailwind v4 + shadcn/ui, @dnd-kit/core, Vitest + Testing Library, Zustand-backed board cache.

## Global Constraints

- **Design system (pulse-ui):** monochrome chrome + earned color. Use semantic tokens only (`bg-surface`, `bg-surface-muted`, `text-muted-foreground`, `border`, `bg-primary`, `ring-ring`). No raw Tailwind colors. The brand indigo (`primary`) marks today/active/focus. Status option colors (inline `style` from `option.color` + `pillTextColor`) are the only multi-color surface — never color-only; always pair with text.
- **Date math:** never use argless `new Date()` or `Date.now()` in `src/lib/boards/calendar.ts` (it must stay pure/testable). Use the existing `parseISO`/`formatISO`/`addDaysISO`/`diffDaysISO` helpers. ISO date strings are `YYYY-MM-DD` and compare correctly with lexicographic `<`/`>`.
- **No new server reads.** View-mode switch, month/week navigation, and the "+N more" popover are client state / `useMemo` over the already-loaded `useBoardCache`. No `?view=` navigation, no `router.refresh` for these. Mutations (drag-to-reschedule, click-to-create, date-column change) use the existing `useBoardMutations` / `updateBoardView` paths unchanged.
- **Accessibility:** every interactive element keyboard-reachable with a visible `focus-visible` ring; icon-only controls get `aria-label`.
- **Commit identity (pinned):** author every commit as `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage explicitly by path — never `git add -A`/`.`. Commit subject lowercase after `type(scope):`; include a body line + `Co-Authored-By` trailer.
- **Gates (must pass before merge):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## File map

| File                                                                | Responsibility                                              | Task |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | ---- |
| `src/lib/boards/calendar.ts` (modify)                               | Add `packLanes`, `layOutWeek`, `weekStartOnOrBefore`, types | T1   |
| `src/lib/boards/calendar.test.ts` (modify)                          | Unit tests for the above                                    | T1   |
| `src/lib/boards/calendar-agenda.ts` (create)                        | `agendaGroups` pure helper                                  | T2   |
| `src/lib/boards/calendar-agenda.test.ts` (create)                   | Unit tests for agenda grouping                              | T2   |
| `src/components/boards/calendar/EventBar.tsx` (create)              | Draggable span/single bar leaf + `statusOptionColor`        | T3   |
| `src/components/boards/calendar/EventBar.test.tsx` (create)         | EventBar render tests                                       | T3   |
| `src/components/boards/calendar/CalendarMonth.tsx` (create)         | 6×7 grid, capped lanes, +N popover                          | T4   |
| `src/components/boards/calendar/CalendarMonth.test.tsx` (create)    | Month + overflow tests                                      | T4   |
| `src/components/boards/calendar/CalendarWeek.tsx` (create)          | All-day 7-col strip, uncapped lanes                         | T5   |
| `src/components/boards/calendar/CalendarWeek.test.tsx` (create)     | Week render test                                            | T5   |
| `src/components/boards/calendar/CalendarAgenda.tsx` (create)        | Day-grouped list                                            | T6   |
| `src/components/boards/calendar/CalendarAgenda.test.tsx` (create)   | Agenda render test                                          | T6   |
| `src/components/boards/calendar/CalendarControls.tsx` (create)      | Nav + Month/Week/Agenda toggle + date-col picker            | T7   |
| `src/components/boards/calendar/CalendarControls.test.tsx` (create) | Controls test                                               | T7   |
| `src/components/boards/CalendarBoard.tsx` (rewrite)                 | Shell: state + cache wiring + sub-view dispatch             | T8   |
| `src/components/boards/CalendarBoard.test.tsx` (modify)             | Update: drop Unscheduled, add mode-switch/no-nav tests      | T8   |

---

### Task 1: Lane-packing core (`packLanes` + `layOutWeek`)

**Files:**

- Modify: `src/lib/boards/calendar.ts` (append new exports; keep existing `buildCalendarMonth`/`onEventDropped`/`addDaysISO`/`diffDaysISO` untouched)
- Test: `src/lib/boards/calendar.test.ts` (append a `describe` block)

**Interfaces:**

- Consumes: existing `itemDateRange` (from `@/lib/boards/dates`), `addDaysISO`, `diffDaysISO`, private `parseISO` (same module).
- Produces:
  - `type WeekInterval = { itemId: string; name: string; startCol: number; endCol: number; continuesLeft: boolean; continuesRight: boolean; isSingle: boolean }` — `startCol`/`endCol` are 1-based (Sun=1..Sat=7), clipped to the week.
  - `type PlacedInterval = WeekInterval & { lane: number }` — `lane` is 0-based.
  - `function packLanes(intervals: WeekInterval[]): PlacedInterval[]`
  - `function layOutWeek(weekStartISO: string, items: { id: string; name: string }[], cellValues: CacheCellValue[], dateColumnId: string): PlacedInterval[]`
  - `function weekStartOnOrBefore(dateISO: string): string` — the Sunday on/before `dateISO`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/boards/calendar.test.ts`:

```ts
import {
  packLanes,
  layOutWeek,
  weekStartOnOrBefore,
  type WeekInterval,
} from "@/lib/boards/calendar";

describe("packLanes", () => {
  const iv = (over: Partial<WeekInterval>): WeekInterval => ({
    itemId: "x",
    name: "x",
    startCol: 1,
    endCol: 1,
    continuesLeft: false,
    continuesRight: false,
    isSingle: true,
    ...over,
  });

  it("puts non-overlapping intervals on lane 0", () => {
    const out = packLanes([
      iv({ itemId: "a", startCol: 1, endCol: 2 }),
      iv({ itemId: "b", startCol: 4, endCol: 5 }),
    ]);
    expect(out.every((p) => p.lane === 0)).toBe(true);
  });

  it("stacks overlapping intervals onto separate lanes", () => {
    const out = packLanes([
      iv({ itemId: "a", startCol: 1, endCol: 4 }),
      iv({ itemId: "b", startCol: 2, endCol: 5 }),
    ]);
    const lanes = Object.fromEntries(out.map((p) => [p.itemId, p.lane]));
    expect(lanes.a).toBe(0);
    expect(lanes.b).toBe(1);
  });

  it("reuses a freed lane once an interval has ended", () => {
    const out = packLanes([
      iv({ itemId: "a", startCol: 1, endCol: 2 }),
      iv({ itemId: "b", startCol: 1, endCol: 7 }),
      iv({ itemId: "c", startCol: 4, endCol: 5 }),
    ]);
    const lanes = Object.fromEntries(out.map((p) => [p.itemId, p.lane]));
    // a(lane0,cols1-2) frees lane0 before c(cols4-5); b takes lane1.
    expect(lanes.a).toBe(0);
    expect(lanes.b).toBe(1);
    expect(lanes.c).toBe(0);
  });
});

describe("layOutWeek", () => {
  const items = [
    { id: "i1", name: "Span" },
    { id: "i2", name: "Single" },
  ];
  // Week of Sun 2026-06-07 .. Sat 2026-06-13
  const cells = [
    {
      item_id: "i1",
      column_id: "d1",
      value: { date: "2026-06-05", end: "2026-06-09" },
    },
    { item_id: "i2", column_id: "d1", value: { date: "2026-06-10" } },
  ] as never;

  it("clips a span that started before the week and flags continuesLeft", () => {
    const out = layOutWeek("2026-06-07", items, cells, "d1");
    const span = out.find((p) => p.itemId === "i1")!;
    expect(span.startCol).toBe(1); // clipped to Sunday
    expect(span.endCol).toBe(3); // 2026-06-09 = Tuesday
    expect(span.continuesLeft).toBe(true);
    expect(span.continuesRight).toBe(false);
    expect(span.isSingle).toBe(false);
  });

  it("places a single-day item in one column flagged isSingle", () => {
    const out = layOutWeek("2026-06-07", items, cells, "d1");
    const single = out.find((p) => p.itemId === "i2")!;
    expect(single.startCol).toBe(4); // 2026-06-10 = Wednesday
    expect(single.endCol).toBe(4);
    expect(single.isSingle).toBe(true);
  });

  it("excludes items outside the week", () => {
    const out = layOutWeek("2026-06-14", items, cells, "d1");
    expect(out).toHaveLength(0);
  });
});

describe("weekStartOnOrBefore", () => {
  it("returns the Sunday on or before a date", () => {
    expect(weekStartOnOrBefore("2026-06-10")).toBe("2026-06-07"); // Wed -> Sun
    expect(weekStartOnOrBefore("2026-06-07")).toBe("2026-06-07"); // Sun -> itself
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/lib/boards/calendar.test.ts`
Expected: FAIL — `packLanes`/`layOutWeek`/`weekStartOnOrBefore` are not exported.

- [ ] **Step 3: Implement the core**

Append to `src/lib/boards/calendar.ts` (after the existing `onEventDropped`):

```ts
// ---------------------------------------------------------------------------
// Lane packing (Month / Week views)
// ---------------------------------------------------------------------------

export type WeekInterval = {
  itemId: string;
  name: string;
  /** 1-based column, Sun=1 .. Sat=7, clipped to the visible week. */
  startCol: number;
  endCol: number;
  /** True when the real range began before this week's Sunday. */
  continuesLeft: boolean;
  /** True when the real range ends after this week's Saturday. */
  continuesRight: boolean;
  /** True when the item's real range is a single day (start === end). */
  isSingle: boolean;
};

export type PlacedInterval = WeekInterval & { lane: number };

/**
 * Greedy interval packing within one week. Sort by (startCol asc, width desc,
 * itemId) for determinism, then assign each interval the lowest lane whose last
 * occupant ends strictly before this interval starts.
 */
export function packLanes(intervals: WeekInterval[]): PlacedInterval[] {
  const sorted = [...intervals].sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      a.itemId.localeCompare(b.itemId),
  );
  const laneEnd: number[] = []; // last endCol occupied per lane
  const placed: PlacedInterval[] = [];
  for (const iv of sorted) {
    let lane = 0;
    while (laneEnd[lane] !== undefined && laneEnd[lane] >= iv.startCol) lane++;
    laneEnd[lane] = iv.endCol;
    placed.push({ ...iv, lane });
  }
  return placed;
}

/** The Sunday on or before dateISO (YYYY-MM-DD). */
export function weekStartOnOrBefore(dateISO: string): string {
  const dow = new Date(parseISO(dateISO)).getUTCDay(); // 0 = Sunday
  return addDaysISO(dateISO, -dow);
}

/**
 * Lay out every item whose date range overlaps the 7-day week beginning at
 * weekStartISO (a Sunday). Returns packed lane assignments for rendering bars
 * with CSS-grid column spans.
 */
export function layOutWeek(
  weekStartISO: string,
  items: { id: string; name: string }[],
  cellValues: CacheCellValue[],
  dateColumnId: string,
): PlacedInterval[] {
  const weekEndISO = addDaysISO(weekStartISO, 6);
  const intervals: WeekInterval[] = [];
  for (const item of items) {
    const range = itemDateRange(item.id, cellValues, dateColumnId);
    if (!range) continue;
    if (range.end < weekStartISO || range.start > weekEndISO) continue; // no overlap
    const startOffset = diffDaysISO(weekStartISO, range.start); // may be < 0
    const endOffset = diffDaysISO(weekStartISO, range.end); // may be > 6
    intervals.push({
      itemId: item.id,
      name: item.name,
      startCol: Math.max(1, startOffset + 1),
      endCol: Math.min(7, endOffset + 1),
      continuesLeft: startOffset < 0,
      continuesRight: endOffset > 6,
      isSingle: range.start === range.end,
    });
  }
  return packLanes(intervals);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/lib/boards/calendar.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/calendar.ts src/lib/boards/calendar.test.ts
git -c user.name="Danijel Jovanovic" -c user.email="info@synapse-solutions.ai" \
  commit -m "feat(boards): add calendar lane-packing core

Greedy per-week interval packing (packLanes/layOutWeek) plus
weekStartOnOrBefore, feeding the redesigned month/week calendar bars."
```

---

### Task 2: Agenda grouping helper

**Files:**

- Create: `src/lib/boards/calendar-agenda.ts`
- Test: `src/lib/boards/calendar-agenda.test.ts`

**Interfaces:**

- Consumes: `itemDateRange` (`@/lib/boards/dates`), `CacheCellValue` (`@/lib/boards/cache`).
- Produces:
  - `type AgendaItem = { itemId: string; name: string; range: { start: string; end: string } }`
  - `type AgendaGroup = { dateISO: string; items: AgendaItem[] }`
  - `function agendaGroups(fromISO: string, toISO: string, items: { id: string; name: string }[], cellValues: CacheCellValue[], dateColumnId: string): AgendaGroup[]` — chronological, only days that have items; an item anchors on `max(range.start, fromISO)`; items whose range ends before `fromISO` or starts after `toISO` are excluded.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/calendar-agenda.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { agendaGroups } from "@/lib/boards/calendar-agenda";

const items = [
  { id: "i1", name: "Early span" },
  { id: "i2", name: "Mid single" },
  { id: "i3", name: "Out of range" },
];
const cells = [
  {
    item_id: "i1",
    column_id: "d1",
    value: { date: "2026-05-30", end: "2026-06-02" },
  },
  { item_id: "i2", column_id: "d1", value: { date: "2026-06-02" } },
  { item_id: "i3", column_id: "d1", value: { date: "2026-07-15" } },
] as never;

describe("agendaGroups", () => {
  const groups = agendaGroups("2026-06-01", "2026-06-30", items, cells, "d1");

  it("returns only days that have items, chronologically", () => {
    expect(groups.map((g) => g.dateISO)).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("anchors a span that started before the window on fromISO", () => {
    const first = groups[0];
    expect(first.dateISO).toBe("2026-06-01");
    expect(first.items[0].itemId).toBe("i1");
    expect(first.items[0].range).toEqual({
      start: "2026-05-30",
      end: "2026-06-02",
    });
  });

  it("excludes items outside the window", () => {
    expect(groups.flatMap((g) => g.items).some((i) => i.itemId === "i3")).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/boards/calendar-agenda.test.ts`
Expected: FAIL — module `calendar-agenda` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/boards/calendar-agenda.ts`:

```ts
import type { CacheCellValue } from "@/lib/boards/cache";
import { itemDateRange } from "@/lib/boards/dates";

export type AgendaItem = {
  itemId: string;
  name: string;
  range: { start: string; end: string };
};

export type AgendaGroup = {
  dateISO: string;
  items: AgendaItem[];
};

/**
 * Group items by day within [fromISO, toISO], chronologically. Only days that
 * have items are returned. An item that began before the window anchors on
 * fromISO; items entirely outside the window are excluded.
 */
export function agendaGroups(
  fromISO: string,
  toISO: string,
  items: { id: string; name: string }[],
  cellValues: CacheCellValue[],
  dateColumnId: string,
): AgendaGroup[] {
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const range = itemDateRange(item.id, cellValues, dateColumnId);
    if (!range) continue;
    if (range.end < fromISO || range.start > toISO) continue;
    const anchor = range.start < fromISO ? fromISO : range.start;
    const list = byDay.get(anchor) ?? [];
    list.push({ itemId: item.id, name: item.name, range });
    byDay.set(anchor, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dateISO, items]) => ({ dateISO, items }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/boards/calendar-agenda.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/calendar-agenda.ts src/lib/boards/calendar-agenda.test.ts
git -c user.name="Danijel Jovanovic" -c user.email="info@synapse-solutions.ai" \
  commit -m "feat(boards): add agenda grouping helper

Pure day-grouping of dated items within a window for the calendar
Agenda view; spans anchor on the window start."
```

---

### Task 3: `EventBar` leaf (draggable span/single bar)

**Files:**

- Create: `src/components/boards/calendar/EventBar.tsx`
- Test: `src/components/boards/calendar/EventBar.test.tsx`

**Interfaces:**

- Consumes: `PlacedInterval` (T1), `useDraggable` (@dnd-kit/core), `presenceTarget` + `usePresenceFocus` + `PresenceRing` (existing), `cellKey` + `CacheColumn` + `BoardCache` (`@/lib/boards/cache`), `pillTextColor` (`@/lib/boards/contrast`), `ColumnOption` (`@/lib/validations/boards`).
- Produces:
  - `type ChipDragData = { itemId: string; fromDayISO: string; dateColumnId: string }`
  - `function statusOptionColor(statusColumn: CacheColumn | undefined, cellMap: Map<string, BoardCache["cellValues"][number]["value"]>, itemId: string): string | null`
  - `function EventBar(props: { interval: PlacedInterval; fromDayISO: string; dateColumnId: string; statusColumn: CacheColumn | undefined; cellMap: Map<string, BoardCache["cellValues"][number]["value"]>; onOpen?: (itemId: string) => void }): JSX.Element` — renders a filled status-colored bar for spans (rounded ends gated on `continuesLeft/Right`, name shown unless `continuesLeft`), or a neutral surface bar + status dot for single-day items.

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/calendar/EventBar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { EventBar, statusOptionColor } from "./EventBar";
import type { PlacedInterval } from "@/lib/boards/calendar";

const statusColumn = {
  id: "s1",
  kind: "status",
  name: "Status",
  settings: { options: [{ id: "o1", label: "Done", color: "#46d18a" }] },
} as never;

function placed(over: Partial<PlacedInterval>): PlacedInterval {
  return {
    itemId: "i1",
    name: "Task",
    startCol: 1,
    endCol: 1,
    continuesLeft: false,
    continuesRight: false,
    isSingle: true,
    lane: 0,
    ...over,
  };
}

const renderBar = (interval: PlacedInterval, cellMap = new Map()) =>
  render(
    <DndContext>
      <EventBar
        interval={interval}
        fromDayISO="2026-06-10"
        dateColumnId="d1"
        statusColumn={statusColumn}
        cellMap={cellMap}
      />
    </DndContext>,
  );

describe("statusOptionColor", () => {
  it("resolves the option color for an item's status value", () => {
    const cellMap = new Map([["i1:s1", { optionId: "o1" }]]);
    expect(statusOptionColor(statusColumn, cellMap, "i1")).toBe("#46d18a");
  });
  it("returns null when no status is set", () => {
    expect(statusOptionColor(statusColumn, new Map(), "i1")).toBeNull();
  });
});

describe("EventBar", () => {
  it("shows the item name on a span that starts in view", () => {
    renderBar(placed({ name: "Launch", isSingle: false, endCol: 3 }));
    expect(screen.getByText("Launch")).toBeInTheDocument();
  });
  it("renders a single-day item with its name", () => {
    renderBar(placed({ name: "Standup" }));
    expect(screen.getByText("Standup")).toBeInTheDocument();
  });
  it("hides the name on a span continuing from a previous week", () => {
    renderBar(
      placed({
        name: "Carryover",
        isSingle: false,
        endCol: 3,
        continuesLeft: true,
      }),
    );
    expect(screen.queryByText("Carryover")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/calendar/EventBar.test.tsx`
Expected: FAIL — `./EventBar` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/boards/calendar/EventBar.tsx`:

```tsx
"use client";

import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { cellKey } from "@/lib/boards/cache";
import { pillTextColor } from "@/lib/boards/contrast";
import { presenceTarget } from "@/lib/boards/presence-target";
import { usePresenceFocus } from "@/lib/boards/use-presence-focus";
import { PresenceRing } from "@/components/boards/presence/PresenceRing";
import type { PlacedInterval } from "@/lib/boards/calendar";
import type { ColumnOption } from "@/lib/validations/boards";

export type ChipDragData = {
  itemId: string;
  fromDayISO: string;
  dateColumnId: string;
};

type CellMap = Map<string, BoardCache["cellValues"][number]["value"]>;

/** Resolve the status option color for an item, or null when unset. */
export function statusOptionColor(
  statusColumn: CacheColumn | undefined,
  cellMap: CellMap,
  itemId: string,
): string | null {
  if (!statusColumn) return null;
  const value = cellMap.get(cellKey(itemId, statusColumn.id)) as
    | { optionId: string | null }
    | undefined;
  const optionId = value?.optionId ?? null;
  if (!optionId) return null;
  const options =
    (statusColumn.settings as { options?: ColumnOption[] } | null)?.options ??
    [];
  return options.find((o) => o.id === optionId)?.color ?? null;
}

export function EventBar({
  interval,
  fromDayISO,
  dateColumnId,
  statusColumn,
  cellMap,
  onOpen,
}: {
  interval: PlacedInterval;
  fromDayISO: string;
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  onOpen?: (itemId: string) => void;
}) {
  const dragData: ChipDragData = {
    itemId: interval.itemId,
    fromDayISO,
    dateColumnId,
  };
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `${interval.itemId}-${fromDayISO}`, data: dragData });

  const target = presenceTarget.event(interval.itemId);
  usePresenceFocus({ viewKind: "calendar", targetId: target }, isDragging);

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  const color = statusOptionColor(statusColumn, cellMap, interval.itemId);
  // Spans continuing past a week edge lose their rounded cap on that side.
  const roundLeft = !interval.continuesLeft;
  const roundRight = !interval.continuesRight;
  // The name renders once, at the visible start of the span.
  const showName = !interval.continuesLeft;

  const common = cn(
    "relative flex h-[18px] min-w-0 cursor-grab items-center gap-1.5 px-1.5 text-[11px] font-medium",
    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
    isDragging && "opacity-50",
    roundLeft ? "rounded-l-md" : "rounded-l-none",
    roundRight ? "rounded-r-md" : "rounded-r-none",
  );

  if (interval.isSingle) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.(interval.itemId);
        }}
        className={cn(common, "bg-surface-muted border")}
      >
        <PresenceRing target={target} />
        {color && (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="truncate">{interval.name}</span>
      </div>
    );
  }

  // Multi-day span: filled with the status color (or a neutral surface fallback).
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        backgroundColor: color ?? undefined,
        color: color ? pillTextColor(color) : undefined,
      }}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(interval.itemId);
      }}
      className={cn(common, !color && "bg-surface-muted border")}
    >
      <PresenceRing target={target} />
      {showName && <span className="truncate">{interval.name}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/boards/calendar/EventBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/calendar/EventBar.tsx src/components/boards/calendar/EventBar.test.tsx
git -c user.name="Danijel Jovanovic" -c user.email="info@synapse-solutions.ai" \
  commit -m "feat(boards): add calendar EventBar leaf

Draggable span/single bar: status-filled spans with edge-gated
rounding, neutral single-day bars with a status dot. Reuses the
existing dnd + presence-ring wiring."
```

---

### Task 4: `CalendarMonth` + day overflow popover

**Files:**

- Create: `src/components/boards/calendar/CalendarMonth.tsx`
- Test: `src/components/boards/calendar/CalendarMonth.test.tsx`

**Interfaces:**

- Consumes: `buildCalendarMonth` + `layOutWeek` + `PlacedInterval` (T1), `EventBar` + `ChipDragData` (T3), `CacheColumn`/`BoardCache`/`buildCellMap` (existing), shadcn `Popover` (`@/components/ui/popover`).
- Produces:
  - `const MONTH_LANE_CAP = 3`
  - `function CalendarMonth(props: { monthISO: string; today: string; items: { id: string; name: string }[]; cellValues: BoardCache["cellValues"]; dateColumnId: string; statusColumn: CacheColumn | undefined; cellMap: Map<string, BoardCache["cellValues"][number]["value"]>; onDayClick: (dayISO: string) => void; onOpenItem?: (itemId: string) => void }): JSX.Element`

**Notes:** Each of the 6 weeks renders a 7-column date-number row + a lane overlay. `layOutWeek(week[0].dateISO, …)` gives placed intervals; intervals with `lane < 3` render as `EventBar`s positioned via inline `gridColumn`/`gridRow`. For each column, the count of intervals with `lane >= 3` covering it becomes a "+N more" Popover trigger that lists that day's full set. Today/weekend/out-of-month styling via tokens. A 2px "busyness" bar under the date number scales opacity with item count (monochrome).

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/calendar/CalendarMonth.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { CalendarMonth } from "./CalendarMonth";
import { buildCellMap } from "@/lib/boards/cache";

const statusColumn = undefined;
// June 2026; pile 4 overlapping spans onto Jun 10 to force overflow (cap = 3).
const items = [
  { id: "a", name: "Span A" },
  { id: "b", name: "Span B" },
  { id: "c", name: "Span C" },
  { id: "d", name: "Span D" },
];
const cellValues = items.map((it) => ({
  item_id: it.id,
  column_id: "d1",
  value: { date: "2026-06-09", end: "2026-06-12" },
})) as never;

function renderMonth(onOpenItem = vi.fn()) {
  return render(
    <DndContext>
      <CalendarMonth
        monthISO="2026-06-01"
        today="2026-06-16"
        items={items}
        cellValues={cellValues}
        dateColumnId="d1"
        statusColumn={statusColumn}
        cellMap={buildCellMap(cellValues)}
        onDayClick={vi.fn()}
        onOpenItem={onOpenItem}
      />
    </DndContext>,
  );
}

describe("CalendarMonth", () => {
  it("renders at most the lane cap of bars and a +N more trigger", () => {
    renderMonth();
    // 3 of the 4 overlapping spans render as named bars; the 4th overflows.
    expect(screen.getAllByText(/Span [ABC]/)).toHaveLength(3 * 4); // 4 covered days each
    expect(screen.getAllByText(/\+1 more/).length).toBeGreaterThan(0);
  });

  it("opens a popover listing the hidden item when +N more is clicked", () => {
    renderMonth();
    fireEvent.click(screen.getAllByText(/\+1 more/)[0]);
    expect(screen.getByText("Span D")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/calendar/CalendarMonth.test.tsx`
Expected: FAIL — `./CalendarMonth` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/boards/calendar/CalendarMonth.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import {
  buildCalendarMonth,
  layOutWeek,
  type PlacedInterval,
} from "@/lib/boards/calendar";
import { itemDateRange } from "@/lib/boards/dates";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EventBar } from "./EventBar";

export const MONTH_LANE_CAP = 3;

type CellMap = Map<string, BoardCache["cellValues"][number]["value"]>;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarMonth({
  monthISO,
  today,
  items,
  cellValues,
  dateColumnId,
  statusColumn,
  cellMap,
  onDayClick,
  onOpenItem,
}: {
  monthISO: string;
  today: string;
  items: { id: string; name: string }[];
  cellValues: BoardCache["cellValues"];
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  onDayClick: (dayISO: string) => void;
  onOpenItem?: (itemId: string) => void;
}) {
  const month = useMemo(
    () => buildCalendarMonth(monthISO, items, cellValues, dateColumnId),
    [monthISO, items, cellValues, dateColumnId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3">
      <div className="mb-1 grid grid-cols-7 gap-px">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-muted-foreground px-1 text-[10px] font-semibold tracking-wide uppercase"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="bg-border flex flex-1 flex-col gap-px rounded-md border">
        {month.weeks.map((week) => {
          const weekStartISO = week[0].dateISO;
          const placed = layOutWeek(
            weekStartISO,
            items,
            cellValues,
            dateColumnId,
          );
          const visible = placed.filter((p) => p.lane < MONTH_LANE_CAP);
          // Hidden interval count per column (1..7).
          const overflow = Array.from({ length: 7 }, (_, c) =>
            placed.filter(
              (p) =>
                p.lane >= MONTH_LANE_CAP &&
                p.startCol <= c + 1 &&
                p.endCol >= c + 1,
            ),
          );
          return (
            <div
              key={weekStartISO}
              className="relative grid grid-cols-7 gap-px"
            >
              {/* Day cells */}
              {week.map((day) => {
                const count = day.events.length;
                return (
                  <div
                    key={day.dateISO}
                    role="button"
                    tabIndex={0}
                    aria-label={`Add item on ${day.dateISO}`}
                    onClick={() => onDayClick(day.dateISO)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onDayClick(day.dateISO);
                      }
                    }}
                    className={cn(
                      "bg-surface hover:bg-accent/20 flex min-h-[6.5rem] cursor-pointer flex-col p-1.5",
                      !day.inMonth && "bg-surface-muted opacity-50",
                      day.dateISO === today &&
                        "ring-primary/50 ring-1 ring-inset",
                    )}
                  >
                    <div className="flex items-center justify-end">
                      <span
                        className={cn(
                          "text-[11px] tabular-nums",
                          day.dateISO === today
                            ? "text-primary font-bold"
                            : "text-muted-foreground",
                        )}
                      >
                        {Number(day.dateISO.split("-")[2])}
                      </span>
                    </div>
                    {count > 0 && (
                      <span
                        aria-hidden
                        className="bg-muted-foreground mt-0.5 h-0.5 rounded-full"
                        style={{ opacity: Math.min(1, 0.25 + count * 0.18) }}
                      />
                    )}
                  </div>
                );
              })}

              {/* Lane overlay: bars positioned by grid column/row. */}
              <div
                className="pointer-events-none absolute inset-x-1.5 top-7 grid grid-cols-7 gap-px"
                style={{ gridAutoRows: "20px" }}
              >
                {visible.map((iv) => (
                  <div
                    key={`${iv.itemId}-${weekStartISO}`}
                    className="pointer-events-auto min-w-0"
                    style={{
                      gridColumn: `${iv.startCol} / ${iv.endCol + 1}`,
                      gridRow: iv.lane + 1,
                    }}
                  >
                    <BarForDay
                      interval={iv}
                      weekStartISO={weekStartISO}
                      cellValues={cellValues}
                      dateColumnId={dateColumnId}
                      statusColumn={statusColumn}
                      cellMap={cellMap}
                      onOpenItem={onOpenItem}
                    />
                  </div>
                ))}
              </div>

              {/* "+N more" row beneath the cap. */}
              <div
                className="pointer-events-none absolute inset-x-1.5 grid grid-cols-7 gap-px"
                style={{ top: `calc(1.75rem + ${MONTH_LANE_CAP * 20}px)` }}
              >
                {overflow.map((hidden, c) =>
                  hidden.length > 0 && hidden[0].startCol === c + 1 ? (
                    <DayMorePopover
                      key={c}
                      colIndex={c}
                      hidden={hidden}
                      onOpenItem={onOpenItem}
                    />
                  ) : (
                    <span key={c} />
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Resolve the drop-anchor day for a bar (its real start day — needed for the
 * drag delta math in `onEventDropped`) and render it. `itemDateRange` needs the
 * raw `CacheCellValue[]`, so `cellValues` is threaded in alongside the value map.
 */
function BarForDay({
  interval,
  weekStartISO,
  cellValues,
  dateColumnId,
  statusColumn,
  cellMap,
  onOpenItem,
}: {
  interval: PlacedInterval;
  weekStartISO: string;
  cellValues: BoardCache["cellValues"];
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  onOpenItem?: (itemId: string) => void;
}) {
  const range = itemDateRange(interval.itemId, cellValues, dateColumnId);
  const fromDayISO = range?.start ?? weekStartISO;
  return (
    <EventBar
      interval={interval}
      fromDayISO={fromDayISO}
      dateColumnId={dateColumnId}
      statusColumn={statusColumn}
      cellMap={cellMap}
      onOpen={onOpenItem}
    />
  );
}

function DayMorePopover({
  colIndex,
  hidden,
  onOpenItem,
}: {
  colIndex: number;
  hidden: PlacedInterval[];
  onOpenItem?: (itemId: string) => void;
}) {
  return (
    <div
      style={{ gridColumn: `${colIndex + 1} / ${colIndex + 2}` }}
      className="pointer-events-auto"
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:bg-accent w-full rounded px-1 text-left text-[10px]"
          >
            +{hidden.length} more
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <ul className="flex flex-col">
            {hidden.map((iv) => (
              <li key={iv.itemId}>
                <button
                  type="button"
                  onClick={() => onOpenItem?.(iv.itemId)}
                  className="hover:bg-accent w-full truncate rounded px-2 py-1 text-left text-sm"
                >
                  {iv.name}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/boards/calendar/CalendarMonth.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/calendar/CalendarMonth.tsx src/components/boards/calendar/CalendarMonth.test.tsx
git -c user.name="Danijel Jovanovic" -c user.email="info@synapse-solutions.ai" \
  commit -m "feat(boards): add CalendarMonth with capped lanes + day popover

6x7 ruled grid with spanning bars in lanes (cap 3); overflow collapses
into a +N more popover listing the day's hidden items. Busyness hint
per day."
```

---

### Task 5: `CalendarWeek` (all-day strip, uncapped lanes)

**Files:**

- Create: `src/components/boards/calendar/CalendarWeek.tsx`
- Test: `src/components/boards/calendar/CalendarWeek.test.tsx`

**Interfaces:**

- Consumes: `layOutWeek` + `weekStartOnOrBefore` (T1), `addDaysISO` (`@/lib/boards/calendar`), `EventBar` (T3), `itemDateRange` (`@/lib/boards/dates`), `CacheColumn`/`BoardCache`.
- Produces:
  - `function CalendarWeek(props: { weekStartISO: string; today: string; items: { id: string; name: string }[]; cellValues: BoardCache["cellValues"]; dateColumnId: string; statusColumn: CacheColumn | undefined; cellMap: Map<string, BoardCache["cellValues"][number]["value"]>; onDayClick: (dayISO: string) => void; onOpenItem?: (itemId: string) => void }): JSX.Element`

**Notes:** 7 column headers (weekday + date number, today tinted), then a single uncapped lane overlay using `layOutWeek` — every lane renders (no cap, scrolls).

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/calendar/CalendarWeek.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { CalendarWeek } from "./CalendarWeek";
import { buildCellMap } from "@/lib/boards/cache";

const items = [
  { id: "a", name: "Span A" },
  { id: "b", name: "Span B" },
  { id: "c", name: "Span C" },
  { id: "d", name: "Span D" },
];
// 4 overlapping spans — all must render in week view (no cap).
const cellValues = items.map((it) => ({
  item_id: it.id,
  column_id: "d1",
  value: { date: "2026-06-08", end: "2026-06-11" },
})) as never;

describe("CalendarWeek", () => {
  it("renders all overlapping spans (no lane cap)", () => {
    render(
      <DndContext>
        <CalendarWeek
          weekStartISO="2026-06-07"
          today="2026-06-16"
          items={items}
          cellValues={cellValues}
          dateColumnId="d1"
          statusColumn={undefined}
          cellMap={buildCellMap(cellValues)}
          onDayClick={vi.fn()}
          onOpenItem={vi.fn()}
        />
      </DndContext>,
    );
    for (const name of ["Span A", "Span B", "Span C", "Span D"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/calendar/CalendarWeek.test.tsx`
Expected: FAIL — `./CalendarWeek` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/boards/calendar/CalendarWeek.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { addDaysISO, layOutWeek } from "@/lib/boards/calendar";
import { itemDateRange } from "@/lib/boards/dates";
import { EventBar } from "./EventBar";

type CellMap = Map<string, BoardCache["cellValues"][number]["value"]>;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarWeek({
  weekStartISO,
  today,
  items,
  cellValues,
  dateColumnId,
  statusColumn,
  cellMap,
  onDayClick,
  onOpenItem,
}: {
  weekStartISO: string;
  today: string;
  items: { id: string; name: string }[];
  cellValues: BoardCache["cellValues"];
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  onDayClick: (dayISO: string) => void;
  onOpenItem?: (itemId: string) => void;
}) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStartISO, i)),
    [weekStartISO],
  );
  const placed = useMemo(
    () => layOutWeek(weekStartISO, items, cellValues, dateColumnId),
    [weekStartISO, items, cellValues, dateColumnId],
  );
  const laneCount = placed.reduce((m, p) => Math.max(m, p.lane + 1), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3">
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-t-md border">
        {days.map((iso, i) => (
          <div
            key={iso}
            className={cn(
              "border-r p-2 last:border-r-0",
              iso === today && "bg-primary/8",
            )}
          >
            <div className="text-muted-foreground text-[10px] font-semibold uppercase">
              {WEEKDAYS[i]}
            </div>
            <div
              className={cn(
                "text-base font-semibold tabular-nums",
                iso === today && "text-primary",
              )}
            >
              {Number(iso.split("-")[2])}
            </div>
          </div>
        ))}
      </div>

      <div
        className="relative grid grid-cols-7 gap-px rounded-b-md border border-t-0"
        style={{ minHeight: `${Math.max(laneCount, 4) * 26 + 16}px` }}
        onClick={() => onDayClick(weekStartISO)}
      >
        <div
          className="pointer-events-none absolute inset-x-1.5 top-2 grid grid-cols-7 gap-px"
          style={{ gridAutoRows: "24px" }}
        >
          {placed.map((iv) => {
            const range = itemDateRange(iv.itemId, cellValues, dateColumnId);
            return (
              <div
                key={iv.itemId}
                className="pointer-events-auto min-w-0"
                style={{
                  gridColumn: `${iv.startCol} / ${iv.endCol + 1}`,
                  gridRow: iv.lane + 1,
                }}
              >
                <EventBar
                  interval={iv}
                  fromDayISO={range?.start ?? weekStartISO}
                  dateColumnId={dateColumnId}
                  statusColumn={statusColumn}
                  cellMap={cellMap}
                  onOpen={onOpenItem}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/boards/calendar/CalendarWeek.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/calendar/CalendarWeek.tsx src/components/boards/calendar/CalendarWeek.test.tsx
git -c user.name="Danijel Jovanovic" -c user.email="info@synapse-solutions.ai" \
  commit -m "feat(boards): add CalendarWeek all-day strip

7-column week with uncapped spanning-bar lanes — the full-detail view
for busy stretches where the month cap would hide items."
```

---

### Task 6: `CalendarAgenda` (day-grouped list)

**Files:**

- Create: `src/components/boards/calendar/CalendarAgenda.tsx`
- Test: `src/components/boards/calendar/CalendarAgenda.test.tsx`

**Interfaces:**

- Consumes: `agendaGroups` + `AgendaGroup` (T2), `CellRenderer` (`@/components/boards/cells`), `cellKey`/`CacheColumn`/`BoardCache`, `diffDaysISO` (`@/lib/boards/calendar`).
- Produces:
  - `function CalendarAgenda(props: { fromISO: string; toISO: string; today: string; items: { id: string; name: string }[]; cellValues: BoardCache["cellValues"]; dateColumnId: string; statusColumn: CacheColumn | undefined; cellMap: Map<string, BoardCache["cellValues"][number]["value"]>; onOpenItem?: (itemId: string) => void }): JSX.Element`

**Notes:** Renders `agendaGroups(fromISO, toISO, …)`. Each group: a date gutter (weekday + day number, today highlighted) and rows (status dot via `statusOptionColor`-style resolution reused through `CellRenderer` for the status pill, name, and a range pill `Jun 9–16` when the item spans >1 day). Empty result → "Nothing scheduled" message.

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/calendar/CalendarAgenda.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CalendarAgenda } from "./CalendarAgenda";
import { buildCellMap } from "@/lib/boards/cache";

const items = [
  { id: "i1", name: "Launch" },
  { id: "i2", name: "Standup" },
];
const cellValues = [
  {
    item_id: "i1",
    column_id: "d1",
    value: { date: "2026-06-09", end: "2026-06-16" },
  },
  { item_id: "i2", column_id: "d1", value: { date: "2026-06-10" } },
] as never;

function renderAgenda() {
  return render(
    <CalendarAgenda
      fromISO="2026-06-01"
      toISO="2026-06-30"
      today="2026-06-16"
      items={items}
      cellValues={cellValues}
      dateColumnId="d1"
      statusColumn={undefined}
      cellMap={buildCellMap(cellValues)}
      onOpenItem={vi.fn()}
    />,
  );
}

describe("CalendarAgenda", () => {
  it("lists items grouped by day", () => {
    renderAgenda();
    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(screen.getByText("Standup")).toBeInTheDocument();
  });
  it("shows a date range for multi-day items", () => {
    renderAgenda();
    expect(screen.getByText(/Jun 9.*Jun 16/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/calendar/CalendarAgenda.test.tsx`
Expected: FAIL — `./CalendarAgenda` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/boards/calendar/CalendarAgenda.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { cellKey } from "@/lib/boards/cache";
import type { Json } from "@/types/database.types";
import { agendaGroups } from "@/lib/boards/calendar-agenda";
import { CellRenderer } from "@/components/boards/cells";

type CellMap = Map<string, BoardCache["cellValues"][number]["value"]>;

function fmt(iso: string): string {
  // UTC formatting keeps it deterministic and free of TZ drift.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function CalendarAgenda({
  fromISO,
  toISO,
  today,
  items,
  cellValues,
  dateColumnId,
  statusColumn,
  cellMap,
  onOpenItem,
}: {
  fromISO: string;
  toISO: string;
  today: string;
  items: { id: string; name: string }[];
  cellValues: BoardCache["cellValues"];
  dateColumnId: string;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  onOpenItem?: (itemId: string) => void;
}) {
  const groups = useMemo(
    () => agendaGroups(fromISO, toISO, items, cellValues, dateColumnId),
    [fromISO, toISO, items, cellValues, dateColumnId],
  );

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground text-sm">
          Nothing scheduled this period.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div className="overflow-hidden rounded-md border">
        {groups.map((group) => (
          <div
            key={group.dateISO}
            className={cn(
              "grid grid-cols-[88px_1fr] border-b last:border-b-0",
              group.dateISO === today && "bg-primary/8",
            )}
          >
            <div className="border-r p-3">
              <div className="text-muted-foreground text-[10px] font-semibold uppercase">
                {weekday(group.dateISO)}
              </div>
              <div
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  group.dateISO === today && "text-primary",
                )}
              >
                {Number(group.dateISO.split("-")[2])}
              </div>
            </div>
            <ul className="flex flex-col p-1.5">
              {group.items.map((item) => {
                const isSpan = item.range.end !== item.range.start;
                const statusValue = statusColumn
                  ? (cellMap.get(cellKey(item.itemId, statusColumn.id)) ?? null)
                  : null;
                return (
                  <li key={item.itemId}>
                    <button
                      type="button"
                      onClick={() => onOpenItem?.(item.itemId)}
                      className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left"
                    >
                      <span className="flex-1 truncate text-sm">
                        {item.name}
                      </span>
                      {isSpan && (
                        <span className="text-muted-foreground bg-surface-muted rounded-full border px-2 py-0.5 text-[10px]">
                          {fmt(item.range.start)} – {fmt(item.range.end)}
                        </span>
                      )}
                      {statusColumn && (
                        <CellRenderer
                          kind={statusColumn.kind}
                          value={statusValue as Json}
                          settings={
                            (statusColumn.settings ?? {}) as Record<
                              string,
                              unknown
                            >
                          }
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/boards/calendar/CalendarAgenda.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/calendar/CalendarAgenda.tsx src/components/boards/calendar/CalendarAgenda.test.tsx
git -c user.name="Danijel Jovanovic" -c user.email="info@synapse-solutions.ai" \
  commit -m "feat(boards): add CalendarAgenda day-grouped list

Chronological list grouped by day with status pills and span ranges;
density-proof view behind the calendar toggle."
```

---

### Task 7: `CalendarControls` (nav + view-mode toggle + date-column picker)

**Files:**

- Create: `src/components/boards/calendar/CalendarControls.tsx`
- Test: `src/components/boards/calendar/CalendarControls.test.tsx`

**Interfaces:**

- Consumes: `CacheColumn`, lucide icons.
- Produces:
  - `type CalendarMode = "month" | "week" | "agenda"`
  - `function CalendarControls(props: { mode: CalendarMode; onModeChange: (m: CalendarMode) => void; label: string; onPrev: () => void; onNext: () => void; onToday: () => void; dateColumns: CacheColumn[]; activeDateColumnId: string; onDateColumnChange: (id: string) => void }): JSX.Element`

**Notes:** Segmented control with three buttons (`role="tab"`), active = `bg-primary text-primary-foreground`. Period `label` is computed by the parent (T8). Date-by `<select>` carries an `aria-label="Date column"` (the existing test relies on this).

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/calendar/CalendarControls.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarControls } from "./CalendarControls";

const baseProps = {
  mode: "month" as const,
  label: "June 2026",
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onToday: vi.fn(),
  dateColumns: [
    { id: "d1", kind: "date", name: "Due Date", settings: {} },
  ] as never,
  activeDateColumnId: "d1",
  onDateColumnChange: vi.fn(),
};

describe("CalendarControls", () => {
  it("switches mode when a segment is clicked", () => {
    const onModeChange = vi.fn();
    render(<CalendarControls {...baseProps} onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /week/i }));
    expect(onModeChange).toHaveBeenCalledWith("week");
  });

  it("renders the period label and the date-column picker", () => {
    render(<CalendarControls {...baseProps} onModeChange={vi.fn()} />);
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /date column/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/calendar/CalendarControls.test.tsx`
Expected: FAIL — `./CalendarControls` does not exist.

- [ ] **Step 3: Implement**

Create `src/components/boards/calendar/CalendarControls.tsx`:

```tsx
"use client";

import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CacheColumn } from "@/lib/boards/cache";

export type CalendarMode = "month" | "week" | "agenda";

const MODES: { id: CalendarMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "agenda", label: "Agenda" },
];

export function CalendarControls({
  mode,
  onModeChange,
  label,
  onPrev,
  onNext,
  onToday,
  dateColumns,
  activeDateColumnId,
  onDateColumnChange,
}: {
  mode: CalendarMode;
  onModeChange: (m: CalendarMode) => void;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  dateColumns: CacheColumn[];
  activeDateColumnId: string;
  onDateColumnChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b px-6 py-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous period"
          onClick={onPrev}
          className="text-muted-foreground hover:bg-accent flex h-7 w-7 items-center justify-center rounded-md transition-colors"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="text-muted-foreground hover:bg-accent rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
        >
          Today
        </button>
        <button
          type="button"
          aria-label="Next period"
          onClick={onNext}
          className="text-muted-foreground hover:bg-accent flex h-7 w-7 items-center justify-center rounded-md transition-colors"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      <span className="text-sm font-semibold tracking-tight">{label}</span>

      <div className="ml-auto flex items-center gap-3">
        <div
          role="tablist"
          aria-label="Calendar view mode"
          className="bg-surface-muted flex items-center gap-0.5 rounded-md border p-0.5"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => onModeChange(m.id)}
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                mode === m.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <label
          htmlFor="cal-date-column"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"
        >
          <CalendarDays className="size-3.5" aria-hidden />
          Date by
        </label>
        <select
          id="cal-date-column"
          aria-label="Date column"
          value={activeDateColumnId}
          onChange={(e) => onDateColumnChange(e.target.value)}
          className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {dateColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/boards/calendar/CalendarControls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/calendar/CalendarControls.tsx src/components/boards/calendar/CalendarControls.test.tsx
git -c user.name="Danijel Jovanovic" -c user.email="info@synapse-solutions.ai" \
  commit -m "feat(boards): add CalendarControls bar

Period nav, Month/Week/Agenda segmented toggle (monochrome track,
brand-active segment), and the Date-by column picker."
```

---

### Task 8: `CalendarBoard` shell rewrite + test update

**Files:**

- Rewrite: `src/components/boards/CalendarBoard.tsx`
- Modify: `src/components/boards/CalendarBoard.test.tsx`

**Interfaces:**

- Consumes: everything above (`CalendarControls`/`CalendarMode`, `CalendarMonth`, `CalendarWeek`, `CalendarAgenda`, `ChipDragData`), plus existing `useBoardCache`, `useBoardMutations`, `resolveDateColumn`, `itemDateRange`, `onEventDropped`, `buildCellMap`, `updateBoardView`, `BoardHeader`, `weekStartOnOrBefore`, `addDaysISO`.
- Produces: the same default export `CalendarBoard` with the existing prop signature (`payload`, `members?`, `selectedViewId`, `access?`, `grants?`). No public API change for `BoardViews`.

**Behavior:**

- Local state: `mode: CalendarMode` (default `"month"`), `cursorISO: string` (init = first dated item's date, else today).
- Derived period: month mode → `firstOfMonth(cursorISO)`; week mode → `weekStartOnOrBefore(cursorISO)`; agenda → month range of `cursorISO`.
- Nav: prev/next shift by 1 month (month/agenda) or 7 days (week); Today resets `cursorISO`.
- Label: month/agenda → `"June 2026"`; week → `"Jun 8 – 14"`.
- `DndContext` + `handleDragEnd` (reused from current implementation) wraps month & week; agenda has no drag.
- `handleDayClick` (reused) creates an item on the clicked day.
- The **Unscheduled drawer is removed.**

- [ ] **Step 1: Update the existing tests first (they encode the old behavior)**

In `src/components/boards/CalendarBoard.test.tsx`:

1. **Delete** the test `"shows an Unscheduled section listing undated items"` (the drawer is gone).
2. **Add** these tests inside the main `describe("CalendarBoard")` block:

```tsx
it("does not render an Unscheduled section", () => {
  renderCalendar();
  expect(screen.queryByText(/unscheduled/i)).not.toBeInTheDocument();
});

it("switches to Week mode without any router navigation", () => {
  renderCalendar();
  fireEvent.click(screen.getByRole("tab", { name: /week/i }));
  expect(push).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it("switches to Agenda mode and lists the dated item", () => {
  renderCalendar();
  fireEvent.click(screen.getByRole("tab", { name: /agenda/i }));
  expect(screen.getByText("Dated Item")).toBeInTheDocument();
});
```

3. Add `fireEvent` to the testing-library import:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
```

- [ ] **Step 2: Run the test file to verify the new expectations fail**

Run: `pnpm test -- src/components/boards/CalendarBoard.test.tsx`
Expected: FAIL — no `role="tab"` named Week/Agenda yet; the Unscheduled-absence test passes only once the rewrite lands.

- [ ] **Step 3: Rewrite `CalendarBoard.tsx`**

Replace the entire contents of `src/components/boards/CalendarBoard.tsx`:

```tsx
"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";

import type { BoardPayload } from "@/lib/boards/queries";
import type { BoardCache } from "@/lib/boards/cache";
import { buildCellMap } from "@/lib/boards/cache";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";
import {
  onEventDropped,
  weekStartOnOrBefore,
  addDaysISO,
} from "@/lib/boards/calendar";
import { resolveDateColumn, itemDateRange } from "@/lib/boards/dates";
import { updateBoardView } from "@/lib/boards/view-actions";
import { BoardHeader } from "@/components/boards/BoardHeader";
import type { BoardAccess, HeaderGrant } from "@/components/boards/BoardHeader";
import type { EditorMember } from "@/components/boards/cells/editors";
import {
  CalendarControls,
  type CalendarMode,
} from "@/components/boards/calendar/CalendarControls";
import { CalendarMonth } from "@/components/boards/calendar/CalendarMonth";
import { CalendarWeek } from "@/components/boards/calendar/CalendarWeek";
import { CalendarAgenda } from "@/components/boards/calendar/CalendarAgenda";
import type { ChipDragData } from "@/components/boards/calendar/EventBar";

function firstOfMonth(dateISO: string): string {
  const [y, m] = dateISO.split("-");
  return `${y}-${m}-01`;
}
function shiftMonth(monthISO: string, delta: number): string {
  const [y, m] = monthISO.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthLabel(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
function weekLabel(weekStartISO: string): string {
  const end = addDaysISO(weekStartISO, 6);
  const f = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${f(weekStartISO)} – ${f(end)}`;
}
function lastOfMonthISO(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day
  return `${y}-${String(m).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function CalendarBoard({
  payload,
  selectedViewId,
  members = [],
  access = "owner",
  grants = [],
}: {
  payload: BoardPayload;
  members?: EditorMember[];
  selectedViewId: string;
  access?: BoardAccess;
  grants?: HeaderGrant[];
}) {
  const { data: cache } = useBoardCache(
    payload.board.id,
    payload as unknown as BoardCache,
  );
  const { setCell, addItem } = useBoardMutations(payload.board.id);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const selectedView = payload.views.find((v) => v.id === selectedViewId);
  const config = (selectedView?.config ?? null) as {
    date_column_id?: string | null;
  } | null;
  const dateColumn = resolveDateColumn(cache.columns, config);
  const dateColumns = cache.columns.filter((c) => c.kind === "date");
  const statusColumn = useMemo(
    () => cache.columns.find((c) => c.kind === "status"),
    [cache.columns],
  );

  const [mode, setMode] = useState<CalendarMode>("month");
  const [cursorISO, setCursorISO] = useState<string>(() => {
    if (dateColumn) {
      const first = cache.cellValues.find(
        (cv) =>
          cv.column_id === dateColumn.id &&
          typeof (cv.value as Record<string, unknown>)?.date === "string",
      );
      const date = first ? (first.value as { date: string }).date : null;
      if (date) return date;
    }
    return todayISO();
  });

  const cellMap = useMemo(
    () => buildCellMap(cache.cellValues),
    [cache.cellValues],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  if (!dateColumn) {
    return (
      <div className="flex h-full flex-col">
        <BoardHeader
          boardId={cache.board.id}
          boardName={cache.board.name}
          views={payload.views}
          selectedViewId={selectedViewId}
          columns={cache.columns}
          members={members}
          groups={cache.groups.map((g) => ({ id: g.id, name: g.name }))}
          access={access}
          grants={grants}
        />
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-muted-foreground text-sm">
            Add a Date column to use the Calendar view.
          </p>
        </div>
      </div>
    );
  }

  const resolvedDateColumn = dateColumn;
  const today = todayISO();
  const firstGroupId = cache.groups[0]?.id;

  const monthISO = firstOfMonth(cursorISO);
  const weekStartISO = weekStartOnOrBefore(cursorISO);
  const label =
    mode === "week" ? weekLabel(weekStartISO) : monthLabel(monthISO);

  function nav(delta: number) {
    setCursorISO((c) =>
      mode === "week"
        ? addDaysISO(c, delta * 7)
        : shiftMonth(firstOfMonth(c), delta),
    );
  }

  function handleDateColumnChange(columnId: string) {
    startTransition(async () => {
      await updateBoardView({
        viewId: selectedViewId,
        config: { date_column_id: columnId },
      });
      router.refresh();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const data = active.data.current as ChipDragData | undefined;
    if (!data) return;
    const toDayISO = over.id as string;
    if (toDayISO === data.fromDayISO) return;
    const range = itemDateRange(
      data.itemId,
      cache.cellValues,
      data.dateColumnId,
    );
    if (!range) return;
    onEventDropped(
      data.itemId,
      data.fromDayISO,
      toDayISO,
      range,
      data.dateColumnId,
      setCell as Parameters<typeof onEventDropped>[5],
    );
  }

  function handleDayClick(dayISO: string) {
    if (!firstGroupId) return;
    addItem(
      { groupId: firstGroupId, name: "New item" },
      {
        onSuccess: (item) => {
          setCell({
            itemId: item.id,
            columnId: resolvedDateColumn.id,
            value: { date: dayISO },
          });
        },
      },
    );
  }

  const shared = {
    today,
    items: cache.items,
    cellValues: cache.cellValues,
    dateColumnId: resolvedDateColumn.id,
    statusColumn,
    cellMap,
    onOpenItem: undefined as ((id: string) => void) | undefined,
  };

  return (
    <div className="flex h-full flex-col">
      <BoardHeader
        boardId={cache.board.id}
        boardName={cache.board.name}
        views={payload.views}
        selectedViewId={selectedViewId}
        columns={cache.columns}
        members={members}
        groups={cache.groups.map((g) => ({ id: g.id, name: g.name }))}
        access={access}
        grants={grants}
      />

      <CalendarControls
        mode={mode}
        onModeChange={setMode}
        label={label}
        onPrev={() => nav(-1)}
        onNext={() => nav(1)}
        onToday={() => setCursorISO(todayISO())}
        dateColumns={dateColumns}
        activeDateColumnId={resolvedDateColumn.id}
        onDateColumnChange={handleDateColumnChange}
      />

      {mode === "agenda" ? (
        <CalendarAgenda
          {...shared}
          fromISO={monthISO}
          toISO={lastOfMonthISO(monthISO)}
        />
      ) : (
        <DndContext
          id={`calendar-${selectedViewId}`}
          sensors={sensors}
          onDragEnd={handleDragEnd}
        >
          {mode === "week" ? (
            <CalendarWeek
              {...shared}
              weekStartISO={weekStartISO}
              onDayClick={handleDayClick}
            />
          ) : (
            <CalendarMonth
              {...shared}
              monthISO={monthISO}
              onDayClick={handleDayClick}
            />
          )}
        </DndContext>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the calendar test file to verify it passes**

Run: `pnpm test -- src/components/boards/CalendarBoard.test.tsx`
Expected: PASS — weekday headers, dated item, no Unscheduled, mode switches without navigation, date-column picker.

- [ ] **Step 5: Run the full gate suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. Fix any type/lint fallout (most likely: unused imports removed from the old `CalendarBoard`, or `EventChip` references — there should be none left since the file was fully replaced).

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/CalendarBoard.tsx src/components/boards/CalendarBoard.test.tsx
git -c user.name="Danijel Jovanovic" -c user.email="info@synapse-solutions.ai" \
  commit -m "feat(boards): wire calendar Month/Week/Agenda shell

CalendarBoard becomes a thin shell over the new sub-views: client-state
mode + cursor (0 server round-trips on switch/nav), spanning bars via
the lane engine, drag-to-reschedule retained, Unscheduled drawer removed."
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** spanning bars (T1/T3/T4/T5), 3-lane cap + popover (T4), Week (T5), Agenda (T6), toggle + nav as client state (T7/T8), single-day neutral vs span fill (T3), Unscheduled removed (T8), no schema/types change (none added), perf budget honored (no new reads; `useMemo` over cache; mutations unchanged).
- **Deviation from spec wording, intentional:** single-day items are packed into the _same_ lane model as spans (not rendered in a separate region) so Month and Week share one engine — visually still neutral-bar-with-dot vs filled span. Agenda omits empty days entirely rather than showing "No items" rows (cleaner over a month range); an all-empty period shows a single "Nothing scheduled" message.
- **Type consistency:** `PlacedInterval`, `ChipDragData`, `CalendarMode`, and the `statusOptionColor` signature are referenced identically across tasks.

## Execution DAG

```
Batch 1 (parallel): T1 (lane core) · T2 (agenda helper) · T3 (EventBar)
Batch 2 (parallel): T4 (Month, needs T1+T3) · T5 (Week, needs T1+T3) · T6 (Agenda, needs T2)
Batch 3 (parallel): T7 (Controls, independent)   ← may also run in Batch 1/2
Batch 4: T8 (shell, needs T4+T5+T6+T7)
Critical path: T1 → T4 → T8
```

T4/T5/T6 create separate files; if dispatched as parallel agents, isolate each in its own worktree per working-agreement #1. T8 integrates and must run alone.
