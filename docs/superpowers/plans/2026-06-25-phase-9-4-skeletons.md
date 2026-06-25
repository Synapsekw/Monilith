# Phase 9.4 Skeletons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add content-shaped `loading.tsx` fallbacks to the six remaining hot authenticated route segments, each backed by a reusable per-section skeleton component that mirrors the final layout for zero layout shift (CLS < 0.1) and doubles as a 9.2 `<Suspense>` fallback.

**Architecture:** One importable Server-Component skeleton per section (composed from the shared `<Skeleton>` primitive), plus a thin `loading.tsx` that renders it. Skeletons are pure static markup — 0 data fetch, 0 client JS — that mirror the real component's layout-owning scaffold (root wrapper, toolbar, table/grid container, row/column rhythm). Settings is the one inline exception (no other consumer). All six section skeletons are independent units buildable in parallel.

**Tech Stack:** Next.js 16 App Router (`loading.tsx` file convention — Server Component, no params, auto-wrapped in `<Suspense>`), React Server Components, Tailwind v4, the `<Skeleton>` primitive (`src/components/ui/skeleton.tsx`), Vitest (`unit` project, jsdom) + `@testing-library/react`.

## Global Constraints

- **Server Components only.** No `"use client"`, no hooks, no data fetching, no `await` in any skeleton or `loading.tsx`. Pure static markup. (AGENTS.md: Server Components by default; spec §Performance budget: 0 round-trips.)
- **Compose from the shared primitive.** Use `import { Skeleton } from "@/components/ui/skeleton"` for every loading block — do not hand-roll `bg-muted animate-pulse` divs. (Primitive at `src/components/ui/skeleton.tsx`.)
- **A11y contract on every skeleton root:** `role="status"`, `aria-busy="true"`, `aria-label="Loading <thing>"`. (Matches `SidebarNavSkeleton`/`HeaderUserSkeleton`.)
- **Mirror the layout-owning scaffold, not every pixel.** Root wrapper, toolbar height, table/grid container, and frozen-column widths MUST match the real component verbatim; inner content blocks may be approximate. (Spec §Zero-layout-shift strategy.)
- **Commit identity** pinned by `start-task.sh` to `Danijel Jovanovic <info@synapse-solutions.ai>`. Commit subjects lowercase after `type(scope):`; include a body + `Co-Authored-By` trailer. **Stage explicitly by path** — never `git add -A`/`.`.
- **Gates (every task ends green-or-untouched; full suite before finish):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Test runner:** `pnpm test -- <path>` runs a single file in the `unit` project. The `unit` project includes `src/**/*.{test,spec}.{ts,tsx}` under jsdom (see `vitest.config.ts`).

## File structure

| File                                                         | Responsibility                                        | Task |
| ------------------------------------------------------------ | ----------------------------------------------------- | ---- |
| `src/components/dashboards/DashboardCanvasSkeleton.tsx`      | `DashboardWidgetSkeleton` + `DashboardCanvasSkeleton` | 1    |
| `src/components/dashboards/DashboardCanvasSkeleton.test.tsx` | tests for the above                                   | 1    |
| `src/app/(app)/dashboards/[dashboardId]/loading.tsx`         | renders `DashboardCanvasSkeleton`                     | 1    |
| `src/components/goals/GoalTreeSkeleton.tsx`                  | `GoalTreeSkeleton`                                    | 2    |
| `src/components/goals/GoalTreeSkeleton.test.tsx`             | tests                                                 | 2    |
| `src/app/(app)/goals/loading.tsx`                            | page header + `GoalTreeSkeleton`                      | 2    |
| `src/components/portfolios/PortfolioGridSkeleton.tsx`        | `PortfolioGridSkeleton`                               | 3    |
| `src/components/portfolios/PortfolioGridSkeleton.test.tsx`   | tests                                                 | 3    |
| `src/app/(app)/portfolios/[portfolioId]/loading.tsx`         | title bar + `PortfolioGridSkeleton`                   | 3    |
| `src/components/time/TimeCardSkeleton.tsx`                   | `TimeCardSkeleton`                                    | 4    |
| `src/components/time/TimeCardSkeleton.test.tsx`              | tests                                                 | 4    |
| `src/app/(app)/time/loading.tsx`                             | renders `TimeCardSkeleton`                            | 4    |
| `src/components/workload/WorkloadGridSkeleton.tsx`           | `WorkloadGridSkeleton`                                | 5    |
| `src/components/workload/WorkloadGridSkeleton.test.tsx`      | tests                                                 | 5    |
| `src/app/(app)/workload/loading.tsx`                         | renders `WorkloadGridSkeleton`                        | 5    |
| `src/app/(app)/settings/loading.tsx`                         | inline cards skeleton                                 | 6    |
| `src/app/(app)/settings/loading.test.tsx`                    | tests for the settings loader                         | 6    |
| `src/components/boards/[boardId]` board loader (optional)    | add `role="status"` for consistency                   | 7    |

Note: `(app)` is a route group; paths contain literal parentheses. In `git add` quote the path: `git add 'src/app/(app)/goals/loading.tsx'`.

---

### Task 1: Dashboard canvas skeleton + loading

**Files:**

- Create: `src/components/dashboards/DashboardCanvasSkeleton.tsx`
- Test: `src/components/dashboards/DashboardCanvasSkeleton.test.tsx`
- Create: `src/app/(app)/dashboards/[dashboardId]/loading.tsx`

**Interfaces:**

- Consumes: `Skeleton` from `@/components/ui/skeleton` (signature `({ className, ...props }: HTMLAttributes<HTMLDivElement>) => JSX.Element`).
- Produces:
  - `export function DashboardWidgetSkeleton(): JSX.Element` — single widget card chrome.
  - `export function DashboardCanvasSkeleton(): JSX.Element` — full canvas (toolbar + grid of widget cards), root has `role="status"`.
  - `loading.tsx` default export `() => JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboards/DashboardCanvasSkeleton.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DashboardCanvasSkeleton,
  DashboardWidgetSkeleton,
} from "./DashboardCanvasSkeleton";

describe("DashboardCanvasSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<DashboardCanvasSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the canvas layout scaffold (root wrapper + toolbar)", () => {
    render(<DashboardCanvasSkeleton />);
    const status = screen.getByRole("status");
    // Root wrapper must match DashboardCanvas: flex flex-col gap-3 p-4
    expect(status.className).toContain("flex");
    expect(status.className).toContain("flex-col");
    expect(status.className).toContain("gap-3");
    expect(status.className).toContain("p-4");
  });

  it("renders a static grid of widget-card placeholders", () => {
    render(<DashboardCanvasSkeleton />);
    expect(
      screen.getAllByTestId("widget-skeleton").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("widget card mirrors the real card chrome (border + header divider)", () => {
    render(<DashboardWidgetSkeleton />);
    const card = screen.getByTestId("widget-skeleton");
    expect(card.className).toContain("rounded-xl");
    expect(card.className).toContain("border");
    expect(card.className).toContain("flex-col");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/dashboards/DashboardCanvasSkeleton.test.tsx`
Expected: FAIL — cannot resolve `./DashboardCanvasSkeleton`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/dashboards/DashboardCanvasSkeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Single dashboard-widget card chrome. Mirrors DashboardWidget:
 * `bg-card flex h-full flex-col overflow-hidden rounded-xl border`,
 * header `border-b px-3 py-2`, body `min-h-0 flex-1 p-3`.
 */
export function DashboardWidgetSkeleton() {
  return (
    <div
      data-testid="widget-skeleton"
      className="bg-card flex h-full flex-col overflow-hidden rounded-xl border"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-4" />
      </div>
      <div className="min-h-0 flex-1 p-3">
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

// Representative span heights (DashboardCanvas rowHeight=80, margin 12):
// h=2 -> ~172px, h=3 -> ~252px. Fixed heights keep the box stable.
const WIDGET_HEIGHTS = [
  "h-[172px]",
  "h-[252px]",
  "h-[172px]",
  "h-[172px]",
  "h-[252px]",
  "h-[172px]",
];

/**
 * Full dashboard canvas loading state. Mirrors DashboardCanvas:
 * root `flex flex-col gap-3 p-4`, toolbar `flex items-center justify-between`,
 * then a responsive grid of widget cards. Static markup, 0 data fetch.
 */
export function DashboardCanvasSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
      className="flex flex-col gap-3 p-4"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {WIDGET_HEIGHTS.map((h, i) => (
          <div key={i} className={h}>
            <DashboardWidgetSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
```

```tsx
// src/app/(app)/dashboards/[dashboardId]/loading.tsx
import { DashboardCanvasSkeleton } from "@/components/dashboards/DashboardCanvasSkeleton";

/**
 * Instant loading fallback for a dashboard. Mirrors the canvas layout so the
 * widget grid swaps in with zero layout shift. Also reused as the 9.2 Suspense
 * fallback. Static Server Component — no data fetch.
 */
export default function DashboardLoading() {
  return <DashboardCanvasSkeleton />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/dashboards/DashboardCanvasSkeleton.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/DashboardCanvasSkeleton.tsx \
        src/components/dashboards/DashboardCanvasSkeleton.test.tsx \
        'src/app/(app)/dashboards/[dashboardId]/loading.tsx'
git commit -m "feat(dashboards): content-shaped loading skeleton

Add DashboardCanvasSkeleton + DashboardWidgetSkeleton mirroring the
widget grid, and a loading.tsx fallback for dashboards/[dashboardId].
Zero data fetch; reused as the 9.2 Suspense fallback.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 2: Goals tree skeleton + loading

**Files:**

- Create: `src/components/goals/GoalTreeSkeleton.tsx`
- Test: `src/components/goals/GoalTreeSkeleton.test.tsx`
- Create: `src/app/(app)/goals/loading.tsx`

**Interfaces:**

- Consumes: `Skeleton` from `@/components/ui/skeleton`.
- Produces: `export function GoalTreeSkeleton(): JSX.Element` (root `role="status"`, mirrors `GoalTree`'s `flex h-full flex-col` + sticky table); `loading.tsx` default export.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/goals/GoalTreeSkeleton.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoalTreeSkeleton } from "./GoalTreeSkeleton";

describe("GoalTreeSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<GoalTreeSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors GoalTree's full-height column scaffold", () => {
    render(<GoalTreeSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("h-full");
    expect(status.className).toContain("flex-col");
  });

  it("renders a header bar and ~8 placeholder rows", () => {
    render(<GoalTreeSkeleton />);
    expect(screen.getByTestId("skeleton-header")).toBeInTheDocument();
    expect(screen.getAllByTestId("goal-row-skeleton").length).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/goals/GoalTreeSkeleton.test.tsx`
Expected: FAIL — cannot resolve `./GoalTreeSkeleton`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/goals/GoalTreeSkeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for the goals page. Mirrors the page header (`border-b px-6
 * py-3`, title + new-goal button) and GoalTree's full-height sticky table
 * (4 columns: Goal / Progress / Status / Owner). Static — 0 data fetch.
 */
export function GoalTreeSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading goals"
      className="flex h-full flex-col"
    >
      <div
        data-testid="skeleton-header"
        className="flex items-center justify-between border-b px-6 py-3"
      >
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-card sticky top-0 z-10 text-left text-xs">
            <tr className="border-b">
              {["w-40", "w-24", "w-20", "w-24"].map((w, i) => (
                <th key={i} className="px-3 py-2 font-medium">
                  <Skeleton className={`h-3 ${w}`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} data-testid="goal-row-skeleton" className="border-t">
                <td className="px-3 py-2">
                  <div style={{ paddingLeft: (i % 3) * 20 }}>
                    <Skeleton className="h-4 w-48" />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-2 w-24 rounded-full" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
                <td className="px-3 py-2">
                  <Skeleton className="h-3 w-20" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

```tsx
// src/app/(app)/goals/loading.tsx
import { GoalTreeSkeleton } from "@/components/goals/GoalTreeSkeleton";

/** Instant loading fallback for the goals page. Static Server Component. */
export default function GoalsLoading() {
  return <GoalTreeSkeleton />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/goals/GoalTreeSkeleton.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/goals/GoalTreeSkeleton.tsx \
        src/components/goals/GoalTreeSkeleton.test.tsx \
        'src/app/(app)/goals/loading.tsx'
git commit -m "feat(goals): content-shaped loading skeleton

Add GoalTreeSkeleton mirroring the goals header + sticky tree table, and
a loading.tsx fallback. Zero data fetch; reused as the 9.2 Suspense fallback.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 3: Portfolio grid skeleton + loading

**Files:**

- Create: `src/components/portfolios/PortfolioGridSkeleton.tsx`
- Test: `src/components/portfolios/PortfolioGridSkeleton.test.tsx`
- Create: `src/app/(app)/portfolios/[portfolioId]/loading.tsx`

**Interfaces:**

- Consumes: `Skeleton` from `@/components/ui/skeleton`.
- Produces: `export function PortfolioGridSkeleton(): JSX.Element` (root `role="status"`, `flex h-full flex-col`, title bar + 9-col table); `loading.tsx` default export.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/portfolios/PortfolioGridSkeleton.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortfolioGridSkeleton } from "./PortfolioGridSkeleton";

describe("PortfolioGridSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<PortfolioGridSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the full-height column scaffold", () => {
    render(<PortfolioGridSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("h-full");
    expect(status.className).toContain("flex-col");
  });

  it("renders a 9-column header and ~8 rows", () => {
    render(<PortfolioGridSkeleton />);
    expect(screen.getAllByTestId("portfolio-col-skeleton").length).toBe(9);
    expect(screen.getAllByTestId("portfolio-row-skeleton").length).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/portfolios/PortfolioGridSkeleton.test.tsx`
Expected: FAIL — cannot resolve `./PortfolioGridSkeleton`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/portfolios/PortfolioGridSkeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for a portfolio. Mirrors the page title bar (`border-b px-4
 * py-3`) and PortfolioGrid's 9-column sticky table. Static — 0 data fetch.
 */
export function PortfolioGridSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading portfolio"
      className="flex h-full flex-col"
    >
      <div className="border-b px-4 py-3">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-card text-muted-foreground sticky top-0 z-10 text-xs">
            <tr className="border-b">
              {Array.from({ length: 9 }).map((_, i) => (
                <th
                  key={i}
                  data-testid="portfolio-col-skeleton"
                  className="px-3 py-2 text-left"
                >
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, r) => (
              <tr
                key={r}
                data-testid="portfolio-row-skeleton"
                className="border-t"
              >
                {Array.from({ length: 9 }).map((_, c) => (
                  <td key={c} className="px-3 py-2">
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

```tsx
// src/app/(app)/portfolios/[portfolioId]/loading.tsx
import { PortfolioGridSkeleton } from "@/components/portfolios/PortfolioGridSkeleton";

/** Instant loading fallback for a portfolio. Static Server Component. */
export default function PortfolioLoading() {
  return <PortfolioGridSkeleton />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/portfolios/PortfolioGridSkeleton.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/portfolios/PortfolioGridSkeleton.tsx \
        src/components/portfolios/PortfolioGridSkeleton.test.tsx \
        'src/app/(app)/portfolios/[portfolioId]/loading.tsx'
git commit -m "feat(portfolios): content-shaped loading skeleton

Add PortfolioGridSkeleton mirroring the title bar + 9-column table, and a
loading.tsx fallback. Zero data fetch; reused as the 9.2 Suspense fallback.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 4: Time card skeleton + loading

**Files:**

- Create: `src/components/time/TimeCardSkeleton.tsx`
- Test: `src/components/time/TimeCardSkeleton.test.tsx`
- Create: `src/app/(app)/time/loading.tsx`

**Interfaces:**

- Consumes: `Skeleton` from `@/components/ui/skeleton`.
- Produces: `export function TimeCardSkeleton(): JSX.Element` (root `role="status"`, `flex h-full flex-col`, toolbar + frozen-left week grid: `w-64` label col + 7 day cols + totals col + footer row); `loading.tsx` default export.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/time/TimeCardSkeleton.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimeCardSkeleton } from "./TimeCardSkeleton";

describe("TimeCardSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<TimeCardSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the full-height column scaffold", () => {
    render(<TimeCardSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("h-full");
    expect(status.className).toContain("flex-col");
  });

  it("renders the frozen label column at the real width (w-64)", () => {
    render(<TimeCardSkeleton />);
    const label = screen.getByTestId("frozen-label-col");
    expect(label.className).toContain("w-64");
    expect(label.className).toContain("sticky");
  });

  it("renders 7 day columns and a toolbar", () => {
    render(<TimeCardSkeleton />);
    expect(screen.getByTestId("skeleton-toolbar")).toBeInTheDocument();
    expect(screen.getAllByTestId("day-col-skeleton").length).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/time/TimeCardSkeleton.test.tsx`
Expected: FAIL — cannot resolve `./TimeCardSkeleton`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/time/TimeCardSkeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for the weekly time card. Mirrors TimeCard: toolbar
 * (`border-b px-4 py-3`, title + week nav) and a frozen-left week grid —
 * `w-64` label column, 7 day columns (`min-w-20`), totals column, footer
 * total row. Static — 0 data fetch.
 */
export function TimeCardSkeleton() {
  const days = Array.from({ length: 7 });
  const rows = Array.from({ length: 6 });
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading time card"
      className="flex h-full flex-col"
    >
      <div
        data-testid="skeleton-toolbar"
        className="flex items-center justify-between gap-3 border-b px-4 py-3"
      >
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-8" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="size-8" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-card sticky top-0 z-20 text-xs">
            <tr>
              <th
                data-testid="frozen-label-col"
                className="bg-card sticky left-0 z-30 w-64 min-w-64 border-r border-b px-4 py-2 text-left"
              >
                <Skeleton className="h-3 w-24" />
              </th>
              {days.map((_, i) => (
                <th
                  key={i}
                  data-testid="day-col-skeleton"
                  className="min-w-20 border-b px-2 py-2"
                >
                  <Skeleton className="mx-auto h-3 w-10" />
                </th>
              ))}
              <th className="min-w-20 border-b border-l px-2 py-2">
                <Skeleton className="mx-auto h-3 w-10" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((_, r) => (
              <tr key={r}>
                <td className="bg-background sticky left-0 z-10 w-64 min-w-64 border-r border-b px-4 py-1.5">
                  <Skeleton className="h-4 w-40" />
                </td>
                {days.map((_, c) => (
                  <td key={c} className="border-b px-1.5 py-1.5 text-center">
                    <Skeleton className="mx-auto h-6 w-12" />
                  </td>
                ))}
                <td className="border-b border-l px-2 py-1.5 text-center">
                  <Skeleton className="mx-auto h-4 w-8" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="bg-card sticky left-0 z-10 border-t border-r px-4 py-2">
                <Skeleton className="h-3 w-20" />
              </td>
              {days.map((_, c) => (
                <td key={c} className="border-t px-2 py-2 text-center">
                  <Skeleton className="mx-auto h-3 w-8" />
                </td>
              ))}
              <td className="border-t border-l px-2 py-2 text-center">
                <Skeleton className="mx-auto h-3 w-8" />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
```

```tsx
// src/app/(app)/time/loading.tsx
import { TimeCardSkeleton } from "@/components/time/TimeCardSkeleton";

/** Instant loading fallback for the time card. Static Server Component. */
export default function TimeLoading() {
  return <TimeCardSkeleton />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/time/TimeCardSkeleton.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/time/TimeCardSkeleton.tsx \
        src/components/time/TimeCardSkeleton.test.tsx \
        'src/app/(app)/time/loading.tsx'
git commit -m "feat(time): content-shaped loading skeleton

Add TimeCardSkeleton mirroring the toolbar + frozen-left week grid, and a
loading.tsx fallback. Zero data fetch; reused as the 9.2 Suspense fallback.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 5: Workload grid skeleton + loading

**Files:**

- Create: `src/components/workload/WorkloadGridSkeleton.tsx`
- Test: `src/components/workload/WorkloadGridSkeleton.test.tsx`
- Create: `src/app/(app)/workload/loading.tsx`

**Interfaces:**

- Consumes: `Skeleton` from `@/components/ui/skeleton`.
- Produces: `export function WorkloadGridSkeleton(): JSX.Element` (root `role="status"`, `flex h-full flex-col`, filter toolbar + frozen-left grid: `w-56` member col + ~12 week cols); `loading.tsx` default export.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/workload/WorkloadGridSkeleton.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkloadGridSkeleton } from "./WorkloadGridSkeleton";

describe("WorkloadGridSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<WorkloadGridSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the full-height column scaffold", () => {
    render(<WorkloadGridSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("h-full");
    expect(status.className).toContain("flex-col");
  });

  it("renders the frozen member column at the real width (w-56)", () => {
    render(<WorkloadGridSkeleton />);
    const member = screen.getByTestId("frozen-member-col");
    expect(member.className).toContain("w-56");
    expect(member.className).toContain("sticky");
  });

  it("renders a filter toolbar and week columns", () => {
    render(<WorkloadGridSkeleton />);
    expect(screen.getByTestId("skeleton-toolbar")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("week-col-skeleton").length,
    ).toBeGreaterThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/workload/WorkloadGridSkeleton.test.tsx`
Expected: FAIL — cannot resolve `./WorkloadGridSkeleton`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/workload/WorkloadGridSkeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for the workload grid. Mirrors WorkloadGrid: filter toolbar
 * (`border-b px-4 py-3` with pill groups) and a frozen-left grid — `w-56`
 * member column, ~12 week columns (`min-w-24`). Static — 0 data fetch.
 */
export function WorkloadGridSkeleton() {
  const weeks = Array.from({ length: 12 });
  const rows = Array.from({ length: 6 });
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading workload"
      className="flex h-full flex-col"
    >
      <div
        data-testid="skeleton-toolbar"
        className="flex items-center justify-between gap-3 border-b px-4 py-3"
      >
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-44" />
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20" />
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-card sticky top-0 z-20 text-xs">
            <tr>
              <th
                data-testid="frozen-member-col"
                className="bg-card sticky left-0 z-30 w-56 min-w-56 border-r border-b px-4 py-2 text-left"
              >
                <Skeleton className="h-3 w-20" />
              </th>
              {weeks.map((_, i) => (
                <th
                  key={i}
                  data-testid="week-col-skeleton"
                  className="min-w-24 border-b px-2 py-2 text-center"
                >
                  <Skeleton className="mx-auto h-3 w-12" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((_, r) => (
              <tr key={r}>
                <td className="bg-background sticky left-0 z-10 w-56 min-w-56 border-r border-b px-4 py-2">
                  <Skeleton className="h-4 w-36" />
                </td>
                {weeks.map((_, c) => (
                  <td key={c} className="border-b px-1.5 py-1.5 align-middle">
                    <Skeleton className="h-6 w-full" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

```tsx
// src/app/(app)/workload/loading.tsx
import { WorkloadGridSkeleton } from "@/components/workload/WorkloadGridSkeleton";

/** Instant loading fallback for the workload grid. Static Server Component. */
export default function WorkloadLoading() {
  return <WorkloadGridSkeleton />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/workload/WorkloadGridSkeleton.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/workload/WorkloadGridSkeleton.tsx \
        src/components/workload/WorkloadGridSkeleton.test.tsx \
        'src/app/(app)/workload/loading.tsx'
git commit -m "feat(workload): content-shaped loading skeleton

Add WorkloadGridSkeleton mirroring the filter toolbar + frozen-left week
grid, and a loading.tsx fallback. Zero data fetch; reused as the 9.2
Suspense fallback.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 6: Settings loading (inline cards)

**Files:**

- Create: `src/app/(app)/settings/loading.tsx`
- Test: `src/app/(app)/settings/loading.test.tsx`

**Interfaces:**

- Consumes: `Skeleton` from `@/components/ui/skeleton`; `Card`, `CardHeader`, `CardContent` from `@/components/ui/card`.
- Produces: `loading.tsx` default export `() => JSX.Element` (root `role="status"`). No separate exported component — nothing else consumes the settings skeleton.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/(app)/settings/loading.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsLoading from "./loading";

describe("SettingsLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<SettingsLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the centered settings column (max-w-3xl)", () => {
    render(<SettingsLoading />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("max-w-3xl");
    expect(status.className).toContain("mx-auto");
  });

  it("renders three card placeholders", () => {
    render(<SettingsLoading />);
    expect(screen.getAllByTestId("settings-card-skeleton").length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- 'src/app/(app)/settings/loading.test.tsx'`
Expected: FAIL — cannot resolve `./loading`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/app/(app)/settings/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Instant loading fallback for settings. Mirrors the page's centered
 * `mx-auto max-w-3xl px-6 py-10` column and three stacked Cards (Preferences,
 * Organization, Members). Static Server Component — no data fetch.
 */
export default function SettingsLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading settings"
      className="mx-auto max-w-3xl px-6 py-10"
    >
      <div className="mb-8 flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} data-testid="settings-card-skeleton">
            <CardHeader className="flex flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-56" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- 'src/app/(app)/settings/loading.test.tsx'`
Expected: PASS (3 tests).

Note: confirm `Card`/`CardHeader`/`CardContent` forward `data-testid` (they spread props in shadcn). If `CardHeader` does not accept `className` as a flex container, keep the header children stacked with a wrapping `<div className="flex flex-col gap-2">` instead.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/settings/loading.tsx' \
        'src/app/(app)/settings/loading.test.tsx'
git commit -m "feat(settings): content-shaped loading skeleton

Add an inline loading.tsx mirroring the centered settings column and three
stacked cards. Zero data fetch.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

### Task 7 (optional, consistency): standardise board loader a11y

**Files:**

- Modify: `src/app/(app)/boards/[boardId]/loading.tsx`

**Interfaces:**

- Consumes: nothing new.
- Produces: no API change — adds `role="status"` to the existing board loader root so all seven page skeletons share the identical a11y contract.

- [ ] **Step 1: Add `role="status"` to the existing board loader root**

```tsx
// in src/app/(app)/boards/[boardId]/loading.tsx, on the root <div>:
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading board"
      className="flex h-full flex-col gap-4 p-6"
    >
```

- [ ] **Step 2: Run the full unit suite to confirm nothing regressed**

Run: `pnpm test`
Expected: PASS (all unit tests, including the 5 new skeleton test files).

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/boards/[boardId]/loading.tsx'
git commit -m "refactor(boards): align board loader a11y with skeleton contract

Add role=status to the board loading.tsx so all page skeletons share the
same status/aria-busy/aria-label contract.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

## Final verification (before finish-task)

- [ ] **Run all gates:**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green. The `build` step compiles the six new `loading.tsx` files (Next type-checks them as Server Components and verifies no client-only APIs leak in).

- [ ] **Manual CLS spot-check (human acceptance):** with `develop` running, throttle network (DevTools → Slow 3G) and navigate to each of `/dashboards/<id>`, `/goals`, `/portfolios/<id>`, `/settings`, `/time`, `/workload`. Confirm the skeleton paints instantly and the real content swaps in **without the layout jumping** (watch the toolbar/first row position). DevTools → Performance → "Layout Shift" should report no shift attributable to the swap. This is the strategy-level check; formal Lighthouse CLS enforcement is Phase 9.6.

- [ ] **Finish:** run `scripts/finish-task.sh` from inside the worktree (rebases onto `develop`, re-runs gates against the merged state, merges, pushes, removes the worktree).

## How to test this (for the closing message + /wrapup)

1. Pull `develop`, run the app locally (or use the deployed preview).
2. Open DevTools → Network, set throttling to **Slow 3G** (so the loading frame is visible).
3. Navigate (via the sidebar, so the shell stays mounted) to each: a **dashboard**, **Goals**, a **portfolio**, **Settings**, **Time**, **Workload**.
4. Expected at each: a **content-shaped skeleton** (toolbar + grid/table/cards matching that page) appears **instantly**, then real data fills in **with no layout jump** — the toolbar and first row/card stay in place through the swap.
5. (a11y) With a screen reader or the accessibility inspector, confirm each loading region is announced as a busy "Loading …" status.

---

## Execution DAG (AGENTS.md rule #6)

**Dependency edges** (from the `Interfaces` blocks): every section task (1–6) consumes only the already-shipped `<Skeleton>` primitive (read-only) and touches a **disjoint** folder. None consumes another task's `Produces`. Task 7 is an unrelated one-line consistency edit on a pre-existing file.

```
Batch 1 (all parallel — no shared state, disjoint folders):
  Task 1 (dashboards)   Task 2 (goals)   Task 3 (portfolios)
  Task 4 (time)         Task 5 (workload) Task 6 (settings)
  Task 7 (board a11y — independent, may join Batch 1 or run anytime)

Batch 2 (after Batch 1 lands):
  Final verification (typecheck/lint/test/build over the merged state) + manual CLS spot-check
```

- **Dependency graph:** Tasks 1–7 each depend on nothing but the existing `Skeleton`/`Card` primitives. No inter-task edges.
- **Parallel batches:** **Batch 1** = {Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7} — seven independent units, dispatched concurrently (per `superpowers:dispatching-parallel-agents`). Because each task writes to a distinct folder, they can run in the **same worktree** without clobbering, or in isolated worktrees if dispatched as parallel agents. **Batch 2** = the final verification pass, which depends on all of Batch 1.
- **Critical path:** any single section task → final verification. Wall-clock floor ≈ one task (≈ minutes) + the verification gate. The 7 tasks do **not** serialize.

**Disjointness from the parallel 9.3 cache task:** 9.3 modifies `src/lib/**` data fetchers; this slice only creates `src/app/(app)/**/loading.tsx` + `src/components/**/*Skeleton.tsx` (and one a11y tweak to an existing `loading.tsx`). **No file overlap** → 9.4-skeletons and 9.3 run concurrently with zero coordination.

---

## Self-review

- **Spec coverage:** all six route segments from the spec table have a task (1–6); per-section skeleton components (`DashboardWidgetSkeleton`, `GoalTreeSkeleton`, `PortfolioGridSkeleton`, `TimeCardSkeleton`, `WorkloadGridSkeleton`) are produced in Tasks 1–5; settings inline exception is Task 6; the a11y-standardisation decision is Task 7; performance budget (0 fetch, static) is enforced by Global Constraints + the build gate; CLS/stable-height tests are Step 1 of each task; Execution DAG present; disjointness from 9.3 stated. Deferred 9.4 items (pending states, prefetch, optimistic audit, toggle audit, media CLS, list-page skeletons) are explicitly out of scope per the spec.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; every test step shows the assertions.
- **Type consistency:** every skeleton is a zero-arg `() => JSX.Element`; component names match between the file-structure table, the `Produces` blocks, the `loading.tsx` imports, and the commits. `data-testid` hooks (`widget-skeleton`, `goal-row-skeleton`, `portfolio-col-skeleton`/`portfolio-row-skeleton`, `frozen-label-col`/`day-col-skeleton`, `frozen-member-col`/`week-col-skeleton`, `settings-card-skeleton`, `skeleton-toolbar`, `skeleton-header`) are consistent between each test and its implementation.
- **One open question, low-risk:** Task 6 assumes shadcn `Card*` primitives spread `data-testid`/`className` (they do in this repo's shadcn setup); the task note gives the fallback if `CardHeader` doesn't accept a flex `className`.
