---
type: session
date: 2026-06-21-1304
branch: develop
trigger: wrapup
status: complete
tags: [session, phase7, portfolios]
related:
  [
    "[[2026-06-21-gotcha-30-mcp-vs-cli-type-gen-shared-db]]",
    "[[2026-06-21-gotcha-31-worktree-needs-real-install]]",
  ]
---

# Phase 7a — Portfolios (build + ship)

## What changed

- **Phase 7a Portfolios shipped to `origin/develop`** (`3454cfa..ee041b4`, 9 task commits + merge; FF-pushed, not via `finish-task.sh` — see Open threads). Spec `docs/superpowers/specs/2026-06-21-phase-7a-portfolios-design.md`, plan `docs/superpowers/plans/2026-06-21-phase-7a-portfolios.md`.
- Org-wide exec grid at `/portfolios`: each row = one board. `portfolios` + `portfolio_boards` tables, `can_edit_portfolio` gate, and 3 RPCs (`create_portfolio`, `add_portfolio_board` w/ 200-cap, `portfolio_rollup` returning RAW per-board aggregates). Migration `20260621071929_portfolios`.
- Hybrid rows: progress %/timeline/overdue auto-rolled (SQL), `progressPct`/`computeAutoHealth`/`mergeRows` derived in pure TS; manual owner/priority/budget/status-note + health override. Per-board completion mapping (status column + done options).
- UI: `PortfolioGrid` (sort via History API, 0 refetch), `AddBoardDialog` (board + mapping picker), `EditPlacementPopover`, health/progress/priority pills; `/portfolios` routes; sidebar stub wired live.
- Built **subagent-driven** (fresh implementer + review per task) in a nested worktree. Gate green on the merged tree: typecheck · lint · Turbopack build · **977/977 tests** · Playwright e2e · live RLS integration (3/3). Final review **SHIP**.

## Why

First slice of Phase 7 (Asana polish), run as a parallel design→build track while 6d (relations) was in flight. Portfolios was the lowest-new-schema, highest-exec-value slice and reuses the dashboard-aggregate spine. 6d merged to develop mid-build; its `relation` types auto-merged cleanly with portfolios (typecheck confirmed).

## How to test (for the user)

1. Reconcile the main checkout to the shipped tip: `git checkout develop && git pull origin develop` (your local `develop` is diverged — see Open threads).
2. `pnpm dev`, sign in.
3. Sidebar → **Portfolios** (now a live link) → **New portfolio**, name it.
4. **Add board** → pick a board → confirm the done-status mapping (auto-pre-selects Done/Complete/Closed options) → Add.
5. Row populates: **Progress %**, **Timeline** (earliest→latest item date), **Health** pill (auto from pace, shows `·auto`).
6. Row **⋯** → set Owner / Priority / Budget / Status note / Health override → override replaces the auto pill.
7. Click **Sort: Health** → URL gains `?sort=health`, grid re-sorts with **no full reload** (0-refetch budget).
8. RLS spot-check: a board you can't read is silently omitted from the grid.

## Open threads

- **North-star bump deferred.** The main checkout had another session's _uncommitted_ `vault/00-north-star.md` edit (6g workspace-management) + diverged local commits, so I could not bump §3 without sweeping their work in. Add a Portfolios §3 "Latest" entry on a clean `develop`.
- **Main checkout `develop` is diverged** from `origin/develop` (another session's unpushed `a76dfc8` workspace-mgmt spec + obsidian commits, and it's behind my portfolios merge). That session should `git pull --rebase`.
- Deferred per spec: portfolio-of-portfolios nesting, configurable columns, budget _actuals_, time-series progress. (7b Goals/OKRs, 7c Workload remain unspec'd.)

## Next session entry point

Phase 7a is shipped. Next Phase 7 slices: **7b Goals/OKRs** or **7c Workload** (each needs its own brainstorm→spec→plan). Or resume Phase 6 (6d-2 mirror, 6e docs). First, reconcile the main checkout's diverged `develop`.
