---
type: session
date: 2026-08-09-2130
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-08-06-1343-mcp-full-surface-22-tools]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Report Builder v2 — roll-ups and org templates

## What changed

- **Migration `20260809164720`** — `reports.board_id` becomes nullable and demotes to a *home board*
  pointer; new `report_boards` join table is the canonical membership (backfilled: 3 reports → 3 rows,
  0 unbackfilled); new `reports.scope` (`board|boards|portfolio|template`) behind a check constraint
  that makes an inconsistent binding unrepresentable; new `reports.portfolio_id`; `report_in_org()` +
  org-scoped RLS on `report_boards` with cross-org write confinement.
- **New `/reports` top-level section** (sidebar between Portfolios and Workload, ⌘K entry, skeleton,
  error boundary) listing the org's reports with a scope chip, plus the template gallery. The builder
  moved to `/reports/[reportId]`; `/boards/[id]/reports/[reportId]` now redirects there.
- **Scope picker + org templates** — a report binds to one board, an explicit board set, or a
  portfolio it then auto-follows. Save-as-template and create-from-template land in the gallery.
- **The per-board shapers were left frozen.** `shapeReport`/`computeKpis`/`computeChartSeries` are
  byte-identical; a new `aggregate.ts` (`poolKpis`, `mergeChartSeries`) and `render-data.ts` sit on
  top, so 533 lines of the highest-risk existing tests never had to change.
- Access: `deriveReportAccess` — read needs one readable bound board (templates exempt), edit mirrors
  the house `can_edit_portfolio` precedent (creator ∨ org owner/admin ∨ editor-on-all-boards).
- MCP `list_reports`/`get_report` span many boards behind **one batched** readability probe; AI
  narrative drafts across the whole scope and now sends column **names** (they never were).
- Merged direct to `develop` as `0ab1c95e`. Gates: typecheck clean, lint 0 errors, **5140 tests**, build.

## Why

The mission-control board showed "Planning & insight" stuck at **92%**, and the only thing behind that
8% was Report Builder v2 — flagged in the north-star as the critical path with *no spec and no plan*.
Closing it takes the pillar to 100%.

## How to test

1. Pull `develop` (`git pull`) and run `pnpm dev`. Everything below is on the DEV database, which is
   the live user data — use a scratch board.
2. **Sidebar → Reports.** New section between Portfolios and Workload. Existing reports are listed
   with a `Board` chip. (⌘K → "Reports" also works.)
3. Open an existing report. It should look **exactly as before** — this is the no-regression check.
   Export the PDF and confirm it is unchanged.
4. In the builder, use the **scope picker** → *Several boards* → pick 2–3 boards → Apply.
5. The preview now renders a **section per board** under Board detail / Group progress / Appendix,
   each with a board heading; KPIs at the top are pooled across boards, and the donut merges
   categories by label. The cover reads "across 3 boards".
6. Toggle sections, reorder them, change chart options. **Nothing should hit the network** — confirm
   in devtools Network that no request fires (working agreement #5).
7. On a multi-board report, each board-specific block gets a **board target** control — set Board
   detail to one board and confirm only that board's table renders.
8. **Export PDF** and confirm it matches the preview exactly (both derive through `render-data.ts`).
9. Scope picker → *A portfolio* → pick one → Apply. Add a board to that portfolio elsewhere, reload
   the report: the new board appears without touching the report.
10. **Save as template** → name it → go to `/reports`: it appears under Templates. Then **New report →
    from template** and confirm the blocks come across and you pick a fresh scope.
11. Ask a colleague who cannot read one of the bound boards to open the report: it renders the boards
    they can read and discloses "N boards omitted — no access", never silently.

## Open threads

- **Not promoted.** `develop` is ahead of production; this needs a `develop → main` promotion (which
  also publishes the pending `/updates` backfill).
- Roll-up rows on `/reports` show "Multiple boards" rather than an exact count — hydrating membership
  per row would be an N+1; it needs one bounded batched read.
- Untouched and still open: the `SECURITY DEFINER`-through-service-client dashboard widget guard, and
  `monolith-desktop` still has no git remote.

## Next session entry point

Promote `develop → main` via `/promote` to put Report Builder v2 and the `/updates` backfill live,
then walk the numbered test above against production. After that the critical path is **E6 Stripe**.
