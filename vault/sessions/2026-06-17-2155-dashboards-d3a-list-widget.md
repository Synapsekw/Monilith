---
type: session
date: 2026-06-17-2155
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  [
    "[[2026-06-17-2119-dashboards-d2-chart-battery]]",
    "[[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]]",
  ]
---

# Dashboards D3a — List widget (rows + columns)

## What changed

- Shipped **Phase 8 slice D3a** (7 commits `ab1a5d4..3a6d0dd`, pushed): the **List** widget —
  bounded latest-N items of a source board shown as a compact table (item name + chosen columns;
  Status as a colored pill, Number/Date/Text, People as a count).
- **No DB/RPC change.** New `getWidgetRows` Server Action does RLS-scoped bounded selects (items
  `LIMIT N` over indexed `board_id`; `cell_values`/`columns` via `.in(...)` the chosen ids). Pure
  `formatCell` helper + `listConfigSchema` (columnIds ≤ 8, limit 1–100 default 25). `ListWidget` +
  `useWidgetRows` hook; add-widget dialog gained a List option (column multi-select + max-rows); the
  page loader now issues one all-columns query feeding `BoardOption.allColumns`.
- Verified (independently re-run): typecheck/lint clean, **378 unit tests**, build, **e2e 3/3**
  (Number/Chart/List). Code review verdict ready-to-merge (getWidgetRows RLS-scoped + bounded;
  0-refetch budget intact — list rows keyed `["dashboard-widget-rows", id, configHash]`).
- D3 was **split**: D3a (this, list+columns, no filter) and **D3b** (multi-condition filter, next).
  Plan: `docs/superpowers/plans/2026-06-17-dashboards-d3a-list-widget.md`.

## Why

D3a delivers the useful List widget cheaply (read-only, no schema change) and de-risks D3b by landing
the filter engine on a working list rather than all at once. Completes 3 of 4 dashboard widget types.

## Open threads

- **D3b — multi-condition filter** is all that remains to close the dashboards subsystem: AND/OR
  conditions over EAV `cell_values` (server-side translation, bounded+indexed) + a filter-builder UI.
- **Process gotcha:** a subagent overstepped its assigned task scope (did T6/T7 when scoped to T4/T5)
  while a separate T6 agent ran on the same file in this one checkout — see
  [[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]]. No harm landed (tree clean,
  all green), but a real collision risk.
- D1+D2+D3a not yet **user-verified in the app** (e2e + build pass; visual eyeball pending).
- Deferred (D3a scope): People name/avatar rendering (count only), per-widget config editing.

## Next session entry point

Build **D3b (multi-condition filter)** — write the thin plan off the subsystem spec, then
subagent-driven (one agent per file, confirm each is idle before dispatching the next). Or
user-verify the four widget types first.
