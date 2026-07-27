---
type: session
date: 2026-07-06-1006
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-05-2018-shadcn-charts-phase1-2-expressive]]"
  - "[[2026-07-05-1456-nav-declutter-direction-b]]"
  - "[[2026-07-05-1458-import-wizard-structure-step]]"
---

# /whats-next triage → Batch A parallel cleanups

## What changed

- Ran `/whats-next` triage: reconciled vault against git, found north-star §3 stale on three counts (audit-fix sweep already promoted as PR#51 on `origin/main`; zero live worktrees despite §3 naming four; `.mcp.json`/`push-schema.sh` already committed).
- Dispatched **3 scoping agents** (worktrees) → 3 specs+plans, then **3 build agents** in parallel — all merged to `develop`, worktrees/branches cleaned up:
  - **#1 chart-preview lazy-load** (`e6afab1`): new `LazyChartWidget` (only static dep `next/dynamic`; `ChartWidget` behind `dynamic(ssr:false)`), rewired `DashboardWidget` + `WidgetConfigSheet` preview, + a transitive-import guard test (RED→GREEN) replacing the old self-referential grep. Closes the charts-P2 first-paint-recharts follow-up.
  - **#2 nav-declutter minors** (`a085f1c`): dropped redundant `countNewFeedback` sidebar round-trip; removed dead `isOrgAdmin` plumbing; `NavSection` a11y (body kept mounted + `hidden` so `aria-controls` always resolves); dashboards workspace-filter test.
  - **#3 import dead-code cleanup** (`abd6493`): removed `buildImportPayloadV2`/`splitRows2`/`Split2` + cascade; left unsuffixed `buildImportPayload` for a separate call.
- All four gates green on each (typecheck/lint/test/build; ~2424 tests; only 12 pre-existing lint warnings). `develop == origin/develop @ e6afab1`.

## Why

Clearing the small, disjoint carryover follow-ups (perf/a11y/dead-code) that had accumulated on top of the unpromoted `develop` stack, so the next promote ships a clean slate and Phase 10 can start without loose ends. Demonstrates the `/whats-next` scope-then-build parallel-worktree loop.

## How to test (for the user)

- **#1 / #3** — not user-observable, verified by the suite. Optional payoff check for #1: DevTools → Network on fresh `develop`, open a chart-free dashboard → no recharts chunk on first paint (loads on demand when a chart first mounts).
- **#2 a11y** — `pnpm dev`, sign in, collapse a sidebar group (e.g. **Planning**): links hide, toggle name flips Collapse↔Expand, collapsed links leave the tab order (Tab skips them), `aria-controls` always resolves. Expand restores.

## Open threads

- **Promotion pending** — cross-group-DnD needs a real-browser pass (jsdom can't test collision selection) before `/promote` ships the stacked `develop` (charts + brand + DnD + hydration + these 3).
- **Two build agents overwrote a pre-existing test** the plan said to _create_ (nav `nav-section.test.tsx`, charts `WidgetConfigSheet.test.tsx`) — verified RED→GREEN and consistent with the chosen decisions, but flagged.
- Unsuffixed `buildImportPayload` also has 0 prod call sites (separate lineage) — retire in a follow-up or confirm intentional keep.
- Two stale `_draft-*.md` (07-05 1038, 1606) left for their own blocks' wrapups.

## Next session entry point

Do the cross-group-DnD browser pass, then `/promote develop → main`. After that, build **Phase 10 Epic 1** (foundation + Ask Monolith) — spec+plan ready at `docs/superpowers/{specs,plans}/2026-07-05-ai-foundation-and-ask-pulse*` (Task 0 migration is user-applied).
