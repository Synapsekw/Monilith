# Status intelligence (descoped) — overdue date tint + Completed⇔100% sync — design

- **Date:** 2026-07-03 (rescoped same day by product decision — see "Descoped by product
  decision" at the end)
- **Status:** Spec rewritten to reduced scope, awaiting review
- **Branch:** `task/status-intelligence`
- **Feature items:** the surviving slice of MVP Final Features item **9**
  (`docs/superpowers/plans/2026-07-03-mvp-final-features.md`). Item 4 (dependency At-Risk
  propagation) and all At-Risk rules are **descoped entirely** — out of this feature, not
  deferred inside it.
- **Mode:** Non-interactive brainstorm — decisions recorded in "Open questions for review".

## Problem (reduced scope)

Two user requests survive (feedback F6 + the "Delayed" half of F5.6):

1. **Delayed visual** — an item that is past its due date and not complete should _read_ as
   delayed. Per product decision this is a **purely derived, render-time visual**: a red tint on
   the item's **due-date cell** in the Table view. No schema, no rules engine, no persistence,
   no badge component, no filters.
2. **Completed ⇔ 100% sync** (explicit in F6) — marking an item Completed sets % complete to
   100, and reaching 100% marks the item Completed. Kept in minimal form, loop-guarded, shipped
   as per-board automation recipes (vocabulary-aware, toggleable like every other automation).

## Verified context (explored in this worktree)

- **Item data is EAV:** `items` has no built-in status/date/percent columns. Status vocabulary =
  `columns.settings.options` (`{ id, label, color }`, **no done flag** — the seeded vocabulary is
  "Working on it / Stuck / Done"). Dates are `{ date, end? }` jsonb on `date` columns; percent is
  `{ percent: 0..100 }` on `percent` columns. Date resolution helpers live in
  `src/lib/boards/dates.ts` (end falls back to start; ISO `YYYY-MM-DD` string comparison is the
  house pattern).
- **The board payload already contains everything needed:** `getBoardPayload` loads all
  `columns` + `cell_values` for the board and hydrates the client cache
  (`src/lib/boards/cache.ts`); table cells render via `BoardTable.tsx` → `EditableCell` →
  `CellRenderer` (`src/components/boards/cells/index.tsx`), with item + cell context in scope at
  the row-render site. The item panel (`item-panel/ItemPanel.tsx`) renders the same fields with
  the same context.
- **Automations engine (Phase 5):** `tg_run_automations` (AFTER trigger on `cell_values`)
  matches rules by `trigger->>'columnId'` and type; `_automation_run` executes actions with
  idempotent writes (`skipped_equal`) and a transaction-local depth guard (`pulse.aut_depth`,
  bail at ≥5). Existing action `set_option` already writes status options. Recipes are
  code-defined draft factories in `src/components/boards/automations/recipes.ts`, surfaced with
  per-rule enable toggles in `AutomationsDialog`.

## Design

### 1. Overdue date tint (client-side, render-time)

**Definition — an item is _overdue_ when:**

- its date cell's due value `coalesce(value.end, value.date)` is **strictly before the viewer's
  local today** (ISO string comparison; due _today_ is not overdue), AND
- the item is **incomplete**.

**Completeness definition (the one simple rule, stated):** an item is _complete_ iff the value
of the board's **first `status` column** is an option whose **label matches
`/done|complete/i`**. Boards with no status column, items with an empty status cell, or
vocabularies with no done-like label ⇒ incomplete. Rationale: there is no done flag or board
config to consult (zero-schema constraint), every board seeds a "Done" option, and this matches
the recipe-prefill heuristic already used elsewhere in the app. Percent is deliberately **not**
part of the definition — one signal, no ambiguity, and the Completed⇔100% sync (part 2) keeps
status and percent aligned on boards that care.

**Scope of application:** every `date`-kind cell of an incomplete item whose due value is past
gets the tint — no column-name heuristics ("Due" vs "Kickoff"); one rule, applied uniformly.
(Open question 2 records the alternative.)

**Timezone:** compare against the **viewer's local today** computed client-side
(`new Date()` → local `YYYY-MM-DD`), consistent with the per-user timezone stance already in the
repo (profiles carry a timezone; the board table is a client surface). Two viewers in different
timezones may briefly disagree at day boundaries — accepted, it's a visual.

**Rendering (pulse-ui):** the date cell content gets `bg-destructive/10 text-destructive
rounded-md` — `destructive` is a sanctioned semantic token for danger, theme-aware in light/dark,
and distinct from the status palette (this is cell state, not a status label). Color is not the
sole carrier: the tinted cell carries `aria-label`/`title` "Overdue" (AA / colorblind rule). No
icon, no badge, no layout shift.

**Surfaces:** the Table view date cell (required); the item panel's date field gets the same
class + label **only because it is nearly free** (same helper, same context in scope). No other
surface (kanban meta, calendar, gantt) in this slice.

**Implementation shape:** one pure helper module `src/lib/boards/overdue.ts`:

- `localTodayISO(now?: Date): string`
- `isItemComplete(itemId, columns, cellValues): boolean` (first status column + label regex)
- `isOverdue(dateValue, todayISO): boolean` (due = `end ?? date`, strict `<`)

computed at the row-render site (item + cache in scope) and passed into the date cell renderer
as a boolean prop. Memoization rides the existing row render; no effects, no state, no fetches.

### 2. Completed ⇔ 100% sync (minimal engine extension)

Kept from the original design — the smallest change that covers direct edits, spreadsheet
imports, and automation-driven writes alike, because it lives at the engine level (the
`cell_values` AFTER trigger fires for every write path):

- **New trigger `percent_reached { columnId: uuid, percent: int (default 100) }`** — matched in
  `tg_run_automations` on `percent`-cell writes that **cross** the threshold
  (`new >= t AND (old missing OR old < t)`). Crossing semantics prevent re-fires.
- **New action `set_percent { columnId: uuid, percent: int (0..100) }`** — a branch in
  `_automation_run` writing `{ "percent": n }` with the same `skipped_equal` idempotence as
  `set_option`.

Shipped as two recipes (per-board, vocabulary-aware — the user picks the done option):

- **"Completed sets 100%":** trigger `status_changed { statusCol, toOptionId: doneOpt }` →
  action `set_percent { percentCol, 100 }`.
- **"100% sets Completed":** trigger `percent_reached { percentCol, 100 }` → action
  `set_option { statusCol, doneOpt }` (existing action — no new code).

**Loop guard, traced:** status → Done ⇒ recipe A writes percent = 100 ⇒ `percent_reached` fires
recipe B ⇒ `set_option` finds status already Done ⇒ `skipped_equal`, chain ends at depth 2 of 5.
Reverse direction symmetric via `set_percent`'s skip. `pulse.aut_depth` remains the hard
backstop. An integration test pins both directions and termination.

**Simpler alternatives considered and rejected:** a hard-coded DB trigger (loses per-board
opt-in and custom done vocabularies); client-side sync in the cell editors (misses spreadsheet
import and automation writes — the explicit coverage requirement). The engine extension is
already the minimal form: one migration, two small Zod members, two recipes.

## Performance & data-fetching budget (working agreement #5)

**(a) First paint vs. interaction:** **0 new server round-trips anywhere.** The overdue tint is
a pure function of `columns` + `cell_values` already in the board payload; today's date comes
from the client clock. No interaction is added (no filter, no toggle). The two recipes ride the
existing automations dialog reads.

**(b) Server data vs. client state:** the tint is render-time client derivation — nothing is
persisted, so nothing to invalidate. The sync recipes are ordinary Server-Action-managed
automation rows; their effects are engine-side cell writes that echo through the existing
realtime channel.

**(c) Bounded, indexed:** no new reads at all. Engine-side, `percent_reached` matching adds one
predicate to the existing per-write rule scan (already indexed by
`automations_trigger_col_idx (board_id, trigger->>'columnId') where enabled`); `set_percent` is
one PK upsert. No cron, no sweep, no new indexes, no schema.

## Security

- No schema, no RLS changes, no new client-callable functions. The migration only
  `create or replace`s the two existing SECURITY DEFINER engine functions
  (`search_path = ''` conventions preserved).
- The tint reveals nothing the viewer's RLS-scoped payload doesn't already contain.

## Testing strategy

- **Unit (Vitest):** `overdue.ts` — completeness (done label match, case-insensitivity, no
  status column, empty cell, "Completed" label), due-value fallback (`end ?? date`), strict
  before-today boundary (yesterday true / today false / tomorrow false), `localTodayISO`.
  Cell-render tests: tinted class + "Overdue" label present for an overdue incomplete item;
  absent for done items and future dates. Zod: new trigger/action members parse + bound checks.
  Recipes: drafts round-trip `createAutomationSchema`.
- **Integration (serial project, engine-test conventions):** both sync directions; loop
  termination (run history shows `skipped_equal`, no depth exhaustion); no re-fire on a
  non-crossing percent rewrite (100→100).

## Independent units (for the plan's Execution DAG)

- **U1** Migration: `percent_reached` + `set_percent` (user applies manually).
- **U2** Zod members + two recipe factories (pure TS).
- **U3** Builder sentences + recipe buttons (after U2).
- **U4** Overdue helper + table/panel tint (pure client — parallel with everything).
- **U5** Sync integration tests (after U1 applied + U2).

## Impact on item 8 (health summary + alerts)

The goal plan's edge **9 → 8** assumed persisted health flags from this feature. Those are now
descoped: **item 8 can no longer consume `items.health` from item 9** and must source its
"flagged/structurally incomplete" signal itself (its spec re-opens that decision — the descoped
design below is the recorded starting point). What item 8 CAN still reuse from this slice:
`isItemComplete`/`isOverdue` (`src/lib/boards/overdue.ts`) as the shared completeness/overdue
predicates, and the `percent_reached`/`set_percent` engine vocabulary.

## Descoped by product decision (2026-07-03)

The original combined design (items 4 + 9) was judged too heavy and is descoped. Recorded so the
thinking isn't lost (full detail in this file's git history, commit `591c986`):

- **Computed health flag:** `items.health ('at_risk'|'delayed') + health_reasons jsonb`,
  written only by a SECURITY DEFINER evaluator; self-clearing (level-based, recomputed from
  current state); partial index `items_board_health_idx`; rode the existing items payload +
  realtime channel.
- **Rules as automations rows:** a `health_overdue` / `health_due_soon` / `health_dependency`
  trigger family + `set_health` action, per-board toggleable in the existing dialog, with
  explicit `statusColumnId + doneOptionIds` config (portfolios `done_option_ids` precedent) for
  custom vocabularies; three recipes with column/done-option guessing.
- **Evaluation:** set-based `_health_recompute_items` fired by cell/dependency AFTER triggers
  (indexed fast-bail for rule-less boards; a predecessor date change recomputed immediate
  successors — the single-hop At-Risk propagation of item 4) plus an org-local-midnight pg_cron
  sweep over a bounded `[today−1, today+withinDays]` window on a new `cell_values_due_idx`;
  `recompute_board_health` RPC for enable/disable backfill; `automation_runs` rows on flips as
  the item-8 event stream.
- **UI:** `ItemHealthBadge` (yellow/red pill) in table/kanban/panel, Gantt name-rail badge +
  bar ring, and an All/At-risk/Delayed filter chip (client state + History API).

Why it was heavy: 2 migrations incl. a ~400-line evaluator, a new trigger family across
SQL/Zod/builder UI, a cron job, and 4 UI surfaces — versus the shipped need: "overdue should
look overdue" + the F6 sync.

## Open questions for review

1. **Completeness = done-label regex on the first status column.** Zero-schema forces a
   heuristic; `/done|complete/i` matches the seeded vocabulary. Boards that rename Done to
   something else (e.g. "Shipped") won't tint-suppress completed items. Acceptable for a visual?
   (The alternative — percent = 100 — covers only boards with percent columns.)
2. **Tint applies to every date column**, not just due-like ones. A past "Kickoff" date on an
   unfinished item also tints. Alternative: restrict to columns named
   `/due|end|finish|target|deadline/i`. Chosen the uniform rule for predictability; confirm.
3. **Viewer-local today** (client clock) vs. org timezone for the day boundary. Chosen
   viewer-local — it's a per-viewer visual; confirm.
4. **Item panel tint included** (nearly free). Drop if it turns out not to be.
5. **Downgrade sync directions** (status leaves Done → lower percent; percent drops below 100 →
   un-Done) remain excluded — both require guessing a target value. Confirm.
