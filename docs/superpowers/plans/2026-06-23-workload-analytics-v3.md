# Workload Analytics v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks MUST load the `pulse-ui` + `frontend-design` skills first (AGENTS.md §3).

**Goal:** Add planned-vs-actual **variance** analytics (a 4th metric mode) and a **per-day actuals drill-down** popover to `/workload`, both as pure-client features over already-loaded data (0 new server round-trips, no migration).

**Architecture:** Variance and drill-down are pure derived math over data the page already ships (`effortSecs`/`actualSecs` in each `BucketCell`, and the per-`(user,board,day)` `actuals` array). Variance becomes a 4th value of the existing History-API `?metric=` toggle; drill-down filters the in-memory `actuals` for the clicked `(userId, weekKey)` and shows it in a shadcn Popover. No new RPC, no migration, no type regen.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript (strict), Vitest, shadcn/ui (`Popover`), Tailwind v4, `pulse-ui` tokens.

**Spec:** `docs/superpowers/specs/2026-06-23-workload-analytics-v3-design.md`
**Branch / worktree:** `task/workload-v2-analytics` (`.claude/worktrees/workload-v2-analytics`).

> **Review gate (do not skip):** This plan implements the **recommended scope** from the spec — (a) per-**day** drill-down + (c) variance; (b) running-timer **deferred**; per-entry drill-down **deferred**. Confirm spec §9 Q1–Q5 before executing. The defaults assumed below: Q1 per-day, Q2 defer (b), **Q3 ±10% band**, Q4 unplanned-actual ⇒ `over` w/ `—` pct, Q5 metric-mode only.

---

## File Structure

- **Modify** `src/lib/workload/types.ts` — add `"variance"` to `WorkloadMetric`; add `DayActual` interface.
- **Modify** `src/lib/workload/rollup.ts` — add pure `varianceSecs`, `variancePct`, `varianceState`, `actualsForCell`.
- **Modify** `src/lib/workload/rollup.test.ts` — unit tests for the four new helpers.
- **Modify** `src/components/workload/CapacityCell.tsx` — render `metric==="variance"`.
- **Modify** `src/components/workload/CapacityCell.test.tsx` — variance render assertions.
- **Create** `src/components/workload/DayActualsPopover.tsx` — per-day drill-down popover.
- **Create** `src/components/workload/DayActualsPopover.test.tsx` — popover unit tests.
- **Modify** `src/components/workload/MemberRowHeader.tsx` — row-level variance summary when active.
- **Modify** `src/components/workload/WorkloadGrid.tsx` — 4th metric button; wire cell click → popover; pass `boardIds`/`weekStartsOn` down.

---

## Task 1 — Variance + drill-down pure math (`rollup.ts` + types)

**Files:**

- Modify: `src/lib/workload/types.ts`
- Modify: `src/lib/workload/rollup.ts`
- Test: `src/lib/workload/rollup.test.ts`

**Interfaces:**

- **Consumes:** existing `WorkloadActualRow`, `weekStartOf` (private in `rollup.ts`).
- **Produces:** `WorkloadMetric` gains `"variance"`; new `DayActual`; exported
  `varianceSecs`, `variancePct`, `varianceState`, `actualsForCell`.

- [ ] **Step 1: Extend types**

In `src/lib/workload/types.ts`, change the metric union and add a row shape:

```ts
/** Which value the grid foregrounds — planned effort, logged actuals, both, or the planned-vs-actual delta. */
export type WorkloadMetric = "planned" | "actual" | "both" | "variance";

/** One day's logged actuals inside a week, for the drill-down popover. */
export interface DayActual {
  day: string; // ISO date
  secs: number; // total logged that day (across boards, after any board filter)
}
```

- [ ] **Step 2: Write failing tests for the variance helpers**

Append to `src/lib/workload/rollup.test.ts` (import the new symbols at the top alongside the existing imports):

```ts
import {
  varianceSecs,
  variancePct,
  varianceState,
  actualsForCell,
} from "@/lib/workload/rollup";

describe("varianceSecs", () => {
  it("is signed: positive when over plan, negative when under", () => {
    expect(varianceSecs(10 * H, 6 * H)).toBe(4 * H); // logged 10h vs planned 6h
    expect(varianceSecs(4 * H, 6 * H)).toBe(-2 * H);
    expect(varianceSecs(6 * H, 6 * H)).toBe(0);
  });
});

describe("variancePct", () => {
  it("is the signed fraction of plan", () => {
    expect(variancePct(9 * H, 6 * H)).toBeCloseTo(0.5);
    expect(variancePct(3 * H, 6 * H)).toBeCloseTo(-0.5);
  });
  it("is null when there is no planned baseline (no divide-by-zero)", () => {
    expect(variancePct(4 * H, 0)).toBeNull();
  });
});

describe("varianceState", () => {
  it("reads neutral 'on' within the ±10% tolerance band", () => {
    expect(varianceState(6 * H, 6 * H)).toBe("on");
    expect(varianceState(6.5 * H, 6 * H)).toBe("on"); // +8.3%
  });
  it("reads over / under beyond the band", () => {
    expect(varianceState(9 * H, 6 * H)).toBe("over");
    expect(varianceState(3 * H, 6 * H)).toBe("under");
  });
  it("treats actuals against zero plan as 'over', and zero/zero as 'none'", () => {
    expect(varianceState(4 * H, 0)).toBe("over");
    expect(varianceState(0, 0)).toBe("none");
  });
});

describe("actualsForCell", () => {
  const rows: WorkloadActualRow[] = [
    { userId: "u1", boardId: "b1", day: "2026-06-01", secs: 2 * H }, // Mon, week of Jun 1
    { userId: "u1", boardId: "b2", day: "2026-06-01", secs: 1 * H }, // same day, other board
    { userId: "u1", boardId: "b1", day: "2026-06-05", secs: 3 * H }, // Fri, same week
    { userId: "u1", boardId: "b1", day: "2026-06-08", secs: 9 * H }, // next Mon, different week
    { userId: "u2", boardId: "b1", day: "2026-06-01", secs: 5 * H }, // different user
  ];
  it("returns only the target user's in-week days, aggregated across boards, sorted", () => {
    const out = actualsForCell(rows, "u1", "2026-06-01", 1, null);
    expect(out).toEqual([
      { day: "2026-06-01", secs: 3 * H },
      { day: "2026-06-05", secs: 3 * H },
    ]);
  });
  it("respects the active board filter", () => {
    const out = actualsForCell(rows, "u1", "2026-06-01", 1, new Set(["b1"]));
    expect(out).toEqual([
      { day: "2026-06-01", secs: 2 * H },
      { day: "2026-06-05", secs: 3 * H },
    ]);
  });
  it("is empty when the user has no actuals in that week", () => {
    expect(actualsForCell(rows, "u1", "2026-06-15", 1, null)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `pnpm test -- src/lib/workload/rollup.test.ts`
Expected: FAIL — `varianceSecs`/`variancePct`/`varianceState`/`actualsForCell` are not exported.

- [ ] **Step 4: Implement the helpers in `rollup.ts`**

Add near `capacityState` (reuse the existing private `weekStartOf` and `DayActual`/`WorkloadActualRow` imports — add `WorkloadMetric` is not needed here; add `DayActual` to the type import block):

```ts
/** ±band (fraction of plan) within which variance reads as neutral "on plan". */
const VARIANCE_BAND = 0.1;

/** Signed planned-vs-actual delta in seconds (+ = over plan). */
export function varianceSecs(actualSecs: number, plannedSecs: number): number {
  return actualSecs - plannedSecs;
}

/** Signed variance as a fraction of plan; null when there's no planned baseline. */
export function variancePct(
  actualSecs: number,
  plannedSecs: number,
): number | null {
  if (plannedSecs <= 0) return null;
  return (actualSecs - plannedSecs) / plannedSecs;
}

/** Tri-state for variance coloring: over / under / on (within band) / none. */
export function varianceState(
  actualSecs: number,
  plannedSecs: number,
): "over" | "under" | "on" | "none" {
  if (plannedSecs <= 0) return actualSecs > 0 ? "over" : "none";
  const pct = (actualSecs - plannedSecs) / plannedSecs;
  if (pct > VARIANCE_BAND) return "over";
  if (pct < -VARIANCE_BAND) return "under";
  return "on";
}

/** The day-by-day actuals behind one (member, week) cell, aggregated across
 * boards (after the active board filter), sorted by day. Pure filter over the
 * already-loaded actuals array → 0 round-trips (spec §5). */
export function actualsForCell(
  actuals: WorkloadActualRow[],
  userId: string,
  weekKey: string,
  weekStartsOn: number,
  boardIds: Set<string> | null,
): DayActual[] {
  const byDay = new Map<string, number>();
  for (const a of actuals) {
    if (a.userId !== userId) continue;
    if (boardIds !== null && !boardIds.has(a.boardId)) continue;
    if (weekStartOf(a.day, weekStartsOn) !== weekKey) continue;
    byDay.set(a.day, (byDay.get(a.day) ?? 0) + a.secs);
  }
  return [...byDay.entries()]
    .map(([day, secs]) => ({ day, secs }))
    .sort((x, y) => x.day.localeCompare(y.day));
}
```

Add `DayActual` to the `import type { … } from "./types"` block at the top of `rollup.ts`.

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm test -- src/lib/workload/rollup.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workload/types.ts src/lib/workload/rollup.ts src/lib/workload/rollup.test.ts
git commit -m "feat(workload): variance + per-day drill-down pure math"
```

---

## Task 2 — `CapacityCell` variance render

**Files:**

- Modify: `src/components/workload/CapacityCell.tsx`
- Test: `src/components/workload/CapacityCell.test.tsx`

**Interfaces:**

- **Consumes:** Task 1 (`varianceSecs`, `variancePct`, `varianceState`, `WorkloadMetric`).
- **Produces:** `CapacityCell` renders the `"variance"` metric.

- [ ] **Step 1: Write failing test**

Read the existing `CapacityCell.test.tsx` to match its render harness, then add:

```ts
it("variance metric shows the signed delta, pct, and an over state", () => {
  render(
    <CapacityCell
      effortSecs={6 * 3600}
      capacitySecs={8 * 3600}
      actualSecs={9 * 3600}
      state="under"
      metric="variance"
    />,
  );
  const cell = screen.getByTestId("capacity-cell");
  expect(cell).toHaveAttribute("data-state", "over"); // logged 9h vs planned 6h
  expect(cell).toHaveTextContent("+3h");
  expect(cell).toHaveTextContent("+50%");
});

it("variance metric renders an em dash for pct when there is no plan", () => {
  render(
    <CapacityCell
      effortSecs={0}
      capacitySecs={8 * 3600}
      actualSecs={4 * 3600}
      state="none"
      metric="variance"
    />,
  );
  const cell = screen.getByTestId("capacity-cell");
  expect(cell).toHaveAttribute("data-state", "over");
  expect(cell).toHaveTextContent("+4h");
  expect(cell).toHaveTextContent("—");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- src/components/workload/CapacityCell.test.tsx`
Expected: FAIL — variance not handled (no `+3h`/`data-state="over"`).

- [ ] **Step 3: Implement variance branch**

In `CapacityCell.tsx`, import the helpers and add a variance code path. Keep the existing
under/at/over/none color classes — map variance `"on"` to the neutral `under`-style surface and
`"over"`/`"under"` to the existing `over`/`under` visuals. Add a signed `hours` formatter:

```ts
import { cn } from "@/lib/utils";
import {
  capacityState,
  variancePct,
  varianceSecs,
  varianceState,
} from "@/lib/workload/rollup";
import type { CapacityState, WorkloadMetric } from "@/lib/workload/types";

function hours(secs: number): string {
  return `${Math.round(secs / 3600)}h`;
}
function signedHours(secs: number): string {
  const h = Math.round(secs / 3600);
  return `${h > 0 ? "+" : ""}${h}h`;
}
function signedPct(p: number | null): string {
  if (p === null) return "—";
  const v = Math.round(p * 100);
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** Map a variance state onto the existing cell color states. */
function varianceColorState(
  actualSecs: number,
  plannedSecs: number,
): CapacityState {
  const v = varianceState(actualSecs, plannedSecs);
  if (v === "over") return "over";
  if (v === "under") return "under";
  return "none"; // "on" / "none" → neutral surface
}
```

Then in the component body, branch before computing `displayState`/`primarySecs`:

```ts
if (metric === "variance") {
  const delta = varianceSecs(actualSecs, effortSecs);
  const pct = variancePct(actualSecs, effortSecs);
  const vState = varianceColorState(actualSecs, effortSecs);
  const empty = delta === 0 && vState === "none";
  return (
    <div
      data-testid="capacity-cell"
      data-state={vState}
      data-metric="variance"
      className={cn(
        "flex h-9 flex-col items-center justify-center rounded-md px-2 text-center tabular-nums transition-colors",
        empty && "text-muted-foreground/50",
        !empty && vState === "under" && "bg-surface-muted text-foreground",
        !empty &&
          vState === "over" &&
          "bg-destructive/15 text-destructive ring-destructive/30 ring-1",
        !empty && vState === "none" && "bg-surface-muted text-muted-foreground",
      )}
    >
      <span className="text-xs leading-tight font-medium">
        {signedHours(delta)}
      </span>
      <span className="text-muted-foreground text-[10px] leading-tight">
        {signedPct(pct)}
      </span>
    </div>
  );
}
```

> Design note: load `pulse-ui` first. Variance reuses the existing `destructive`/`surface-muted`
> tokens so coloring stays AA + colorblind-safe and is always paired with the numeric sign (never
> color-only) — consistent with the existing CapacityCell contract.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test -- src/components/workload/CapacityCell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workload/CapacityCell.tsx src/components/workload/CapacityCell.test.tsx
git commit -m "feat(workload): CapacityCell variance render"
```

---

## Task 3 — `DayActualsPopover` component (per-day drill-down)

**Files:**

- Create: `src/components/workload/DayActualsPopover.tsx`
- Test: `src/components/workload/DayActualsPopover.test.tsx`

**Interfaces:**

- **Consumes:** Task 1 (`DayActual`).
- **Produces:** `<DayActualsPopover>` — presentational; receives the resolved `DayActual[]` + label.

> Independent of Task 2 — both only consume Task 1. Run in the same batch.

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DayActualsPopover } from "./DayActualsPopover";

const H = 3600;

describe("DayActualsPopover", () => {
  it("renders one row per in-week day with its hours when opened", async () => {
    const user = userEvent.setup();
    render(
      <DayActualsPopover
        weekLabel="Jun 1"
        memberName="Ada"
        days={[
          { day: "2026-06-01", secs: 3 * H },
          { day: "2026-06-05", secs: 2 * H },
        ]}
      >
        <button>open</button>
      </DayActualsPopover>,
    );
    await user.click(screen.getByText("open"));
    expect(screen.getByText(/Mon/)).toBeInTheDocument();
    expect(screen.getByText("3h")).toBeInTheDocument();
    expect(screen.getByText("2h")).toBeInTheDocument();
  });

  it("shows an empty message when there are no day actuals", async () => {
    const user = userEvent.setup();
    render(
      <DayActualsPopover weekLabel="Jun 1" memberName="Ada" days={[]}>
        <button>open</button>
      </DayActualsPopover>,
    );
    await user.click(screen.getByText("open"));
    expect(screen.getByText(/No logged time/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- src/components/workload/DayActualsPopover.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

Load `pulse-ui` + `frontend-design` first. Mirror the `FilterSelect` popover idiom already in
`WorkloadGrid.tsx` (same `Popover`/`PopoverTrigger`/`PopoverContent`, monochrome classes).

```tsx
"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DayActual } from "@/lib/workload/types";

function dayLabel(iso: string): string {
  return new Date(Date.parse(iso + "T00:00:00Z")).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function hours(secs: number): string {
  return `${Math.round(secs / 3600)}h`;
}

/** Per-day actuals behind one (member, week) cell. Presentational: the parent
 * resolves `days` via `actualsForCell` (0 round-trips, spec §5). */
export function DayActualsPopover({
  weekLabel,
  memberName,
  days,
  children,
}: {
  weekLabel: string;
  memberName: string;
  days: DayActual[];
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={4}
        className="min-w-48 p-2"
        aria-label={`${memberName} — actuals for week of ${weekLabel}`}
      >
        <p className="text-muted-foreground mb-1 px-1 text-[11px] font-medium">
          {memberName} · week of {weekLabel}
        </p>
        {days.length === 0 ? (
          <p className="text-muted-foreground px-1 py-2 text-xs">
            No logged time this week.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {days.map((d) => (
              <li
                key={d.day}
                className="flex items-center justify-between rounded px-1 py-0.5 text-xs"
              >
                <span className="text-foreground">{dayLabel(d.day)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {hours(d.secs)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm test -- src/components/workload/DayActualsPopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workload/DayActualsPopover.tsx src/components/workload/DayActualsPopover.test.tsx
git commit -m "feat(workload): per-day actuals drill-down popover"
```

---

## Task 4 — Wire into `WorkloadGrid` + row-level variance summary

**Files:**

- Modify: `src/components/workload/WorkloadGrid.tsx`
- Modify: `src/components/workload/MemberRowHeader.tsx`

**Interfaces:**

- **Consumes:** Task 1 (`actualsForCell`), Task 2 (variance cell), Task 3 (`DayActualsPopover`).
- **Produces:** the integrated `/workload` UX (4th metric, cell drill-down, row variance).

> Depends on Tasks 2 + 3 (and transitively 1). Last in the DAG. This task is wiring; its behavior is
> covered by the component tests in 1–3 plus the manual walkthrough. (Optional: a focused
> `WorkloadGrid` interaction test if the harness already mounts it — check existing
> `WorkloadGrid.test.tsx` and extend if cheap; do not invent new mocking machinery.)

- [ ] **Step 1: Add `"variance"` to the metric toggle**

In `WorkloadGrid.tsx`:

- Extend `METRIC_LABEL`: `variance: "Variance"`.
- Widen the metric parse to accept it:

```ts
const metric: WorkloadMetric =
  rawMetric === "actual" || rawMetric === "both" || rawMetric === "variance"
    ? rawMetric
    : "planned";
```

- Add `"variance"` to the toggle's button array:

```ts
{(["planned", "actual", "both", "variance"] as WorkloadMetric[]).map((m) => ( … ))}
```

- [ ] **Step 2: Wrap drillable cells in `DayActualsPopover`**

Import `DayActualsPopover` and `actualsForCell`. In the `row.cells.map(...)`, when the row is a real
member (`row.userId` non-null) and the cell has `cell.actualSecs > 0` and the active metric is one
that surfaces actuals (`actual` / `both` / `variance`), wrap the `<CapacityCell>` in a popover
trigger; otherwise render the bare cell. Resolve `days` with the already-computed `boardIds` +
`weekStartsOn`:

```tsx
{
  row.cells.map((cell) => {
    const drillable =
      row.userId !== null &&
      cell.actualSecs > 0 &&
      (metric === "actual" || metric === "both" || metric === "variance");
    const weekLabel =
      grid.window.find((b) => b.weekKey === cell.weekKey)?.label ??
      cell.weekKey;
    const cellEl = (
      <CapacityCell
        effortSecs={cell.effortSecs}
        capacitySecs={cell.capacitySecs}
        actualSecs={cell.actualSecs}
        state={cell.state}
        metric={metric}
      />
    );
    return (
      <td key={cell.weekKey} className="border-b px-1.5 py-1.5 align-middle">
        {drillable && row.userId ? (
          <DayActualsPopover
            weekLabel={weekLabel}
            memberName={memberName}
            days={actualsForCell(
              actuals,
              row.userId,
              cell.weekKey,
              weekStartsOn,
              boardIds,
            )}
          >
            <button
              type="button"
              className="focus-visible:ring-ring w-full rounded focus-visible:ring-2 focus-visible:outline-none"
              aria-label={`Show daily actuals for ${memberName}, week of ${weekLabel}`}
            >
              {cellEl}
            </button>
          </DayActualsPopover>
        ) : (
          cellEl
        )}
      </td>
    );
  });
}
```

(`memberName` is already computed per row in the existing map.)

- [ ] **Step 3: Row-level variance summary in `MemberRowHeader`**

Read `MemberRowHeader.tsx` first. It already receives `totalEffortSecs` + `totalCapacitySecs`; add
an optional `totalActualSecs?: number` and `metric?: WorkloadMetric` prop and, when
`metric === "variance"`, render the row's total signed delta (reuse `varianceSecs` /
`variancePct` from `rollup.ts` — same `signedHours`/`signedPct` formatting as Task 2; if that
formatting is worth sharing, lift the two helpers into `rollup.ts` as exports and import them in
both `CapacityCell` and `MemberRowHeader` rather than duplicating). Pass `totalActualSecs={row.totalActualSecs}`
and `metric={metric}` from `WorkloadGrid`.

> Keep it minimal (spec Q5: metric-mode only, no separate report view). If lifting the formatters,
> add a one-line unit test for them in `rollup.test.ts`.

- [ ] **Step 4: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/workload/WorkloadGrid.tsx src/components/workload/MemberRowHeader.tsx
git commit -m "feat(workload): variance metric + drill-down wired into the grid"
```

---

## Execution DAG (AGENTS.md §6)

- **Edges:** T2 ← T1; T3 ← T1; T4 ← {T2, T3} (and transitively T1).
- **Batch 1:** T1 (pure math + types).
- **Batch 2 (parallel):** T2 (CapacityCell variance) ‖ T3 (DayActualsPopover) — disjoint files,
  both only consume T1.
- **Batch 3:** T4 (WorkloadGrid + MemberRowHeader wiring).
- **Critical path:** T1 → {T2 ‖ T3} → T4 = **depth 3**.
- **Parallelism note:** single worktree, single session — Batch 2 is concurrency _within_ the build
  (two independent files); if dispatched as parallel subagents they touch disjoint files so no
  worktree split is needed.

## Performance & data-fetching budget (AGENTS.md §5 — restated for the builder)

- **0 new server round-trips.** First paint is unchanged (`getWorkloadPageData` already ships raw
  rows + per-day `actuals` + clock). The variance toggle is History-API client state (same as the
  existing planned/actual/both toggle); the drill-down is a pure `actualsForCell` filter over the
  in-memory `actuals` array. **No Server Action, no `<Link>`/`router` nav** (gotcha-09).
- **No migration, no `pnpm db:types`.** Do not touch `supabase/migrations/` or
  `src/types/database.types.ts`. (If review reopens spec Q1/Q2 for a new RPC, see spec §7 for the
  versioned-migration + ledger-drift gating procedure — out of scope for this plan.)

## Tests (AGENTS.md §4)

Covered above, TDD per task: `rollup.test.ts` (variance + `actualsForCell`), `CapacityCell.test.tsx`
(variance render), `DayActualsPopover.test.tsx` (per-day rows + empty). No new RPC ⇒ **no new live
RLS integration test required**. Final gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## How to test this (manual walkthrough — fill in after merge)

1. Pull `develop`, run `pnpm dev`, open `/workload`.
2. In the **Show** toggle, pick **Variance** → cells show a signed delta (e.g. `+3h`) + pct
   (`+50%` / `—`), colored over (red) / under (muted) / neutral within ±10%.
3. With **Actual**, **Both**, or **Variance** active, **click a cell that has logged hours** → a
   popover lists that week's days with per-day hours; a week with no logged time shows
   "No logged time this week."
4. Confirm switching metric / opening popovers triggers **no full-page reload / no network refetch**
   (Network tab quiet) — all client-side.

---

## Self-review (against the spec)

- Spec (c) variance → T1 (math) + T2 (cell) + T4 (toggle + row summary). ✓
- Spec (a) per-day drill-down → T1 (`actualsForCell`) + T3 (popover) + T4 (wiring). ✓
- Spec (b) running-timer → **deferred**, not in any task (matches spec §3.3). ✓
- Budget: every interaction 0 round-trips, no migration (spec §5/§7). ✓
- Types consistent: `WorkloadMetric` union, `DayActual`, and helper signatures match between T1 and
  their consumers in T2–T4. ✓
- Open decisions (spec §9 Q1–Q5) are flagged at the top as a review gate; defaults (±10% band,
  unplanned→over, metric-mode-only) are encoded in the task code. ✓
