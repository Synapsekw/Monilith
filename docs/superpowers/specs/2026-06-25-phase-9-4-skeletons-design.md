# Phase 9.4 — Skeletons (content-shaped loading states) — design

**Status:** approved design — ready for plan.
**Date:** 2026-06-25
**Parent:** `docs/superpowers/specs/2026-06-22-phase-9-performance-optimization-design.md` (Phase 9 umbrella, §9.4 Track B / perceived speed).
**Slice:** the **skeletons** portion of 9.4 only — content-shaped `loading.tsx` for the remaining hot route segments, plus the reusable per-section skeleton components they compose. The other 9.4 bullets (mutation pending states, optimistic-UI audit, intent-based prefetch, in-page-toggle audit, async-media CLS) are **deferred** to follow-up slices — see "Out of scope" below.

## Motivation

Phase 9.2 (streaming shell / PPR, already shipped) established the perceived-speed foundation: the `<Skeleton>` primitive (`src/components/ui/skeleton.tsx`), two shell-region fallbacks (`SidebarNavSkeleton`, `HeaderUserSkeleton`) behind `<Suspense>` in `src/components/shell/authenticated-shell.tsx`, and **one** page-content fallback — `src/app/(app)/boards/[boardId]/loading.tsx`.

Every other authenticated section still has **no `loading.tsx`**, so on navigation the layout (sidebar + header) stays mounted but the content area is blank until the per-request RSC data resolves. That blank moment is the perceived-speed gap. 9.4 closes it by giving each hot segment a **content-shaped** skeleton — one that mirrors the final layout closely enough that when real data swaps in there is **zero layout shift** (the Phase-9 budget: CLS < 0.1).

## The core realisation

A `loading.tsx` in Next 16 is a Server Component that Next automatically wraps around the segment's `page.tsx` (and nested layouts/not-found) in a `<Suspense>` boundary — it shows instantly on navigation and is swapped out when the page finishes streaming (confirmed against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`). So these skeletons are **pure static markup, zero data fetch, no client JS** — exactly the cheap, instant feedback the budget wants. And because the same markup is what a `<Suspense fallback>` renders, each per-section skeleton **doubles as the 9.2 streaming-shell fallback** (the umbrella spec's "These double as the 9.2 Suspense fallbacks").

The design discipline is therefore not "draw a spinner" but **mirror the real component's outer scaffold**: same root wrapper (`flex h-full flex-col`), same toolbar/header bar (`border-b px-N py-N`, same height), same table/grid container (`min-h-0 flex-1 overflow-auto`), same row/cell rhythm — then fill the _content_ slots with `<Skeleton>` blocks at the real heights. Match the **structure that owns the layout box**, not every pixel of the content.

## Route coverage (6 new `loading.tsx`)

All under `src/app/(app)/`. The real layout shape for each was read from the live components (see "Layout evidence" below).

| #   | Segment                    | `loading.tsx` path                     | Mirrors                                                     | New skeleton component                                          |
| --- | -------------------------- | -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `dashboards/[dashboardId]` | `dashboards/[dashboardId]/loading.tsx` | `DashboardCanvas` — toolbar + react-grid-layout widget grid | `DashboardWidgetSkeleton` (+ `DashboardCanvasSkeleton` wrapper) |
| 2   | `goals`                    | `goals/loading.tsx`                    | `GoalTree` — header bar + sticky-header tree table          | `GoalTreeSkeleton`                                              |
| 3   | `portfolios/[portfolioId]` | `portfolios/[portfolioId]/loading.tsx` | `PortfolioGrid` — title bar + 9-col table                   | `PortfolioGridSkeleton`                                         |
| 4   | `settings`                 | `settings/loading.tsx`                 | settings page — centered max-w-3xl stack of Cards           | (inline; reuses `Card`)                                         |
| 5   | `time`                     | `time/loading.tsx`                     | `TimeCard` — toolbar + frozen-left week grid                | `TimeCardSkeleton`                                              |
| 6   | `workload`                 | `workload/loading.tsx`                 | `WorkloadGrid` — filter toolbar + frozen-left week grid     | `WorkloadGridSkeleton`                                          |

**Index/list pages are out of scope for this slice.** `dashboards/page.tsx` is a redirect (no visible content), and `portfolios/page.tsx` is a tiny `max-w-3xl` list that resolves fast; a parent `dashboards/loading.tsx` would also briefly flash before the redirect. We scope to the six **data-heavy detail/main segments** named in the umbrella spec. If we later want the list pages covered, they are trivial follow-ups.

## Per-section skeleton components

Each reusable skeleton lives **next to its feature** (mirrors where `SidebarNavSkeleton` sits beside the shell), is a Server Component, and is composed from the shared `<Skeleton>`. The `loading.tsx` files are thin: they render the skeleton component (and any page-level chrome the component doesn't own). Putting the body in a named component — not inline in `loading.tsx` — is what lets 9.2 import the _same_ markup as a `<Suspense fallback>`.

- `src/components/dashboards/DashboardCanvasSkeleton.tsx` → exports `DashboardWidgetSkeleton` (single card chrome: `rounded-xl border`, header row `border-b px-3 py-2`, body `flex-1 p-3`) and `DashboardCanvasSkeleton` (root `flex flex-col gap-3 p-4`, toolbar row, then a static grid of 4–6 widget cards at representative spans).
- `src/components/goals/GoalTreeSkeleton.tsx` → root `flex h-full flex-col`, header bar `border-b px-6 py-3` (title + button placeholder), then a `min-h-0 flex-1 overflow-auto` table scaffold with a sticky `thead` of 4 columns (Goal / Progress / Status / Owner) and ~8 placeholder rows at row height `py-2`, first column indented like the tree.
- `src/components/portfolios/PortfolioGridSkeleton.tsx` → root `flex h-full flex-col`, title bar `border-b px-4 py-3`, scroll container, 9-column sticky header + ~8 rows (`px-3 py-2`).
- `src/components/time/TimeCardSkeleton.tsx` → root `flex h-full flex-col`, toolbar `border-b px-4 py-3` (title + week-nav placeholders), frozen-left grid: `w-64` label column + 7 day columns (`min-w-20`) + totals column, ~6 rows + a footer total row.
- `src/components/workload/WorkloadGridSkeleton.tsx` → root `flex h-full flex-col`, filter toolbar `border-b px-4 py-3` (several pill-group placeholders), frozen-left grid: `w-56` member column + ~12 week columns (`min-w-24`), ~6 rows.
- **Settings** has no heavy single component — its `loading.tsx` reuses the real page's `mx-auto max-w-3xl px-6 py-10` wrapper, the `<Card>` primitive, and `<Skeleton>` blocks for the three card bodies. No separate exported component (nothing else consumes it).

### Naming / a11y contract (shared by all six)

The root element of every page skeleton carries the **same a11y contract already used by the shell skeletons** (`role="status"` + `aria-busy="true"` + `aria-label="Loading <thing>"`), so screen readers announce a busy region and the swap is graceful. The existing board `loading.tsx` uses only `aria-busy`/`aria-label`; this slice standardises on `role="status"` too (matching `SidebarNavSkeleton`/`HeaderUserSkeleton`) and — optionally, low-risk — adds `role="status"` to the board loader for consistency. Inner `<Skeleton>` blocks need no individual ARIA (they are decorative within the labelled status region).

## Approaches considered

**A — Inline skeleton markup in each `loading.tsx` (like the current board loader).** Simplest, fewest files. Rejected as the primary pattern: 9.2 needs to import the _same_ markup as a `<Suspense fallback>`, and inline-in-`loading.tsx` can't be imported. Also duplicates the layout contract.

**B — One reusable skeleton component per section, `loading.tsx` is a thin wrapper (CHOSEN).** Each skeleton is a named, importable Server Component beside its feature; `loading.tsx` renders it. This is the only approach that satisfies "these double as the 9.2 Suspense fallbacks", keeps the layout contract in one place, and is independently testable. Settings is the one exception (inline) because no other consumer exists.

**C — A single generic `<PageSkeleton variant="grid|table|cards" />`.** Most DRY, but a generic skeleton can't mirror six _different_ layouts tightly enough for CLS < 0.1 (frozen columns, widget grid, tree indentation all differ). Over-abstraction that fights the zero-layout-shift goal. Rejected.

## Performance & data-fetching budget (AGENTS.md rule #5)

- **First paint vs. interaction:** these components render **only on the loading frame** of an RSC navigation; they perform **0 data fetches, 0 server round-trips, 0 client JS** (pure static Server Components built from `<Skeleton>`). They never re-render on interaction — they are gone the moment `page.tsx` streams in.
- **Server data change?** No. Skeletons are static markup; nothing here mutates or reads server data. No Server Actions, no `use cache`, no History API involvement.
- **Bounded hot-path read?** N/A (no read). The placeholder row/card counts are small fixed constants (~6–8) — bounded by construction, no growing list.
- **Net effect on the budget:** directly serves **CLS < 0.1** (final layout reserved before data) and **LCP** (structured paint immediately on nav). No bytes added to the critical client bundle (server-rendered static HTML).

## Zero-layout-shift strategy

CLS comes from the _outer box_ moving, not from inner content being approximate. So the rule is: **the skeleton's layout-owning ancestors must match the real component's** — identical root wrapper, identical toolbar height, identical table container, identical column widths for frozen-column grids (`w-64`/`w-56`), identical row padding (`py-2`/`py-1.5`). Inner skeleton blocks can be approximate (a `<Skeleton>` where text/chart goes) as long as they don't change the row/cell box height. Tests assert the **class contract on the root + toolbar + container** rather than pixel-measuring (jsdom has no layout) — the contract _is_ the CLS guarantee. A manual Lighthouse/devtools CLS check on each route is the human acceptance step (and is formally enforced later in 9.6).

## Testing strategy (AGENTS.md rule #4)

Stack already present: Vitest (`unit` project, jsdom) + `@testing-library/react` (see `src/components/app-shell.test.tsx`). Each skeleton component gets a co-located `*.test.tsx`:

1. **Renders without crashing** and exposes the a11y contract — `getByRole("status")`, `aria-busy="true"`, an `aria-label` starting "Loading".
2. **Structural mirror** — asserts the presence and count of the layout-owning pieces: a toolbar/header element, the scroll container, and the expected number of placeholder rows/cards/columns (query by a stable `data-testid` or by `role`/class).
3. **Stable-height / CLS contract** — assert the root element carries the same layout-defining classes as the real component's outer wrapper (e.g. `flex h-full flex-col`; frozen-column skeletons assert the `w-64`/`w-56` label-column width and `min-w-*` day/week columns). This is the lint-level guard that the box won't shift.

A11y note: because a `loading.tsx` itself takes no props and is trivial, the **component** is the unit under test; the `loading.tsx` wrappers are covered by `pnpm build` (Next compiles/type-checks them) and the typecheck gate, not by a separate render test each.

Gates (all must pass before merge): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Independent units (for the plan's Execution DAG — AGENTS.md rule #6)

The six route skeletons share **no state and no sequential dependency** on each other — each is a self-contained file pair (skeleton component + `loading.tsx`) touching a distinct folder. The only shared input is the already-shipped `<Skeleton>` primitive (read-only). Therefore all six are **independent units** that can be built as parallel agents in one batch (isolated worktrees per AGENTS.md #1/#6, or co-located since each touches a disjoint folder). The only non-parallel work is an optional final consistency pass (standardise `role="status"`, cross-check a11y labels) which depends on all six landing.

This whole slice is **disjoint from the parallel 9.3 cache task**: 9.3 touches `src/lib/**` data fetchers; 9.4-skeletons touches `src/app/**/loading.tsx` + `src/components/**/*Skeleton.tsx`. No file overlap → they run concurrently without coordination.

## Layout evidence (read from live components)

- **DashboardCanvas:** root `flex flex-col gap-3 p-4`; toolbar `flex items-center justify-between`; grid `rowHeight=80`, `margin=[12,12]`, `cols.lg=12`; default widget `w:3 h:2`. Widget card: `bg-card flex h-full flex-col overflow-hidden rounded-xl border`, header `flex items-center justify-between border-b px-3 py-2`, body `min-h-0 flex-1 p-3`.
- **GoalTree:** root `flex h-full flex-col`; toolbar `flex items-center gap-1.5 border-b px-4 py-2` (note: the _page_ adds its own header `border-b px-6 py-3` with title + `NewGoalDialog`); table `w-full text-sm`, sticky `thead` 4 cols, rows `border-t` cells `px-3 py-2`, indent `depth*20px`.
- **PortfolioGrid:** root `flex h-full flex-col`; the _page_ renders a title bar `border-b px-4 py-3`; grid toolbar `flex items-center justify-between gap-3 border-b px-4 py-2`; table 9 cols, sticky header, rows `px-3 py-2`.
- **TimeCard:** root `flex h-full flex-col`; toolbar `border-b px-4 py-3`; table `border-separate border-spacing-0`; frozen left col `sticky left-0 w-64 min-w-64 border-r`, 7 day cols `min-w-20`, totals col, `tfoot` total row; rows ~`py-1.5`.
- **WorkloadGrid:** root `flex h-full flex-col`; toolbar `border-b px-4 py-3` with filter/metric/sort pill groups; frozen left col `sticky left-0 w-56 min-w-56 border-r`, week cols `min-w-24` (count from `weeksBack`/`weeksFwd`), rows `py-2`.
- **Settings page:** `mx-auto max-w-3xl px-6 py-10`; title block; three stacked `<Card>`s (Preferences, Organization, Members) with header + body.

## Out of scope (this slice — deferred 9.4 items)

These are named in the umbrella §9.4 but are **separate concerns** and explicitly NOT in this slice:

- **Mutation pending states** (`useTransition`/form-pending on buttons) — touches interactive client components, not loading frames.
- **Optimistic-UI audit** — review of existing mutations; orthogonal.
- **Intent-based prefetch** (`<Link>` prefetch on hover/viewport) — sidebar/board-row nav behavior; separate.
- **In-page-toggle audit** (gotcha-09 regression sweep) — verification task over existing client state.
- **Async-media CLS** (reserving space for avatars/images/streamed regions) — broader than the loading-frame skeletons; folds into 9.6 measurement.
- **Index/list-page skeletons** (`dashboards`, `portfolios` lists) — redirect / trivially-fast pages; cheap follow-ups if wanted.
- **Lighthouse/Web-Vitals CLS enforcement** — that is Phase 9.6's job; here we satisfy the CLS _strategy_, 9.6 _measures_ it.

## Risks & decisions

- **Risk — skeleton drifts from real layout over time** (component changes, skeleton doesn't → CLS regression). Mitigation: the structural/stable-height tests assert the shared class contract; a future component-shape change that breaks the box will fail the test. Long-term enforcement is 9.6's CLS budget.
- **Decision — mirror the layout-owning scaffold, not every pixel.** Inner content can be approximate; the outer box must match. This is what makes CLS < 0.1 achievable without re-implementing each component.
- **Decision — one importable skeleton component per section** (approach B), so 9.2 can reuse them as `<Suspense>` fallbacks; settings is the lone inline exception.
- **Decision — standardise the a11y contract** (`role="status"` + `aria-busy` + `aria-label`) across all skeletons, matching the shell fallbacks.
