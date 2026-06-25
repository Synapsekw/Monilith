---
type: session
date: 2026-06-25-2052
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-25-1530-calendar-canvas-fill]]"
---

# Batch A build + production promotion (#35)

## What changed

- `/whats-next` triage → scoped + built three disjoint Batch-A slices in parallel worktrees, each TDD + gated, merged to `develop`:
  - **onOpenItem** (`972aea7`) — calendar bar/popover/agenda click (and keyboard) opens the item panel via `?item=` History API (0 refetch); was a `undefined` stub.
  - **Phase 9.4 skeletons** (`b855bb8`) — six content-shaped `loading.tsx` (dashboards, goals, portfolios, settings, time, workload) + per-section skeleton components; zero layout shift, double as streaming-shell fallbacks.
  - **Phase 9.3 cache** (`5fa2d16`) — tagged `use cache` on identity-scoped shell reads (boards/dashboards/workspaces/admin guards) + `cacheLife` profiles + read-your-writes `updateTag`; cross-tenant isolation integration test passed 4/4 live.
- Promoted `develop → main` as **PR #35** (`674c570`) — 63-file delta; main CI + Vercel prod deploy green; healed squash divergence (`6d90701`, `-s ours`).

## Why

Clear the unpromoted `develop` bundle now that `ANTHROPIC_API_KEY` is in Vercel, and push Phase 9 (perf/perceived-perf) forward — 9.3 cache + 9.4 skeletons were the next roadmap slices after 9.1/9.2.

## How to test (for the user)

After Vercel prod deploy (live):

1. Open a board with dates → **Calendar** view → click an event bar (or press Enter on it, or click an Agenda row) → the **item panel** opens; close it → URL returns clean, no reload.
2. DevTools → throttle **Slow 3G** → visit Dashboards / Goals / Portfolios / Settings / Time / Workload → each shows a **content-shaped skeleton** (no spinner, no layout jump).
3. Create/rename/delete a board → sidebar updates **immediately** (cache `updateTag` read-your-writes).

## Open threads

- Build-agent stall: the onOpenItem subagent repeatedly ended its turn after backgrounding a gate ("monitor armed, waiting") — code was complete but uncommitted; finished + committed it manually. Avoid `run_in_background` for gates in build agents.
- Orphaned uncommitted edits still in the main checkout (`DashboardsNav.tsx`/`.test.tsx`, deleted `GenerateWithAiButton.tsx`) — not mine; reconcile (commit or discard).
- Two other-session worktrees live: `task/board-spreadsheet-io`, `task/streaming-shell-9-2` (the latter stale, 0 commits ahead).

## Next session entry point

Phase 9 continues: 9.3b (dashboard widget aggregation caching, deferred) and 9.6 Web-Vitals gate. Optional carryover: #3 optimistic board mutations (must rebase onto the now-landed `actions.ts` `updateTag` lines).
