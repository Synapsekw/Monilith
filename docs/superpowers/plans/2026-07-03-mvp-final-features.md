# MVP Final Features

> **What this is:** the consolidated backlog of every open **feature request submitted by real
> users through the in-app feedback feature** (`public.feedback`, `kind = 'feature_request'`),
> deduplicated and shaped into an execution plan. This is the current product goal — `/goal`
> points here. Snapshot taken from the dev database on **2026-07-03**.
>
> **What this is not:** a per-feature implementation plan. Each feature below still goes through
> the normal pipeline before build (`brainstorming` → `writing-plans` in its own
> `task/<slug>` worktree, per AGENTS.md), where the perf/data-fetching budget (working agreement
> #5) and the detailed task DAG (#6) get answered for that feature.

## Sources (raw feedback)

| #   | Feedback title                               | Submitted by                 | Date       | Status                          |
| --- | -------------------------------------------- | ---------------------------- | ---------- | ------------------------------- |
| F1  | Currency Column                              | info@synapse-solutions.ai    | 2026-06-23 | planned                         |
| F2  | Summary Row                                  | info@synapse-solutions.ai    | 2026-06-23 | planned                         |
| F3  | Improve export excell formatting             | danijel.uae@gmail.com        | 2026-06-26 | planned                         |
| F4  | Tablet Optimization                          | info@synapse-solutions.ai    | 2026-06-26 | **resolved** (shipped as TOUCH) |
| F5  | Global Feature Improvements (6 sub-requests) | irdhina.harith@accenture.com | 2026-06-29 | planned                         |
| F6  | Item Status Automation                       | irdhina.harith@accenture.com | 2026-06-29 | new (untriaged)                 |

F4 is excluded below — already implemented (iPad TOUCH batch 1 + 2). F5 bundles six distinct
features (numbered F5.1–F5.6). F6 overlaps heavily with F5.6, so they are merged into one
feature (item 9).

## Features

### 1. Currency column type — `S/M` _(from F1)_

A new board column kind for money values with a per-column currency selector (symbol, formatting,
decimals). Builds on the existing column-kind registry (Phase 2/6b custom fields). Spec should
decide: fixed currency per column vs per cell, and whether summary aggregation (item 2) needs to
handle mixed currencies.

### 2. Summary row (configurable per-column aggregation) — `M` _(from F2)_

A functional, modular footer row per group/board: the user assigns **how** each column is
summarized (sum, avg, min/max, count, % done, …) and what is displayed. Mirror-column aggregation
(Phase 6d-3) already has an aggregation vocabulary to reuse. Must respect the bounded-reads rule —
aggregate server-side or over already-loaded page data, never force an unbounded fetch.

### 3. Formatted Excel export — `M` _(from F3)_

Board → Excel export currently produces unformatted cells. Bring the export closer to the board:
status/dropdown color fills, percentage bars (data bars), header styling. `exceljs` is already a
dependency (spreadsheet IO, 2026-06-25) and supports fills + data-bar conditional formatting, so
this is an enrichment of the existing export path, not a new subsystem.

### 4. Dependency "At Risk" propagation — `M` _(from F5.1)_

Timeline/Gantt with finish-to-start dependencies already exists (Phase 3). The new part: when a
predecessor's due date slips, flag its **immediate successors** (single hop, not the full
downstream chain) as **At Risk**. Needs a place to surface the flag (item row, Gantt bar, filter).

### 5. Priority field + auto-critical flagging — `S/M` _(from F5.2, depends on item 4's data — already present)_

A dedicated **Priority** field (Normal / Critical), separate from Status. Auto-set to Critical
when **2+ items depend on it** (dependency data already exists from Phase 3, so this is not
blocked). Decide in spec: board-level column vs built-in item property.

### 6. Inline editing on Calendar & Timeline views — `M` _(from F5.3)_

Status and % complete editable directly in Calendar and Timeline views, not just the Main Table.
Reuse the existing inline cell editors; interaction must stay client-side + Server Action per
edit (no full-page RSC refetch — gotcha-09).

### 7. Phase-completion reporting dashboard — `S/M` _(from F5.4)_

Dashboard widget(s) showing % completion per phase (board/group) with breakdown by
workstream/sub-group. Dashboards + 9 chart types + battery widget already exist (Phase 8); this
is likely a widget configuration/preset gap more than a new engine — spec should verify before
building anything new.

### 8. Overall health summary + alerts — `L` _(from F5.5; reuses item 9's rules)_

- Dashboard summary of overall plan health/progress.
- In-dashboard notifications **and a weekly email digest** covering: new activities added, and
  activities flagged **structurally incomplete**.
- Suggested structural-completeness rule (confirm with the requester at spec time): missing any of
  owner, start date, due date, or (for a parent item) at least one sub-item.
- Email digest is the only genuinely new infrastructure (scheduled send — `pg_cron` + existing
  email path or Resend-style provider). Everything else composes notifications (Phase 4b) +
  dashboards (Phase 8).

### 9. Automated status rules (Delayed / At Risk / % sync) — `M` _(merges F6 + F5.6)_

Built on the existing automations engine (Phase 5, incl. date triggers):

- **Completed ⇔ 100%** two-way sync: marking an item Completed sets % complete to 100, and vice
  versa.
- Incomplete item **past its due date** → auto-mark **Delayed**.
- Item **within 3 days of due date and < 50% complete** → auto-mark **At Risk**.

Ship as automation recipes (user-visible, per-board toggleable) rather than hard-coded behavior,
so orgs with different status vocabularies can adapt them.

## Execution DAG (working agreement #6)

Edges:

- **9 → 8**: the health summary's "structurally incomplete / at-risk" alerts consume the rule
  definitions and flags produced by item 9.
- **4 → (soft) 8**: At-Risk flags feed the health summary if built first (not a hard blocker).
- **1 → (soft) 2**: summary row should know how to aggregate a currency column; buildable in
  either order but 1-before-2 avoids rework.
- Everything else is pairwise independent (disjoint subsystems: export, calendar/timeline editors,
  dashboard presets).

**Parallel batches** (each item = one `task/<slug>` worktree; ≥2 in a batch → dispatch in
parallel per `superpowers:dispatching-parallel-agents`):

| Batch | Items                                                                                                                        | Note                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A     | 1 (currency), 3 (excel export), 4 (at-risk propagation), 6 (inline cal/timeline edit), 7 (phase dashboard), 9 (status rules) | all independent                                                               |
| B     | 2 (summary row), 5 (priority auto-critical), 8 (health summary + digest)                                                     | 2 after 1; 5 after 4 only if they share the dependency-read helper; 8 after 9 |

**Critical path:** 9 → 8 (automated rules, then health summary + weekly digest) — the wall-clock
floor. Item 8 is also the largest single item (email digest infra).

## Definition of done

MVP Final is complete when every item above is merged to `develop`, promoted to `main`, **and the
corresponding feedback rows are updated** (status → `resolved` + admin response) so the submitters
get their `feedback_response` notifications. Item 8's completeness rule needs requester
confirmation before its build starts.
