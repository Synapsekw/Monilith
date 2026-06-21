# Phase 7a — Portfolios — Design

- **Date:** 2026-06-21
- **Status:** Approved (brainstorming) — pending implementation plan
- **Author:** danijel + Claude
- **Phase:** Phase 7 (Asana polish), slice **7a** — first of three independent slices
  (7a Portfolios · 7b Goals/OKRs · 7c Workload/capacity)

## 1. Summary

A **Portfolio** is an exec-level roll-up grid where **each row is one board/project** and the
columns summarize its status: owner, health (RAG), progress, timeline, priority, budget. It is the
"zoom-out" exec view the PRD calls for (§4.3 Asana polish) — a single place to see how many
in-flight initiatives are on track without opening each board.

The central constraint (confirmed by a data-model survey of the repo): **a board has no roll-up-able
attributes of its own.** `boards` carries only `name, description, created_by` — there is no
board-level status, owner, timeline, health, priority, or budget. Those concepts exist only as
per-item `cell_values`. So the design's core job is turning a board into one summarized row.

We do this with a **hybrid (Asana-style) model**:

- **Auto-rolled from the board's items:** progress % (share of items "done"), timeline (earliest
  start → latest end of date cells), overdue count, and a **suggested health** computed from pace.
- **Manual per-placement fields:** owner, priority, budget (a planned number), a short status note,
  and an optional **health override** that wins over the suggestion.

Portfolios are **org-wide, cross-workspace** objects (a true exec view), surfaced at `/portfolios`
(the sidebar already has a disabled **Portfolios** stub awaiting this).

## 2. Goals / Non-goals

**Goals**

- A `/portfolios` section: list portfolios, open one, see its board-rows grid.
- Org-wide membership: a portfolio can include **any board across any workspace**, subject to
  per-board visibility (`can_read_board`).
- Hybrid rows: auto progress + timeline + suggested health; manual owner / priority / budget /
  status-note / health-override.
- **Per-board completion mapping** chosen at add-time (which status column + which option(s) = done),
  so heterogeneous boards roll up correctly.
- A single **bounded** rollup RPC produces all rows in one read; in-page sort/group/filter add **zero**
  server round-trips (client state + History API).
- RLS-enforced and org-scoped; boards the viewer can't see are omitted from the grid.
- Tests: rollup math (unit), RPC + RLS (live integration), one e2e.

**Non-goals (YAGNI — possible future slices)**

- Portfolio-of-portfolios nesting / hierarchy.
- Custom or user-configurable columns (v1 column set is fixed).
- Time-series progress history / burn-up charts.
- Budget **actuals** vs. planned, or any spend integration (v1 budget = one manual planned number).
- Including non-board entities (Goals, other portfolios) as rows.
- Portfolio-level sharing ACLs beyond "org-visible / creator+admin-edit" (see §6).
- Real-time live updates of the grid (read is on navigation/revalidation, not a Realtime subscription).

## 3. Data model

Two new tables. Both follow repo conventions: denormalized `org_id` on every row, RLS via
`is_org_member(org_id)`, `position` float8 for ordering (midpoint-reorder pattern), `updated_at`
trigger.

### 3.1 `portfolios`

| Column                      | Type        | Notes                               |
| --------------------------- | ----------- | ----------------------------------- |
| `id`                        | uuid pk     |                                     |
| `org_id`                    | uuid        | denormalized; RLS scope             |
| `name`                      | text        | required                            |
| `description`               | text        | nullable                            |
| `created_by`                | uuid        | the creator (owner for edit-gating) |
| `created_at` / `updated_at` | timestamptz |                                     |

Org-wide (no `workspace_id`). **Visibility:** readable by any org member; **editable** by the
creator **or** an org admin (see §6). This is deliberately broader than Dashboards (workspace-scoped)
because a portfolio is an exec artifact.

### 3.2 `portfolio_boards`

One row per board placed in a portfolio (a board may appear in multiple portfolios; mapping + manual
fields are **per placement**).

| Column            | Type                                                         | Notes                                                             |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `id`              | uuid pk                                                      |                                                                   |
| `org_id`          | uuid                                                         | denormalized; RLS scope                                           |
| `portfolio_id`    | uuid → `portfolios`                                          | cascade delete                                                    |
| `board_id`        | uuid → `boards`                                              | cascade delete                                                    |
| `position`        | float8                                                       | manual ordering within the portfolio                              |
| `owner_user_id`   | uuid → org member                                            | nullable; manual                                                  |
| `priority`        | enum `portfolio_priority` (`low`/`medium`/`high`/`critical`) | nullable; manual                                                  |
| `budget`          | numeric                                                      | nullable; manual **planned** number                               |
| `health_override` | enum `portfolio_health` (`on_track`/`at_risk`/`off_track`)   | nullable; null ⇒ use auto                                         |
| `status_note`     | text                                                         | nullable; short manual note                                       |
| `done_column_id`  | uuid → `columns`                                             | the **status** column on this board used for completion           |
| `done_option_ids` | jsonb                                                        | array of `optionId`s on `done_column_id` that count as "complete" |

Unique `(portfolio_id, board_id)`. Indexes on `portfolio_id` and `board_id`.

**Completion mapping defaults:** when a board is added, default `done_column_id` to the board's
first `status` column and pre-select option(s) whose label matches `/done|complete|closed/i` (a
_suggestion only_ — fully overridable in the add/edit dialog). If a board has no status column, the
board can still be added; progress shows **n/a** until a mapping is set.

**Derived, never stored** (computed by the rollup RPC, §4): `total_items`, `done_items`,
`progress_pct`, `timeline_start`, `timeline_end`, `overdue_items`, `auto_health`.

## 4. The rollup RPC

`portfolio_rollup(p_portfolio_id uuid)` — `SECURITY DEFINER`, returns one row **per placed board**:

```
board_id, name, total_items, done_items, progress_pct,
timeline_start, timeline_end, overdue_items, auto_health
```

Behaviour:

- **Membership-gated:** only boards the caller can read (`can_read_board(board_id)`) are returned;
  others are omitted. The portfolio itself must be org-readable.
- **Bounded:** rows = boards placed in the portfolio (a curated set); hard-cap the placement count
  (e.g. **200**) at insert time so the read stays bounded. The per-board item scan runs over the
  indexed `cell_values(board_id, column_id)` / `items(board_id)`.
- **Progress:** `done_items` = count of (non-subitem) items whose cell on `done_column_id` has an
  `optionId` ∈ `done_option_ids`; `total_items` = count of items on the board; `progress_pct =
round(100 * done/total)` (null/`n/a` when `total = 0` or no mapping).
- **Timeline:** `min(date)` → `max(coalesce(end, date))` across the board's date cells.
- **Overdue:** items with a `date`/`end` before today that are not "done".
- **`auto_health`:** `off_track` if past `timeline_end` and `progress_pct < 100`; else `at_risk` if
  pace is behind (`progress_pct` < % of the start→end window elapsed) **or** `overdue_items > 0`;
  else `on_track`. (Boards with no timeline and no overdue items ⇒ `on_track`; with no mapping ⇒
  health shows as "—".)

The grid displays `health_override` when set, otherwise `auto_health`, with a small affordance
distinguishing "set by owner" from "auto."

Manual fields and the mapping are **not** in this RPC — they're read directly from `portfolio_boards`
(RLS-scoped) alongside the RPC result and merged server-side into the row model.

## 5. UI & routes

- **Routes:** `/portfolios` (list) and `/portfolios/[portfolioId]` (the grid). New
  `src/app/portfolios/` segment under the existing `<AppShell>` layout pattern (like
  `boards/`/`dashboards/`). Wire the existing disabled **Portfolios** sidebar stub
  (`src/components/sidebar.tsx`) to `/portfolios`.
- **Server load (one pass):** the portfolio row, `portfolio_rollup(...)`, the `portfolio_boards`
  manual fields, and `listOrgMembers` (to resolve owners) — assembled into a `PortfolioRow[]` model.
- **Grid columns (fixed v1):** **Board · Owner · Health · Progress · Timeline · Priority · Status
  note · Budget.** Owner renders via the org-member resolution already used for People cells; Health
  is a colored RAG pill; Progress is a bar + %; Timeline is a start→end range; Priority is a labelled
  pill. Reuse the `formatCell`/list-widget rendering idiom where applicable.
- **Add-board flow:** a dialog to pick a board (from boards the user can read, across workspaces) and
  set the completion mapping (status column + done options, pre-filled with the suggestion).
- **Edit-row flow:** inline/popover edit of the manual fields (owner, priority, budget, status note,
  health override) and the mapping.

## 6. Permissions / RLS

- `portfolios`: **read** = `is_org_member(org_id)`; **insert** = org member (sets `created_by`);
  **update/delete** = `created_by = auth.uid()` **or** caller is an org admin (reuse the existing
  admin predicate used by the admin console). No cross-org access.
- `portfolio_boards`: same org scope; writes gated to users who can edit the parent portfolio.
  Adding a board additionally requires `can_read_board(board_id)` (you can't pull a board you can't
  see into a portfolio).
- The rollup RPC redacts boards the caller can't read, so a portfolio can safely contain boards of
  mixed visibility — each viewer sees only the rows they're entitled to.

## 7. Performance & data-fetching budget (per AGENTS.md §5)

- **First paint vs. interaction:** first paint = one `portfolio_rollup` RPC + the row reads. In-page
  **sort**, **group-by** (workspace / owner / health / priority), and **filter** operate over the
  already-loaded rows as **client state + History API (`pushState`/`replaceState`)** — **0 new server
  round-trips**, no RSC re-run.
- **Server-data changes → Server Action + targeted revalidate:** add/remove board, edit any manual
  field, edit the completion mapping — each is a Server Action that revalidates _this_ portfolio only.
- **Bounded over indexed columns:** rollup reads are bounded by the placement cap and run over
  indexed `portfolio_boards.portfolio_id`, `items(board_id)`, and `cell_values(board_id, column_id)`.
  No unbounded `select *` over growing tables.

## 8. Parallelization (execution DAG — for the plan)

Independent units the plan can schedule concurrently after the schema root lands:

- **Root (sequential first):** migration for both tables + enums + RLS + the `portfolio_rollup` RPC;
  regenerate `database.types.ts`. Everything else depends on this.
- **Then, in parallel:** (a) server actions + queries (CRUD + add/remove board + edit mapping/fields);
  (b) the rollup math + Zod schemas + their unit tests; (c) the grid UI + add/edit dialogs; (d) the
  `/portfolios` routes + sidebar wiring. Final wave: integration + e2e + gate.

The plan must formalize this as a dependency graph + parallel batches + critical path.

## 9. Testing

- **Unit (Vitest):** rollup math — progress %, timeline min/max, overdue, pace → `auto_health`,
  override-precedence; Zod boundary schemas for the manual fields + mapping.
- **Integration (live RPC):** `portfolio_rollup` correctness on seeded data; RLS — cross-org denial,
  `can_read_board` redaction of mixed-visibility boards, admin-edit vs. creator-edit gating.
- **E2E (Playwright):** create portfolio → add a board → set done mapping → see progress + health →
  set an override → sort/group/filter the grid with **no refetch** (assert no RSC navigation).

## 10. Open questions / assumptions

- **Admin predicate reuse:** assumes the existing org-admin check (admin console) is callable from
  the new RLS policies; confirm the exact helper at plan time.
- **Subitems:** progress counts top-level items only (subitems excluded) for v1 — revisit if exec
  feedback wants subitem-weighted progress.
- **"Today" for overdue/pace:** uses the server/org timezone convention already established by the
  date-trigger work; align with the per-user-timezone work landing in parallel.
