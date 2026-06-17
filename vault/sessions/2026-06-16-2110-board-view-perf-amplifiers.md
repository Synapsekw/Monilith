---
type: session
date: 2026-06-16-2110
branch: develop
trigger: wrapup
status: complete
tags: [session, performance]
related: ["[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"]
---

# Board view performance: quick win + deferred amplifiers

## What changed

- Diagnosed board/kanban switch slowness: every `?view=` switch was a full RSC nav (~10 Supabase queries) + view remount, despite a shared `staleTime:Infinity` cache.
- Quick win (`609227e`): client-side view switching via `window.history.pushState` in `ViewSwitcher` + new `BoardViews` client router reading `useSearchParams` — zero server round-trips per switch.
- Wrote + executed `docs/superpowers/plans/2026-06-16-board-view-perf-amplifiers.md` (subagent-driven, re-baselined mid-run for Phase 3b): shared `buildCellMap`/`cellKey` (`fc2e4cd`), BoardTable memo (`a501900`), Kanban memo + O(1) lookup (`62a3283`), realtime hoisted to BoardViews for all 4 views (`9f21150`), Kanban virtualization (`0fdd0c1`), Calendar/Gantt memo of 13 derivations (`44289e8`, `7abbaf1`).
- DB (`26fc2ed`): added `cell_values(board_id)` index; applied to the cloud DB via `supabase db push`.
- Guardrail: `gotcha-09` ADR + `AGENTS.md` perf invariant + working-agreement rule #5 (specs/plans must state a performance & data-fetching budget).
- Final gate green: typecheck clean, lint 0 errors, 219/219 tests, build OK. Pushed `develop` to remote.

## Why

Switching views felt slow because in-page state was driven through RSC navigation, refetching unchanged data and remounting heavy views. Fixing the pattern (not just the instance) and capturing it as an enforced invariant prevents recurrence as more view kinds land.

## Open threads

- **Migration drift:** 3b's `timeline_dependencies` schema was applied to the cloud out-of-band (objects existed, ledger didn't record them; `create table` not idempotent). Reconciled with `supabase migration repair --status applied 20260616192633`. 3b owner should confirm the out-of-band apply was complete (repair assumes live schema == `192633.sql`).
- Bounded/paginated `cell_values` reads for very large boards remain out of scope (noted in the plan).
- Realtime "single channel survives switches" verified by unit grep, not in-browser; worth a manual WS check.

## Next session entry point

`develop` @ `7abbaf1` is green and pushed. Next: confirm 3b migration completeness, then consider the `develop → main` promotion PR (only that deploys prod). Phase 4 collaboration spec (`1e9c7da`) is queued for implementation.

## Update (2026-06-17)

- Vault wrap-up committed + pushed (`a2ab0a7`); `develop` now at `a2ab0a7` on remote.
- Opened the **`develop → main` promotion PR (#16)** — 47 commits (Phase 3 views + dark reskin + this perf pass). Not merged; CI + the 3b-migration-completeness check are the gates before merge. Body carries the migration-drift caveat.
