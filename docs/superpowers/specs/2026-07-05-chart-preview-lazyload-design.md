# Charts P2 perf follow-up: WidgetConfigSheet lazy-load — Design

- **Date:** 2026-07-05
- **Status:** Draft (awaiting review)
- **Author:** scoping session `task/chart-preview-lazyload`
- **Origin:** "Open threads" in `vault/sessions/2026-07-05-2018-shadcn-charts-phase1-2-expressive.md`

## Problem

Charts P2 added `recharts` plus new chart modules (`chart-colors.ts`, `ChartDefs.tsx`,
`chart-theme.ts`, `use-reduced-motion.ts`, the spectrum/categorical palettes) behind `ChartWidget`.
`DashboardWidget.tsx` already loads `ChartWidget` via `next/dynamic` (`ssr: false`, module-level)
specifically so **recharts never enters the dashboard first-paint bundle**.

That guarantee is currently **defeated by a static import path**:

```
DashboardWidget.tsx  ── static import ──►  WidgetConfigSheet.tsx  ── static import ──►  ChartWidget.tsx ──► recharts
        (line 19)                                    (line 19)
```

`WidgetConfigSheet.tsx:19` does `import { ChartWidget } from ".../widgets/ChartWidget"` for its
live-preview pane, and `DashboardWidget.tsx:19` does `import { WidgetConfigSheet } from ...`. Because
both edges are **static**, the bundler pulls the entire chart subtree (recharts + the P2 modules)
into the dashboard's first-paint client chunk. `DashboardWidget`'s own `dynamic()` is bypassed via
this side door. The chart code ships to every dashboard viewer whether or not they ever open the
"Add/Edit widget" sheet.

Second defect — **false confidence in the guard test**. `DashboardWidget.test.tsx` (~line 156)
"proves" the boundary by `readFileSync`-ing **its own source** and asserting the string
`import { ChartWidget } from` is absent and `dynamic(` is present. That only inspects
`DashboardWidget.tsx`. It says nothing about the transitive graph, so it stays green even though the
real first-paint bundle contains recharts (via `WidgetConfigSheet`). The test actively misleads.

## Goals

1. Remove `recharts` (and the P2 chart modules) from the dashboard **first-paint** client bundle by
   breaking the static import edge to `ChartWidget` inside the config-sheet preview.
2. Replace the self-referential guard with a test that asserts the **real, transitive** import
   boundary — one that would have caught this regression and will catch the next intermediary.
3. No visible UX regression in the config-sheet live preview (no layout shift; brief one-time
   skeleton is acceptable).

## Non-goals

- Lazy-loading the whole `WidgetConfigSheet` from `DashboardWidget` (the form + `WidgetConfigForm`
  are not first-paint-heavy without recharts). Noted as a possible later optimization; out of scope.
- Any change to chart rendering, colors, motion, or the preview data-fetch pipeline
  (`WidgetPreviewProvider` / `useWidgetSeries`) — untouched.
- Converting other widget kinds to dynamic. Only `ChartWidget` carries the heavy dependency.
- A `next build` bundle-size assertion in CI (see Approaches → rejected B).

## Current behavior (verified in-worktree)

- `src/components/dashboards/DashboardWidget.tsx` — `"use client"`. Renders the on-grid widget.
  Lines 30-41: `const ChartWidget = dynamic(() => import(".../ChartWidget").then(m => m.ChartWidget),
{ ssr: false, loading: () => <div className="bg-muted/40 h-full animate-pulse rounded-md" /> })`.
  Line 19: **static** `import { WidgetConfigSheet }`. Renders `<WidgetConfigSheet .../>` at line 160.
- `src/components/dashboards/WidgetConfigSheet.tsx` — `"use client"`. Line 19: **static**
  `import { ChartWidget }`. Used at line 156 inside the "Live preview" pane (fixed `h-64` container),
  gated on `draft.kind === "chart"`, wrapped in `WidgetPreviewProvider`.
- `ChartWidget.tsx` — `"use client"`; top-level `import { ... } from "recharts"` + the P2 modules.
- Reference pattern already in the repo: `FilePreviewLightbox.tsx:23` dynamic-imports `PdfPreview`
  (`pdfjs-dist`) the same way; its test mocks `next/dynamic` (`FilePreviewLightbox.test.tsx:6`).
- No barrel (`widgets/index.*`) exists; both consumers import `ChartWidget` by direct path today.
- Tests: Vitest, `jsdom`, `globals: true`, project `unit` globs `src/**/*.{test,spec}.{ts,tsx}`.
  `tsconfig` maps `@/*` → `./src/*`.

## Approaches considered

### Approach 1 — Shared `LazyChartWidget` module (recommended)

Extract the `dynamic(() => import(ChartWidget))` wrapper into one tiny client module
`src/components/dashboards/widgets/LazyChartWidget.tsx` that statically imports only `next/dynamic`
and exports the dynamic-wrapped component (with the shared `ssr:false` + pulse-skeleton `loading`).
Both `DashboardWidget` and `WidgetConfigSheet` import **this** module statically and render
`<LazyChartWidget widget={…} />`.

- **Why it breaks the edge:** `LazyChartWidget.tsx` never statically imports `ChartWidget` — the
  reference is inside `dynamic(() => import(...))`, a deferred edge. Any static import _of the
  wrapper_ is recharts-free.
- **Pros:** single source of truth for the boundary + loading skeleton; removes the current
  duplication (the same `dynamic()` block would otherwise live in two files and could drift); makes
  the invariant structurally obvious; future intermediaries that render a chart preview reuse it and
  stay safe by construction.
- **Cons:** one new (small) file; touches `DashboardWidget.tsx` too (swap its inline `dynamic()` for
  an import of the shared wrapper) — a slightly wider diff than strictly required.

### Approach 2 — Inline `dynamic()` in `WidgetConfigSheet` (minimal diff)

Mirror `DashboardWidget` exactly: in `WidgetConfigSheet.tsx`, replace the static
`import { ChartWidget }` with a module-level `const ChartWidget = dynamic(() => import(...).then(m =>
m.ChartWidget), { ssr:false, loading: … })`. Leave `DashboardWidget` untouched.

- **Pros:** smallest possible change; matches the existing `FilePreviewLightbox`/`DashboardWidget`
  idiom line-for-line; lowest regression risk.
- **Cons:** duplicates the `dynamic()` wrapper + skeleton in two files; the two can drift; the
  boundary is implicit in each consumer rather than named once.

### Approach 3 — dependency-cruiser / madge lint rule (rejected)

Add a graph-analysis dev tool with a rule "DashboardWidget must not statically depend on
recharts/ChartWidget."

- **Rejected:** neither tool is in the repo; adds a dependency + config surface for a single rule.
  The same guarantee is achievable with a dependency-free ~40-line test (see Testing).

### Rejected B — `next build` + chunk grep

Build and assert recharts is absent from the dashboard route's first-paint chunk.

- **Rejected as the guard:** slow, brittle to chunking strategy, hard to attribute a chunk to
  "first paint," and lives outside the fast unit gate. It is the ultimate ground truth but too heavy
  for a regression tripwire; the `build` gate still runs for general correctness.

**Recommendation: Approach 1.** It fixes the bug, DRYs the duplicated wrapper, and turns the
boundary into a named unit that the guard test can point at. Approach 2 is the acceptable low-risk
fallback if the reviewer prefers a minimal diff — the guard test (below) is identical either way and
protects both. **This is the one open decision for the reviewer.**

## Design (Approach 1)

### Unit: `LazyChartWidget` (new)

`src/components/dashboards/widgets/LazyChartWidget.tsx`

- **Purpose:** the single deferred entry point to `ChartWidget`, so no first-paint code statically
  pulls recharts.
- **Interface:** `export const LazyChartWidget: (props: { widget: CacheWidget }) => JSX.Element` —
  same call shape as `ChartWidget`. (Named export; consumers render `<LazyChartWidget widget={…} />`.)
- **Body:** `"use client"`; `import dynamic from "next/dynamic"`;
  `const LazyChartWidget = dynamic(() => import("./ChartWidget").then(m => m.ChartWidget), { ssr:
false, loading: () => <div className="bg-muted/40 h-full animate-pulse rounded-md" /> })`.
- **Depends on:** `next/dynamic` (static, bare) and — only at runtime, via the deferred `import()` —
  `./ChartWidget`. No static edge to recharts.
- **Loading fallback:** identical skeleton to `DashboardWidget`'s current one and to `ChartWidget`'s
  own `isLoading` branch, so there is no layout shift (the `h-64` preview shell / grid cell owns
  sizing).

### Consumers

- `DashboardWidget.tsx` — delete the inline `const ChartWidget = dynamic(...)` block (lines ~25-41);
  add `import { LazyChartWidget } from ".../widgets/LazyChartWidget"`; render `<LazyChartWidget />`
  where it rendered `<ChartWidget />` (line ~144). Behavior identical.
- `WidgetConfigSheet.tsx` — replace `import { ChartWidget }` (line 19) with
  `import { LazyChartWidget } from ".../widgets/LazyChartWidget"`; render `<LazyChartWidget />` in the
  preview branch (line ~156). The other widget imports (Number/Battery/Completion/Health/List) stay
  static — none pulls recharts.

### Data flow / UX

Unchanged. The preview still: debounces `draft.config` → `previewCfg` (400 ms), wraps the chart in
`WidgetPreviewProvider` (one draft-scoped preview fetch via `useWidgetSeries`), and renders inside
the fixed `h-64` card. The only new behavior: the **first** time a chart preview mounts in a
session, the browser fetches the chart chunk on demand → the pulse skeleton shows for a few hundred
ms → the chart appears. The chunk is cached thereafter, so subsequent kind-switches to "chart" are
instant. This overlaps the existing 400 ms debounce and mirrors `ChartWidget`'s own load skeleton —
no perceptible jank, no layout shift.

## Performance & data-fetching budget (working-agreement #5)

This change is a **first-paint client-bundle** optimization; it does not touch data fetching.

- **First paint (dashboard route):** recharts (~35 KB gz per the in-code comment) **plus** the P2
  chart modules (`chart-colors`, `ChartDefs`, `chart-theme`, `use-reduced-motion`, palettes) **leave**
  the first-paint chunk. They move into an on-demand chunk fetched only when a chart actually mounts
  — i.e., a dashboard that has a chart widget on the grid, or the user opens the config sheet and
  selects/edits a chart. A dashboard with no charts and an unopened sheet ships **zero** chart code.
- **Interactions:** **0 new server round-trips** introduced. Opening the sheet, typing, switching
  kind — all client-state driven exactly as today. The preview's single draft-scoped fetch
  (pre-existing) is unchanged.
- **Server-data mutations:** none added. Add/Save widget still go through the existing Server
  Actions (`useDashboardMutations`), untouched.
- **Bounded/indexed reads:** N/A — no list/board read is added or altered.

Net: strictly less first-paint JS, same runtime behavior, same data path.

## Parallelization / independent units (working-agreement #6)

Single cohesive change across three files plus one guard test — **one unit of work, no internal
concurrency**. Full Execution DAG (trivially one node) is in the implementation plan.

## Testing strategy

Two layers; the first is the real protection.

### 1. Transitive static-import boundary guard (the fix for the false-confidence test)

New dependency-free test `src/components/dashboards/no-recharts-in-first-paint.test.ts` (pure Node —
no jsdom/React). It builds the **static** import graph from `DashboardWidget.tsx` and asserts the
chart subtree is unreachable:

- Parse a file's **static** edges only: `import ... from "x"`, bare `import "x"`, and
  `export ... from "x"` (re-exports). A `dynamic(() => import("x"))` / bare `import("x")` is a _call_
  with no `from` clause, so it is **naturally excluded** — that is exactly the deferred edge we want
  to stop following.
- Resolve `@/…` → `src/…` and relative specifiers against the importing file; try
  `.tsx`/`.ts`/`/index.tsx`/`/index.ts`. Follow only first-party files (`@/` or `.`); stop at bare
  node_modules specifiers (record them, don't recurse). Track a visited set (cycle-safe).
- **Assertions:** starting from `DashboardWidget.tsx`, the reachable first-party set (a) does **not**
  contain `widgets/ChartWidget.tsx`, and (b) contains **no** file whose static edges include
  `"recharts"`. With today's code this test **FAILS** (ChartWidget reachable via
  `WidgetConfigSheet`) — it is the RED that drives the fix; it goes GREEN once the edge is deferred.
- Rationale for source-graph over bundle analysis: fast, runs in the existing unit gate, precisely
  expresses "no static path from first-paint code to recharts," and catches **any** future
  intermediary (not just these two files).

Root choice: `DashboardWidget.tsx` is the meaningful first-paint root — it both renders on-grid
charts (deferred) and hosts the config sheet. Rooting there scopes the assertion to the widget
subtree without dragging in unrelated route modules.

### 2. Behavioral coverage of the changed files

- **Keep** the existing `DashboardWidget.test.tsx` "renders the chart widget through the lazy path"
  test (it mocks `next/dynamic` and asserts the chart testid appears) — proves the dynamic wrapper
  still renders after the refactor. **Remove** the old self-referential grep assertion (~line 156);
  it is superseded by test #1.
- **Add** a focused `WidgetConfigSheet` preview test asserting that with `draft.kind === "chart"` the
  (mocked) chart preview renders through the lazy path — mirrors the `DashboardWidget`/
  `FilePreviewLightbox` mocking approach (`vi.mock("next/dynamic")`, stub widget bodies, mock
  `useDashboardMutations` + `WidgetPreviewProvider`/preview action). This guards the sheet wiring
  and would catch a revert to a static import even if someone deleted test #1. _(If the provider/
  mutation mocking proves disproportionately heavy, test #1 is the must-have and this may be trimmed
  to a smoke assertion — flagged for the plan.)_

### Gates (all must pass — working-agreement #4)

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Risks & open questions

1. **Approach 1 vs 2 (the one real decision).** Shared `LazyChartWidget` module (DRY, named
   boundary, wider diff incl. `DashboardWidget`) vs. minimal inline `dynamic()` in `WidgetConfigSheet`
   only. Recommend #1; #2 is the low-risk fallback. Guard test is identical either way.
2. **Import-graph parser robustness.** A regex-based static-edge extractor is adequate for this
   controlled codebase (top-level `import … from`, dynamic edges use `import(`). Multi-line imports
   and `export … from` re-exports must be handled; string-literal specifiers only. If a future file
   uses exotic import syntax the walker could miss an edge — acceptable for a tripwire; the `build`
   gate is the backstop. (TypeScript-compiler-API parsing is the heavier, fully-robust alternative;
   not warranted here.)
3. **`ssr: false` in the preview.** The config sheet is entirely client-driven (opens on
   interaction), so `ssr: false` — matching `DashboardWidget` — is correct and permitted (both files
   are `"use client"`). Per Next 16 docs, `ssr:false` is Client-Component-only; satisfied.
4. **Sheet test setup cost.** `WidgetConfigSheet` pulls `useDashboardMutations` +
   `WidgetPreviewProvider` (react-query + a server action). If mocking is disproportionate, the plan
   should down-scope test #2 (guard #1 remains mandatory).
