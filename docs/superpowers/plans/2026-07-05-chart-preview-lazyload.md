# Chart Preview Lazy-Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `recharts` (and the P2 chart modules) out of the dashboard first-paint bundle by deferring `ChartWidget` behind a shared `dynamic()` wrapper used by both `DashboardWidget` and the `WidgetConfigSheet` preview, and replace the self-referential guard test with one that asserts the real transitive import boundary.

**Architecture:** Approach 1 from the spec — extract a single `LazyChartWidget` module whose only static dependency is `next/dynamic` (the `ChartWidget` reference lives inside `dynamic(() => import(...))`, a code-split edge). Both first-paint consumers import that wrapper statically, so no static path reaches `recharts`. A dependency-free import-graph test walks `DashboardWidget.tsx`'s static edges and asserts `ChartWidget`/`recharts` are unreachable.

**Tech Stack:** Next.js 16 (`next/dynamic`, `ssr: false`), React 19 client components, Vitest + Testing Library (jsdom), pnpm.

**Spec:** `docs/superpowers/specs/2026-07-05-chart-preview-lazyload-design.md`

> **Approach decision (from spec Risk #1):** This plan implements **Approach 1 (shared `LazyChartWidget`)**. If the reviewer instead chooses **Approach 2 (inline `dynamic()` in `WidgetConfigSheet` only)**, skip creating `LazyChartWidget.tsx` and Task 2's `DashboardWidget` edit; instead inline the `dynamic()` block into `WidgetConfigSheet.tsx` mirroring `DashboardWidget.tsx:30-41`. Tasks 1, 3, 4, 5 are unchanged either way.

## Performance & data-fetching budget (working-agreement #5)

First-paint client-bundle optimization only; **0 new server round-trips**. recharts (~35 KB gz) + P2 chart modules move out of the dashboard first-paint chunk into an on-demand chunk fetched only when a chart mounts (on-grid chart, or a chart selected/edited in the config sheet). No data-fetch path changes: the preview's single draft-scoped fetch (`WidgetPreviewProvider` / `useWidgetSeries`) is untouched; add/save still go through the existing Server Actions. No new list/board reads.

## Execution DAG (working-agreement #6)

- **Nodes:** one unit of work — `chart-preview-lazyload`.
- **Dependency graph:** Task 1 → Task 2 → Task 3 → Task 4 → Task 5 (a strict TDD chain over the same handful of files; no independent sub-tasks).
- **Parallel batches:** Batch 1 = {the whole task}. No task is independent of another; nothing to fan out.
- **Critical path:** Task 1 → 2 → 3 → 4 → 5 (the entire chain). Wall-clock floor = the chain; **single agent, no parallel dispatch.**

## File Structure

- **Create:** `src/components/dashboards/widgets/LazyChartWidget.tsx` — the sole deferred entry point to `ChartWidget`; statically imports only `next/dynamic`.
- **Create:** `src/components/dashboards/no-recharts-in-first-paint.test.ts` — transitive static-import boundary guard (pure Node, no jsdom).
- **Create:** `src/components/dashboards/WidgetConfigSheet.test.tsx` — behavioral test: chart preview renders through the lazy path.
- **Modify:** `src/components/dashboards/DashboardWidget.tsx` — replace its inline `dynamic()` block with an import of `LazyChartWidget`.
- **Modify:** `src/components/dashboards/WidgetConfigSheet.tsx` — replace the static `ChartWidget` import with `LazyChartWidget`.
- **Modify:** `src/components/dashboards/DashboardWidget.test.tsx` — remove the stale self-referential grep guard (and its now-unused `readFileSync`/`join` imports); keep the lazy-path render test.

---

### Task 1: Transitive import-boundary guard (RED first)

**Files:**

- Create/Test: `src/components/dashboards/no-recharts-in-first-paint.test.ts`

This test encodes the invariant "no static import path from dashboard first-paint code reaches `ChartWidget`/`recharts`." With the current codebase it MUST fail (ChartWidget is reachable via `WidgetConfigSheet`). That failure is the RED that Task 2 turns green.

- [ ] **Step 1: Write the failing test**

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const ENTRY = join(SRC, "components/dashboards/DashboardWidget.tsx");
const CHART_WIDGET = join(SRC, "components/dashboards/widgets/ChartWidget.tsx");

/**
 * Static import/re-export edges of one file. Deferred `dynamic(() => import())`
 * / bare `import()` calls have no `from` clause and are intentionally NOT
 * matched — that is exactly the code-split boundary we want to stop following.
 * Type-only edges (`import type … from`) are erased at build, so they carry no
 * runtime dependency and are skipped.
 */
function staticEdges(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const edges: string[] = [];
  const fromRe =
    /(?:^|\n)\s*(?:import|export)\b([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src))) {
    if (/^\s*type\b/.test(m[1])) continue; // erased at build
    edges.push(m[2]);
  }
  const sideRe = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  while ((m = sideRe.exec(src))) edges.push(m[1]);
  return edges;
}

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(fromFile), spec);
  else return null; // bare specifier → node_modules, not a first-party file
  const candidates = [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** First-party files + bare specifiers reachable via STATIC edges from `entry`. */
function reachable(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of staticEdges(file)) {
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const resolved = resolveSpec(spec, file);
        if (resolved) stack.push(resolved);
      } else {
        bare.add(spec);
      }
    }
  }
  return { files, bare };
}

describe("dashboard first-paint bundle boundary", () => {
  const { files, bare } = reachable(ENTRY);

  it("does not statically reach ChartWidget from DashboardWidget", () => {
    expect(files.has(CHART_WIDGET)).toBe(false);
  });

  it("does not statically reach recharts from DashboardWidget", () => {
    expect(bare.has("recharts")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (RED)**

Run: `pnpm test -- no-recharts-in-first-paint`
Expected: BOTH assertions FAIL — `ChartWidget` is reachable via `DashboardWidget → WidgetConfigSheet → ChartWidget`, and `recharts` is a bare edge of `ChartWidget`. This proves the guard actually detects the current regression.

- [ ] **Step 3: Commit the failing guard**

```bash
git add src/components/dashboards/no-recharts-in-first-paint.test.ts
git commit -m "test(dashboards): add transitive recharts-first-paint guard (currently red)"
```

---

### Task 2: Shared `LazyChartWidget` + rewire consumers (GREEN)

**Files:**

- Create: `src/components/dashboards/widgets/LazyChartWidget.tsx`
- Modify: `src/components/dashboards/DashboardWidget.tsx` (lines ~25-41 inline `dynamic()`; render at ~144)
- Modify: `src/components/dashboards/WidgetConfigSheet.tsx` (import line 19; render at ~156)

- [ ] **Step 1: Create the deferred wrapper**

`src/components/dashboards/widgets/LazyChartWidget.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";

// The single deferred entry point to the recharts-backed ChartWidget. Importing
// THIS module statically is recharts-free: the ChartWidget reference lives
// inside dynamic(() => import(...)), a code-split boundary. First-paint
// dashboard code (DashboardWidget, the WidgetConfigSheet preview) imports this
// wrapper so recharts + the P2 chart modules never enter the first-paint chunk.
// Mirrors the PdfPreview pattern in FilePreviewLightbox.tsx.
// Fallback = ChartWidget's own loading skeleton, so there is no layout shift
// (the widget shell / h-64 preview card owns sizing).
export const LazyChartWidget = dynamic(
  () =>
    import("@/components/dashboards/widgets/ChartWidget").then(
      (m) => m.ChartWidget,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 h-full animate-pulse rounded-md" />
    ),
  },
);
```

- [ ] **Step 2: Rewire `DashboardWidget.tsx`**

Delete the inline block currently at lines ~25-41:

```tsx
// Client-only recharts renderer (~35 KB gzip) — lazily loaded only when a chart
// ... (whole comment) ...
const ChartWidget = dynamic(
  () =>
    import("@/components/dashboards/widgets/ChartWidget").then(
      (m) => m.ChartWidget,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 h-full animate-pulse rounded-md" />
    ),
  },
);
```

Remove the now-unused `import dynamic from "next/dynamic";` (line 4). Add, with the other widget imports (after the `ListWidget` import, ~line 18):

```tsx
import { LazyChartWidget } from "@/components/dashboards/widgets/LazyChartWidget";
```

Change the chart branch (line ~144) from `<ChartWidget widget={widget} />` to:

```tsx
) : widget.kind === "chart" ? (
  <LazyChartWidget widget={widget} />
```

- [ ] **Step 3: Rewire `WidgetConfigSheet.tsx`**

Replace line 19:

```tsx
import { ChartWidget } from "@/components/dashboards/widgets/ChartWidget";
```

with:

```tsx
import { LazyChartWidget } from "@/components/dashboards/widgets/LazyChartWidget";
```

Change the chart preview branch (line ~156) from `<ChartWidget widget={previewWidget} />` to:

```tsx
) : draft.kind === "chart" ? (
  <LazyChartWidget widget={previewWidget} />
```

- [ ] **Step 4: Run the guard to verify it passes (GREEN)**

Run: `pnpm test -- no-recharts-in-first-paint`
Expected: BOTH tests PASS. `DashboardWidget`'s reachable static set now stops at `LazyChartWidget.tsx` (which only statically imports `next/dynamic`); `WidgetConfigSheet` no longer statically imports `ChartWidget`.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/widgets/LazyChartWidget.tsx src/components/dashboards/DashboardWidget.tsx src/components/dashboards/WidgetConfigSheet.tsx
git commit -m "perf(dashboards): defer ChartWidget behind LazyChartWidget so recharts leaves first paint"
```

---

### Task 3: Retire the stale self-referential guard

**Files:**

- Modify: `src/components/dashboards/DashboardWidget.test.tsx` (remove the grep test ~lines 156-163 and its now-unused imports ~lines 1-2)

The old `it("does not statically import ChartWidget …")` only greps its own source — superseded by Task 1's transitive guard. Keep the lazy-path render test (it proves `LazyChartWidget` still renders through the mocked `next/dynamic`).

- [ ] **Step 1: Delete the stale test**

Remove this block from the `describe("DashboardWidget kind dispatch")` suite:

```tsx
it("does not statically import ChartWidget (recharts stays out of first paint)", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/dashboards/DashboardWidget.tsx"),
    "utf8",
  );
  expect(src).not.toMatch(/^import\s+\{\s*ChartWidget\s*\}\s+from/m);
  expect(src).toContain("dynamic(");
});
```

- [ ] **Step 2: Remove the now-unused imports**

Delete the two top-of-file lines that only that test used:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

(Leave every other import — `vi`, Testing Library, React hooks — in place; the `next/dynamic` mock and widget-body stubs are still needed for the surviving lazy-path test.)

- [ ] **Step 3: Run the suite to verify it still passes**

Run: `pnpm test -- DashboardWidget`
Expected: PASS — "renames the widget via the inline title…", "renders the chart widget through the lazy path" (now via `LazyChartWidget`), and "renders static widgets directly" all green; no unused-import lint noise.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboards/DashboardWidget.test.tsx
git commit -m "test(dashboards): drop self-referential import grep (superseded by transitive guard)"
```

---

### Task 4: Behavioral test — chart preview renders through the lazy path

**Files:**

- Create/Test: `src/components/dashboards/WidgetConfigSheet.test.tsx`

Guards the sheet wiring: opening the sheet on a chart widget mounts the chart preview via `LazyChartWidget`. Mirrors the `next/dynamic` mocking used by `DashboardWidget.test.tsx` / `FilePreviewLightbox.test.tsx`, and mocks the preview provider + mutations so no react-query/server-action machinery runs.

> If the provider/mutation mocking proves disproportionately heavy at build time (spec Risk #4), this test may be trimmed — but Task 1's guard is the non-negotiable protection.

- [ ] **Step 1: Write the test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

// Resolve next/dynamic in jsdom (same shim as DashboardWidget.test.tsx): run the
// loader in an effect and swap in the resolved component.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) =>
    function Lazy(props: Record<string, unknown>) {
      const [Comp, setComp] = useState<ComponentType<
        Record<string, unknown>
      > | null>(null);
      useEffect(() => {
        void loader().then((m) => {
          const resolved =
            typeof m === "function"
              ? (m as ComponentType<Record<string, unknown>>)
              : ((m as { ChartWidget?: ComponentType<Record<string, unknown>> })
                  .ChartWidget ?? null);
          setComp(() => resolved);
        });
      }, []);
      return Comp ? <Comp {...props} /> : null;
    },
}));

// Stub every widget body — they fetch their own data and are irrelevant here.
vi.mock("./widgets/ChartWidget", () => ({
  ChartWidget: () => <div data-testid="chart-widget" />,
}));
vi.mock("./widgets/NumberWidget", () => ({
  NumberWidget: () => <div data-testid="number-widget" />,
}));
vi.mock("./widgets/BatteryWidget", () => ({
  BatteryWidget: () => <div data-testid="battery-widget" />,
}));
vi.mock("./widgets/CompletionWidget", () => ({
  CompletionWidget: () => <div data-testid="completion-widget" />,
}));
vi.mock("./widgets/HealthWidget", () => ({
  HealthWidget: () => <div data-testid="health-widget" />,
}));
vi.mock("./widgets/ListWidget", () => ({
  ListWidget: () => <div data-testid="list-widget" />,
}));

// Keep the left-hand form + the preview data provider inert.
vi.mock("./WidgetConfigForm", async () => {
  const actual =
    await vi.importActual<typeof import("./WidgetConfigForm")>(
      "./WidgetConfigForm",
    );
  return {
    ...actual,
    WidgetConfigForm: () => <div data-testid="config-form" />,
  };
});
vi.mock("@/lib/dashboards/use-widget-preview", () => ({
  WidgetPreviewProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/lib/dashboards/use-dashboard-mutations", () => ({
  useDashboardMutations: () => ({
    addWidget: { mutate: vi.fn(), isPending: false },
    editWidget: { mutate: vi.fn(), isPending: false },
  }),
}));

import { WidgetConfigSheet } from "./WidgetConfigSheet";
import type { CacheWidget } from "@/lib/dashboards/cache";

function chartWidget(): CacheWidget {
  return {
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    kind: "chart",
    title: "My chart",
    config: {},
    source_board_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    dashboard_id: "dash1",
    org_id: "org1",
    layout: {},
    position: 0,
    created_at: "2026-07-05T00:00:00Z",
    updated_at: "2026-07-05T00:00:00Z",
  } as CacheWidget;
}

describe("WidgetConfigSheet chart preview", () => {
  it("renders the chart preview through the lazy path", async () => {
    render(
      <WidgetConfigSheet
        dashboardId="dash1"
        boards={[]}
        open
        onOpenChange={() => {}}
        editWidget={chartWidget()}
      />,
    );
    // LazyChartWidget → mocked next/dynamic → mocked ChartWidget stub.
    expect(await screen.findByTestId("chart-widget")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm test -- WidgetConfigSheet`
Expected: PASS — the sheet opens in edit mode on a chart widget; `previewCfg` is seeded from the draft on first render, so `LazyChartWidget` mounts immediately and resolves to the `chart-widget` stub.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboards/WidgetConfigSheet.test.tsx
git commit -m "test(dashboards): cover WidgetConfigSheet chart preview lazy path"
```

---

### Task 5: Full gate run

**Files:** none (verification only)

- [ ] **Step 1: Run all four gates**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all PASS. Watch specifically for:

- `typecheck` — `LazyChartWidget`'s inferred props (`{ widget: CacheWidget }`) accepted by both call sites.
- `lint` — no unused `dynamic`/`readFileSync`/`join`/`ChartWidget` imports left behind in `DashboardWidget.tsx` / `DashboardWidget.test.tsx` / `WidgetConfigSheet.tsx`.
- `test` — `no-recharts-in-first-paint`, `DashboardWidget`, `WidgetConfigSheet`, `FilePreviewLightbox` all green.
- `build` — production build succeeds (Turbopack); no `ssr:false`-in-Server-Component error (both consumers are `"use client"`).

- [ ] **Step 2: Finish the task**

Run `scripts/finish-task.sh` from the worktree (rebases onto latest `develop`, re-runs gates against the merged state, merges, pushes, removes the worktree/branch). Do not report complete until it merges cleanly.

---

## How to test (for the user)

This is **not directly user-observable** — it is a first-paint bundle optimization with identical runtime behavior. Verification is the automated suite plus an optional manual bundle check:

1. Pull `develop`. Open a dashboard (dev env) that has a **chart** widget → it still renders (staggered rise, glow, tooltip) exactly as before.
2. Open "Add a widget" / "Edit widget", pick/confirm **Chart** → the live-preview pane still shows the chart (a brief skeleton on first open of the session, then the chart).
3. Non-chart widgets and the rest of the sheet behave unchanged.
4. (Optional, the real point) In DevTools → Network, load a dashboard that has **no** chart widget and don't open the sheet: no recharts/chart chunk is fetched on first paint. The chart chunk loads on demand only when a chart first mounts.

## Self-Review notes

- **Spec coverage:** Goal 1 (break the static edge) → Task 2. Goal 2 (real boundary guard) → Task 1 (+ Task 3 retires the fake). Goal 3 (no UX regression) → shared skeleton fallback in Task 2 Step 1 + Task 4 behavioral test. Perf budget + Execution DAG → sections above. Approach-1-vs-2 decision → surfaced in the header note.
- **Placeholder scan:** none — every step carries concrete code/commands.
- **Type/name consistency:** `LazyChartWidget` (named export) used identically in Tasks 2-4; props `{ widget: CacheWidget }` consistent across `DashboardWidget`, `WidgetConfigSheet`, and both tests; guard helper names (`staticEdges`/`resolveSpec`/`reachable`) self-consistent.
