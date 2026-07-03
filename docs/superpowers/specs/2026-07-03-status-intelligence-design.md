# Status intelligence — automated status rules + dependency At-Risk propagation — design

- **Date:** 2026-07-03
- **Status:** Spec written, awaiting review
- **Branch:** `task/status-intelligence`
- **Feature items:** MVP Final Features items **4** (dependency At-Risk propagation) and **9**
  (automated status rules), deliberately combined so ONE design owns the "At Risk" schema
  (`docs/superpowers/plans/2026-07-03-mvp-final-features.md`).
- **Mode:** Non-interactive brainstorm — decisions the user would normally arbitrate are recorded
  in "Open questions for review" at the end.

## Problem

Three user requests (feedback F5.1, F5.6, F6), interpreted:

1. **Delayed rule** — any incomplete item past its due date is automatically marked **Delayed**.
2. **At Risk rule** — any item within 3 days of its due date and less than 50% complete is
   automatically marked **At Risk**.
3. **Completed ⇔ 100% sync** — marking an item Completed sets % complete to 100, and reaching
   100% marks the item Completed.
4. **Dependency At-Risk propagation** — when a predecessor's due date slips, its **immediate
   successors** (single hop, not the full downstream chain) are flagged **At Risk**. The
   Gantt/dependency machinery itself already exists (Phase 3); only the flagging is new.

Constraints from the goal plan: rules must be **user-visible and per-board toggleable** (recipes,
not hard-coded), must work with **per-board custom status vocabularies**, the sync must **guard
against trigger loops**, and the At-Risk flag must surface in the UI (item row, Gantt bar,
filterability). Item 8 (health summary + alerts) will consume whatever this design produces, so
the schema must be the one canonical home for "At Risk"/"Delayed".

## Verified context (explored in this worktree)

- **Dependencies:** `public.item_dependencies` (FS-only, `unique (predecessor_id, successor_id)`,
  indexed on predecessor/successor/board/org; `20260616192633_timeline_dependencies.sql`).
  Creation goes through the `create_item_dependency` RPC with a recursive-CTE cycle check. The
  Gantt (`src/components/boards/GanttBoard.tsx`) already computes FS breaches client-side —
  `detectViolations` in `src/lib/boards/gantt.ts` — but only styles the dependency **arrows** red;
  the per-row `violations` prop is received and unused (`void violations;`). Nothing is persisted.
- **Item data is EAV:** `items` has NO built-in status/date/percent columns. Status lives in a
  `status`-kind column whose vocabulary is `columns.settings.options` (`{ id, label, color }` —
  **no "done" semantic flag**); cell values in `cell_values.value` jsonb keyed
  `(item_id, column_id)`. Dates are `{ date, end? }` on `date` columns; percent is
  `{ percent: 0..100 }` on `percent` columns. The established non-text-based done convention is
  the portfolios one: an explicit set of **done option ids** (`portfolio_boards.done_option_ids`,
  consumed by `portfolio_rollup`).
- **Automations engine (Phase 5):** `public.automations`
  (`board_id, enabled, trigger jsonb, condition jsonb, actions jsonb, position`), org-scoped RLS.
  Triggers today: `status_changed`, `item_created`, `person_assigned`, `date_reached
{ columnId, offsetDays }`. Actions: `notify`, `set_option`, `move_to_group`, `call_webhook`.
  Firing: AFTER triggers on `cell_values`/`items` plus an **hourly pg_cron sweep**
  (`_automation_date_sweep`, per-org gated to org-local 08:00, idempotent via the
  `automation_date_fires` ledger, indexed by `cell_values_date_idx (column_id, (value->>'date'))`).
  Loop guard: transaction-local GUC `pulse.aut_depth` (bail at ≥5) + no-op/idempotent-write
  skips (`skipped_equal`). Run history in `automation_runs` (definer-written, pruned to 50/rule).
  Recipes are code-defined draft factories in `src/components/boards/automations/recipes.ts`,
  surfaced in `AutomationsDialog` with per-rule enable toggles.
- **Read path & realtime:** `getBoardPayload` selects `items.*` (new item columns ride the
  existing payload — zero new queries), and the board realtime channel already subscribes to
  `items` with `event: "*"`, so an UPDATE to an item row echoes to all open clients.
- **No board filter system exists** — any filterability is greenfield; the sanctioned pattern is
  client state + History API over the already-loaded cache (gotcha-09).
- **Badge precedent:** `src/components/portfolios/HealthPill.tsx` ("On track / At risk / Off
  track") and `computeAutoHealth` in `src/lib/portfolios/rollup.ts`.

## Central decision: where "At Risk" / "Delayed" lives

**Decision: a computed, self-clearing health flag on `public.items` (`health` +
`health_reasons`), written exclusively by a server-side evaluator. It is NOT a status-column
value.** Rule definitions live as `automations` rows (a new `health_*` trigger family with a
single `set_health` action) so they are user-visible, per-board toggleable, and recipe-driven —
but they are evaluated by a **dedicated level-based evaluator** (cell/dependency triggers + a
daily org-local pg_cron sweep), not by the edge-fired `_automation_run` path. The
**Completed ⇔ 100% sync is the one genuinely edge-triggered behavior** and DOES use the existing
engine, via a new `set_percent` action and a new `percent_reached` trigger.

### Options considered

**A. Automation-written status values** (rules `set_option` a "Delayed"/"At Risk" option into the
board's status column). Rejected as the canonical schema: it **destroys the item's workflow
status** ("Working on it" → "At Risk" loses information), automations are edge-fired and
**cannot clear the mark** when the condition resolves (due date pushed out, percent raised,
predecessor un-slips), and it forces every board to add risk options to its vocabulary. Note:
users who literally want this behavior can already build it today
(`date_reached` + `set_option`); we don't take that away.

**B. Inject built-in "At Risk"/"Delayed" options into every status vocabulary.** Rejected:
pollutes per-board custom vocabularies, breaks Kanban grouping semantics, same no-self-clear
problem.

**C. Computed flag (chosen).** Health is a pure function of current state (status/date/percent
cells + dependency edges), so it can be recomputed idempotently and **clears itself**. Persisted
(vs. derived-at-render) because item 8 needs server-side flags for org-wide summaries, email
digests, and edge-detection alerts ("just became at-risk"), and because filters/badges must agree
across table, Kanban, Gantt, and dashboards without re-deriving the rules in TypeScript.

Sub-decision — **where rule config lives:** a dedicated `board_health_rules` table + bespoke
settings UI was rejected; `automations` rows reuse the existing per-board dialog, enable toggles,
run history, positions, RLS, and the recipe affordance the goal plan explicitly asks for.

Sub-decision — **how rules run:** extending the edge-fired engine alone was rejected (level
semantics vs. edge semantics: "past due" must flip when _time passes_, with no row write to hook,
and must un-flip when data changes). A dedicated evaluator handles level semantics; the existing
engine handles the one edge behavior (sync).

## Data model (migration 1)

```sql
alter table public.items
  add column health text check (health in ('at_risk', 'delayed')),
  add column health_reasons jsonb not null default '[]'::jsonb;

create index items_board_health_idx
  on public.items (board_id, health) where health is not null;

-- Due-value probe for the sweep: the existing cell_values_date_idx covers
-- (column_id, value->>'date'), but due(item) is coalesce(end, date).
create index cell_values_due_idx
  on public.cell_values (column_id, (coalesce(value->>'end', value->>'date')));
```

- `health`: `null` = on track / not evaluated. Severity order: `delayed` > `at_risk`.
- `health_reasons`: array of reason codes — `"overdue"`, `"due_soon"`, `"dependency"` — for
  badge tooltips and item-8 breakdowns. Multiple reasons can coexist; `health` is the max
  severity among them.
- Written only by the SECURITY DEFINER evaluator. (The existing items UPDATE RLS policy would
  technically let an org member write these columns directly; accepted — org-scoped, and the next
  recompute overwrites it. See open question 4.)
- Rides `getBoardPayload`'s `items.*` select and the existing `items` realtime channel with zero
  new queries/subscriptions.

## Rule model (new automation trigger family)

Three new trigger types (Zod discriminated-union members in
`src/lib/validations/automations.ts`; stored in `automations.trigger` jsonb like all others):

```ts
// Shared "what counts as done" config — the portfolios done_option_ids precedent.
// statusColumnId + doneOptionIds identify completion in THIS board's vocabulary.
{ type: "health_overdue",
  dateColumnId: uuid, statusColumnId: uuid, doneOptionIds: string[],
  percentColumnId: uuid | null }

{ type: "health_due_soon",
  dateColumnId: uuid, withinDays: int (1..30, default 3),
  percentColumnId: uuid, belowPercent: int (1..100, default 50),
  statusColumnId: uuid, doneOptionIds: string[] }

{ type: "health_dependency",
  startColumnId: uuid, endColumnId: uuid | null,
  statusColumnId: uuid, doneOptionIds: string[] }
```

One new action type, and health rules carry exactly one of it:

```ts
{ type: "set_health", health: "at_risk" | "delayed" }
```

`health_overdue` recipes default to `delayed`; the other two to `at_risk`. Keeping the action in
the row (instead of hard-coding severity per trigger type) keeps the rows well-formed in the
existing trigger→actions model, renders naturally in the builder sentence, and lets a user
downgrade "overdue" to `at_risk` if they prefer.

### Predicate semantics (level-based, org-local dates)

- **due(item)** = `coalesce(value->>'end', value->>'date')` of the rule's `dateColumnId` cell
  (matches `resolveTimelineSpan`'s end-fallback semantics).
- **incomplete(item)** = status cell's `optionId` ∉ `doneOptionIds` AND
  (`percentColumnId` is null OR percent cell missing OR `percent < 100`).
- **health_overdue** matches when `due < today` (org-local) AND incomplete.
- **health_due_soon** matches when `today <= due <= today + withinDays` AND incomplete AND
  (percent cell missing OR `percent < belowPercent`) — a missing percent counts as 0.
- **health_dependency** matches on a **successor** when at least one immediate predecessor
  (single hop via `item_dependencies`, per the feedback: "not the full downstream chain") is
  incomplete AND `predecessor_end > successor_start`, where `predecessor_end` =
  `coalesce(end-column value->>'date', coalesce(start value->>'end', start value->>'date'))` and
  `successor_start` = start-column `value->>'date'`. This is the same FS-breach predicate as the
  client `detectViolations`, now with a done-guard: a finished predecessor poses no risk however
  late it ran. A done successor is never flagged (incomplete guard applies to it too).

`item.health` = highest severity among all **enabled** matching health rules on the board;
`health_reasons` = the union of matching reason codes; both reset (`null`/`[]`) when nothing
matches — that is the self-clearing property.

## Evaluator (migration 1)

All functions SECURITY DEFINER with `search_path = ''`, matching the engine's conventions.

- **`public._health_recompute_items(p_board_id uuid, p_item_ids uuid[])`** — set-based core.
  Loads the board's enabled `health_*` rules, computes health/reasons for the given items in one
  statement, and applies `update public.items ... where id = any(...) and (health, health_reasons)
is distinct from (new values)` so unchanged rows produce no write (and no realtime echo). For
  each item whose health **changed** to a non-null value, inserts an `automation_runs` row
  (`status 'ran'`, `trigger_type` = the winning rule's type, `automation_id` = winning rule) —
  this feeds RecentRuns today and item 8's alert stream later. No `automation_date_fires`-style
  ledger: recompute is idempotent by construction.
- **`public._health_recompute_board(p_board_id uuid)`** — recompute every item on the board.
  Used on rule create/enable/config-change (one-time, board-bounded backfill).
- **RPC `public.recompute_board_health(p_board_id uuid)`** — `is_org_member`-checked wrapper,
  granted to `authenticated`; called from the `createAutomation`/`updateAutomation` Server
  Actions whenever a `health_*` rule is created, toggled, or edited.
- **Trigger `tg_health_on_cell_change`** — AFTER INSERT OR UPDATE OR DELETE on `cell_values`
  (DELETE included: clearing a date cell must clear risk; the existing automations trigger is
  insert/update-only, this is a separate trigger function). Fast bail: skip unless the board has
  at least one enabled health rule — one indexed existence probe against a new partial index
  `automations_health_idx on public.automations (board_id) where enabled and (trigger->>'type')
in ('health_overdue','health_due_soon','health_dependency')`. Otherwise recompute the item,
  plus — when the changed column is any enabled rule's date/start/end column — its immediate
  successors (`item_dependencies_predecessor_idx`). This is the "predecessor's due date slips →
  flag successors" moment. No-op cell updates are skipped (`is not distinct from`).
- **Trigger on `item_dependencies`** — AFTER INSERT OR DELETE: recompute the successor.
- **Cron sweep `_health_sweep()`** — new hourly job (offset `'15 * * * *'` to avoid contention
  with the automations sweep), per-org gated to **org-local hour 0** (midnight — health flips at
  the day boundary, unlike the 08:00 notification sweep; flags aren't notifications), per-org
  fault-isolated like `_automation_date_sweep`. For each enabled dated health rule it recomputes
  only the items whose due value falls in the transition window `[today-1, today+withinDays]`
  (entering-overdue and entering-due-soon edges; leaving those states only happens via data
  changes, which the cell trigger covers) — an indexed range probe over the new
  `cell_values_due_idx` (see Data model). `health_dependency` needs no sweep (its predicate doesn't reference
  `today`).

**No trigger loops by construction:** the evaluator writes `public.items` only; no automation or
health trigger fires on items UPDATE (`items_run_automations` is insert-only), so recompute can
never re-enter itself or the engine.

## Completed ⇔ 100% sync (migration 2 — genuine edge automations)

Two additions to the existing engine:

- **New trigger `percent_reached { columnId: uuid, percent: int (default 100) }`** — matched in
  `tg_run_automations` on `percent`-cell writes that **cross** the threshold:
  `new percent >= threshold AND (old cell missing OR old percent < threshold)`. Edge semantics
  prevent re-fires on unrelated updates.
- **New action `set_percent { columnId: uuid, percent: int (0..100) }`** — a branch in
  `_automation_run` writing `{ "percent": n }` via the engine's upsert path, with the same
  `skipped_equal` idempotence as `set_option`.

Shipped as two recipes (user picks the columns/option, per-board vocabularies respected):

- **"Completed sets 100%":** trigger `status_changed { columnId: statusCol, toOptionId: doneOpt }`
  → action `set_percent { percentCol, 100 }`.
- **"100% sets Completed":** trigger `percent_reached { percentCol, 100 }` → action
  `set_option { statusCol, doneOpt }`.

**Loop guard, traced:** user sets status → Done ⇒ recipe A writes percent = 100 ⇒
`percent_reached` fires recipe B ⇒ `set_option` finds status already Done ⇒ `skipped_equal`,
chain ends (depth 2 of 5). Reverse direction is symmetric via `set_percent`'s skip. The
`pulse.aut_depth` GUC remains the hard backstop. An integration test pins both directions and
the termination. Downgrade directions (status leaves Done → lower percent; percent drops below
100 → un-Done) are deliberately **not** shipped — see open question 2.

## Recipes & rule-builder UI

New factories in `src/components/boards/automations/recipes.ts` (same `Draft` pattern):

| Recipe                                          | Trigger / action                           | Availability gate              |
| ----------------------------------------------- | ------------------------------------------ | ------------------------------ |
| "Flag overdue items as Delayed"                 | `health_overdue` → `set_health delayed`    | status + date column           |
| "Flag items due soon with low progress At Risk" | `health_due_soon` → `set_health at_risk`   | status + date + percent column |
| "Flag successors of slipped items At Risk"      | `health_dependency` → `set_health at_risk` | status + date column           |
| "Completed sets 100%"                           | `status_changed` → `set_percent 100`       | status + percent column        |
| "100% sets Completed"                           | `percent_reached` → `set_option`           | status + percent column        |

Default column guesses follow `defaultTimelineColumns` conventions: due/end =
`/due|end|finish|target/i`, start = `/start|begin/i`, done options = labels matching
`/done|complete/i` (fallback: user picks in the builder — this is how custom vocabularies are
honored; nothing keys off label text at evaluation time, only at recipe-prefill time).

`AutomationBuilder` gains sentence rendering for the three `health_*` triggers, `percent_reached`,
`set_health`, and `set_percent` (existing column/option picker components compose). The existing
per-rule toggle in `AutomationsDialog` is the per-board on/off requirement — no new toggle
surface. `createAutomation`/`updateAutomation`/`deleteAutomation` call
`recompute_board_health(boardId)` after any write involving a `health_*` trigger, so flags
appear/clear immediately on toggle (including clearing when the last rule is disabled).

## UI surfacing (pulse-ui)

- **`ItemHealthBadge`** (new, `src/components/boards/ItemHealthBadge.tsx`) — a compact
  `HealthPill`-style pill pairing color WITH text (AA / colorblind rule): **At risk** =
  `bg-status-yellow`, **Delayed** = `bg-status-red` (the normative pulse-ui mappings: at
  risk/needs attention = yellow; overdue/stuck = red). `text-xs font-medium rounded-md px-1.5`,
  status-palette color allowed here because this IS a status/label surface, not chrome. A
  `Tooltip` lists the reasons in plain language ("Past its due date", "Due within 3 days, under
  50% done", "A predecessor's dates overlap this item"). An icon-only `sm` variant
  (`TriangleAlert` lucide, `size-3.5`) with `sr-only` text for the densest surfaces.
- **Table row:** badge in the `NameCell` trailing slot (`BoardTable.tsx` ~1587–1614), before the
  row menu.
- **Kanban card:** in the existing pills row next to status.
- **Item panel:** beside `SheetTitle` in the header flex.
- **Gantt:** badge in the sticky name rail of `GanttRowItem`, plus a bar-level tint ring
  (`ring-status-red/yellow`-toned outline) so risk reads at timeline zoom. The existing red
  violation **arrows** stay exactly as they are (edge-level signal); `items.health` is the
  item-level signal. The client `detectViolations` is NOT removed — it still styles arrows and
  works with zero rules enabled.
- **Filterability:** a board-toolbar filter chip — "Health: All / At risk+ / Delayed" — pure
  client state over the already-loaded cache, synced to `?health=` via
  `window.history.replaceState` (Next 16 syncs it into `useSearchParams()`; NO router
  navigation, per gotcha-09). One shared `filterItemsByHealth(items, mode)` helper applied in the
  table, Kanban, and Gantt row derivations. No generic filter engine is built (none exists today;
  out of scope).
- **Realtime:** evaluator writes to `items` echo through the existing `items` `"*"` subscription;
  `foldBoardEvents` already replaces item rows on UPDATE, so open boards see flags flip live. A
  unit test pins that the fold preserves/applies `health` fields.

## Performance & data-fetching budget (working agreement #5)

**(a) First paint vs. interaction:**

| Surface                | First paint                                                                                                                 | Interaction                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Board page (all views) | **0 new queries** — `health`/`health_reasons` ride the existing `items.*` select in `getBoardPayload`; badge is pure render | Health filter chip: **0 round trips** (client state + History API)                                       |
| Automations dialog     | unchanged (existing `getAutomations` read)                                                                                  | rule toggle = 1 Server Action + 1 bounded `recompute_board_health` RPC (server-data change → sanctioned) |
| Gantt                  | 0 new queries (flags from cache; arrows unchanged)                                                                          | unchanged                                                                                                |

**(b) Server data vs. client state:** flag writes are exclusively server-side (triggers/cron/RPC).
The only user interactions are rule create/toggle (Server Actions — they change server data) and
the view filter (client state + History API — changes nothing server-side).

**(c) Bounded, indexed evaluation (server-side/scheduled):**

- Cell-write path: one indexed existence probe (`automations_health_idx`, partial) on boards
  **without** rules — near-zero overhead for the common case; on rule boards, recompute of
  **1 item + its direct successors** (PK + `item_dependencies_predecessor_idx`), set-based.
- Daily sweep: per enabled rule, one indexed range probe over `cell_values_due_idx
(column_id, coalesce(value->>'end', value->>'date'))` spanning `withinDays + 2` days — never a
  full `items`/`cell_values` scan;
  per-org gated hourly cron identical in shape to the proven `_automation_date_sweep`.
- Board backfill (`recompute_board_health`): board-bounded, only on rule mutations, one set-based
  statement.
- Reads for item 8 later: `items_board_health_idx` partial index makes "flagged items per
  board/org" an index-only aggregation.

## Security

- Evaluator functions are SECURITY DEFINER with `search_path = ''` and write only org-scoped rows
  derived from the triggering row / checked RPC argument; `recompute_board_health` verifies
  `is_org_member` via the board's `org_id` before doing anything.
- No service-role usage in TS; all client reads stay RLS-scoped. RLS policies are untouched.
- `automation_runs` insert stays definer-only (no client write policy), as today.
- Known soft spot: `items.health` is writable by org members under the existing items UPDATE
  policy (see open question 4) — org-scoped and self-healing, no cross-tenant exposure.

## Testing strategy

Integration (serial project, following `automations.engine.5b1.integration.test.ts` patterns):

- `health_overdue`: flag set on overdue+incomplete; **cleared** when due date moves out / status
  set to done / percent set to 100.
- `health_due_soon`: boundary cases (due = today, today+3, today+4; percent 49 vs 50).
- `health_dependency`: predecessor end slips past successor start → successor flagged with reason
  `dependency`; successor-of-successor NOT flagged (single hop); predecessor marked done →
  cleared; dependency deleted → cleared.
- Severity: item both overdue and dependency-hit → `delayed` + both reasons.
- Rule lifecycle: enable → backfill flags; disable last rule → all flags cleared.
- Sweep: `_health_sweep(p_now)` with an injected timestamp flips an item to delayed exactly at
  the org-local day boundary (mirror the 5b2 sweep tests).
- Sync: both directions; loop termination (Done → 100 → `skipped_equal`, run history shows no
  depth exhaustion); `percent_reached` does not re-fire on a non-crossing update.
- RLS/org isolation for the new RPC.

Unit (Vitest): Zod unions round-trip; recipe factories produce valid drafts; `ItemHealthBadge`
render + a11y (text present, not color-only); `filterItemsByHealth`; Gantt row indicator;
realtime fold preserves `health` on item UPDATE; builder sentences for the new types.

## Independent units (for the plan's Execution DAG)

- **U1** Migration 1: health schema + evaluator + triggers + sweep.
- **U2** Migration 2: `percent_reached` + `set_percent` engine extension.
- **U3** Zod + recipe factories (pure TS — parallel with U1/U2).
- **U4** Types regen gate (user applies migrations to cloud dev; `pnpm db:types`).
- **U5** Builder/dialog UI + recompute-RPC wiring in automation actions.
- **U6** Badge + cache plumbing + table/kanban/panel attachment.
- **U7** Gantt surfacing. **U8** Health filter chip. (U7/U8 after U6.)
- **U9** Integration tests (after U4).

## Interfaces produced for item 8 (health summary + alerts — depends on this work)

- `items.health` / `items.health_reasons` + `items_board_health_idx` — org/board-level flag
  aggregation for the dashboard summary and digest queries.
- The `health_*` trigger family in `automations` — item 8's "structurally incomplete" rule slots
  in as a fourth member of the same family, evaluated by the same evaluator (no re-decision).
- `automation_runs` rows on health flips (`trigger_type = 'health_*'`) — the event stream for
  in-app notifications and the weekly digest's "newly flagged" section.
- `_health_recompute_items` / `_health_sweep` — the bounded-evaluation pattern the digest cron
  reuses.
- `ItemHealthBadge` and `filterItemsByHealth` — reusable in dashboard widgets.

## Open questions for review

1. **Should the rules ALSO write a literal "Delayed"/"At Risk" status option** (what the feedback
   text says verbatim)? Chosen **no**: destructive to workflow status and cannot self-clear; the
   flag is the canonical schema. Users who want status writes can already compose them today
   (`date_reached` + `set_option` recipe). Confirm with the requester
   (irdhina.harith@accenture.com) before resolving F5/F6.
2. **Downgrade sync directions** (status leaves Done → lower the percent to…what?; percent drops
   below 100 → un-Done to…which option?). Excluded — both require guessing a target value.
   Confirm.
3. **Sweep hour:** org-local **midnight** (chosen — flags are state, should flip at the day
   boundary) vs. 08:00 like the notification sweep. Confirm.
4. **Harden `items.health` against direct client UPDATE** via column-level grants? Deferred:
   grant surgery on `items` risks breaking existing item edits for marginal benefit (org-scoped,
   self-healing). Revisit if item 8 makes flags authorization-relevant.
5. **`health_due_soon` requires a percent column** (recipe gated on one existing). Alternative:
   treat boards without percent as "all incomplete items qualify". Chosen the stricter gate — the
   feedback's "<50% complete" presumes progress tracking. Confirm.
6. **`percent = 100` counts as complete** for the incomplete() guard even when status ≠ Done
   (chosen yes — matches feedback item "not Completed or below 100%").
7. **Default-on for new boards?** Chosen opt-in via recipes (consistent with every other
   automation). Confirm whether the requester expects these on by default.
