---
type: session
date: 2026-06-23-1953
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-17-2048-dashboards-d1-foundation]]"
  - "[[2026-06-17-2119-dashboards-d2-chart-battery]]"
  - "[[2026-06-18-0818-dashboards-d3b-list-filter]]"
---

# Dashboards Polish (v2)

## What changed

- Brainstorm → spec → plan → build for a polish pass on the Phase-8 dashboards subsystem. Spec `docs/superpowers/specs/2026-06-23-dashboards-polish-v2-design.md`; plan `docs/superpowers/plans/2026-06-23-dashboards-polish-v2.md`. Built subagent-driven on `task/dash-polish-v2`, merged to `develop` (`ef2908f`).
- **Data layer:** new `dashboard_series` RPC (migration `20260623120000`) — date-bucket + multi-series aggregation, top-K/`__other__` folding, last-N for dates, dropdown/people array-unnest; v2 `chartConfigSchema` (9 chart types, primary/series dims, measure, comboMap) + `normalizeChartConfig` back-compat mapper; `getWidgetSeries` action, `useWidgetSeries` hook, `pivotSeries` helper. Types regenerated (also fixed a latent `percent` column-kind drift).
- **Charts + reskin:** `ChartWidget` rewritten to render bar/stacked/grouped/line/area/combo/pie/donut/radial via recharts; Number widget gauge mode + gradient numeral; bordered-card shell + accent-dot header across all widgets.
- **Edit drawer:** unified `WidgetConfigForm` + right-side `WidgetConfigSheet` with debounced live preview; every widget kind now editable; removed `AddWidgetDialog` + `EditListWidgetDialog`.
- Decisions: Number/Battery keep `dashboard_aggregate` (Number ungrouped, Battery status-distribution); `dashboard_series` powers Chart only — so `dashboard_aggregate` was NOT retired (spec D5 superseded). Multi-assignee = count-per-assignee. Whole feature merged as one unit (T1 alone would break chart creation in the old UI).
- **Follow-up fix** (`3fd2c4b`, branch `task/dash-chart-measure-fix`): the config drawer let you pick Measure = Sum/Average without a number column, so saving was rejected with "Sum and average need a numbers column." (a save-time Zod refine, surfaced as a broken chart). Fixed in `WidgetConfigForm`: switching to sum/avg auto-selects the first number column, and sum/avg are only offered when the board has one (else a hint). Same trap fixed in the Number widget metric. +3 tests.

## Why

The dashboards subsystem shipped in Phase 8 but was never visually verified and had three gaps: plain widgets, add-only (uneditable) chart/number/battery widgets, and only bar/pie over a single status column. This pass makes widgets appealing, every widget editable via one drawer, and adds a real chart catalog over a generalized aggregation layer — the depth a "Work OS" dashboard needs.

## How to test (for the user)

1. Pull `develop`, run `pnpm dev`, open a dashboard at `/dashboards/[id]`.
2. Legacy check: existing bar/pie widgets render unchanged in the new card style (back-compat via `normalizeChartConfig`).
3. Edit → Add widget opens the right-side drawer; build a Combo (bar + line) with primary = Date/month; save; confirm it renders.
4. Add a Stacked bar grouped by Status, split-series by People; confirm assignees stack (each counted once).
5. ⋯ menu on a Number widget → Edit → Display = Gauge + a target; live preview updates (~400ms debounce); Save.
6. Add Donut / Line / Radial; confirm colors match the board's status pills.
7. Drag/resize widgets; confirm no widget data refetch (Network panel).

## Open threads

- New-widget inline live preview not implemented (preview is post-first-save for adds; documented stretch).
- Battery/Number grouping by dropdown/people deferred; advanced filter operators (`between`, relative dates, etc.) still deferred.
- Two code-quality reviewer subagents stalled mid-run during the build; reviews were completed inline/re-dispatched — no impact on output, but worth noting agent-watchdog flakiness.
- Not yet promoted to `main` (part of the pending `develop` bundle).

## Next session entry point

Run `/promote` to ship the `develop` bundle (includes dashboards v2 + feedback + sidebar reorder), then resume Phase 9.3 cache + 9.4 skeletons.
