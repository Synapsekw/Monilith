---
type: session
date: 2026-06-18-0818
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-17-2155-dashboards-d3a-list-widget]]"
  - "[[2026-06-17-dashboards-cross-board-design]]"
  - "[[2026-06-19-1644-dashboard-rename-and-perf]]"
---

# Dashboards D3b — List-widget multi-condition filter

## What changed

- Shipped **Phase 8 slice D3b** (13 commits `493e77d..40684d4`, pushed): a flat AND/OR
  multi-condition **filter** on the List widget. **Closes the dashboards widget subsystem**
  (Number, Chart, Battery, List + filter).
- **New `dashboard_list_rows` RPC** (`SECURITY DEFINER`, `search_path=''`, membership-checked →
  42501): per-condition `EXISTS(cell_values)` predicates joined by combinator, **LIMIT applied after
  filtering**; injection-safe `format(%L)` + numeric/date regex guards (bad value → no match, not
  error). Helper `_dashboard_list_predicate` isolates predicate-building.
- `getWidgetRows` swaps its first query for the RPC (cells query unchanged). Filter Zod schema
  (`listFilterSchema`), `filter-meta` operators-per-kind helper, `FilterBuilder` UI, add-widget
  wiring (columns now carry `options`), and a per-widget **List config editor** (Edit menu).
- Built subagent-driven: 9 tasks, fresh implementer + two-stage review each (one file per agent →
  heeded [[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]]). Reviews caught a
  real stale-config-on-reopen bug in the editor (fixed: form remounts on open).
- Gate green: typecheck, lint (0 err), **404/404 tests**, build; **e2e 4/4** (ran locally — new
  filtered-list case green). Both new functions verified to pin `search_path` (advisor parity).

## Why

D3a landed the List widget read-only; D3b makes it filterable, the last piece to close the
dashboards subsystem. The filter targets EAV `cell_values`, so it had to run in Postgres (RPC) to
stay bounded+indexed under the working-agreement data-fetching budget — not JS-side over fetched rows.

## Open threads

- **Two benign semantic notes** (from final holistic review, Ship verdict): (1) `is_empty` matches
  only items with NO `cell_values` row — a blank-but-present cell displays empty but won't match;
  (2) the AND/OR toggle hides below 2 conditions, so a set `or` persists invisibly with 1 condition
  (harmless no-op). Tooltip/follow-up if users hit either.
- **Deferred (lean tier):** dropdown/people value-matching (empties only); nested groups; relative
  dates; Numbers `between`; `is one of`. Also still open from D-series: People name/avatar rendering.
- **Not yet user-verified in the app** — D1+D2+D3a+D3b pass tests/e2e but no visual eyeball yet.
- Minor DRY: `optionSchema.array().safeParse(...)` idiom now in 3 files — could extract `parseOptions`.

## Next session entry point

Dashboards subsystem is closed. Next: **user-verify the four widget types + filter** in the live
app, then **light-mode reskin** (RS pending) or **Phase 5 (Automations)**. Templates + ⌘K polish
remain in Phase 8.
