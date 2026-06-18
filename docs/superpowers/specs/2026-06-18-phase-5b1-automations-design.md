---
type: spec
status: approved
date: 2026-06-18
phase: 5b-1
title: Automations — more triggers + the "If" condition (Phase 5b-1)
tags: [project/pulse, spec, phase-5, automations]
related:
  - "[[2026-06-18-phase-5a-automations-design]]"
  - "[[2026-06-14-pulse-design]]"
  - "[[00-north-star]]"
---

# Phase 5b-1 — Automations: more triggers + the "If" condition

## 1. Goal & context

Phase 5 (master spec §7, PRD F-9) is no-code **When / If / Then** automations. Phase **5a**
shipped the smallest safe in-DB engine: a `status_changed` trigger → notify / set_option actions,
with a per-board guided builder. This slice (**5b-1**) extends that engine along two axes the 5a
spec deferred, **without leaving the reactive, in-DB execution model** (no new infrastructure):

- **Two new triggers:** `item_created` and `person_assigned` — both ride the existing in-DB
  trigger spine.
- **The "If" condition step** — turning "When/Then" into real "When/**If**/Then". A rule can carry
  an optional multi-condition (flat AND/OR) filter that gates whether its actions run.

**Phase 5b decomposition** (decided 2026-06-18):

- **5b-1 (this spec):** `item_created` + `person_assigned` triggers + the "If" condition. All
  in-DB; no scheduler; testable on the live cloud DB exactly like 5a.
- **5b-2 (next spec):** **date-based** triggers ("when date arrives / is in N days"). These need a
  scheduler — there is currently no `pg_cron`, no `pg_net`, no Edge Functions, and no Vercel deploy
  — so they are a genuinely new subsystem (extension + scheduling + a once-only run-ledger) and get
  their own spec.

**Non-goals for 5b-1:** date-based / scheduled triggers (→ 5b-2); external/HTTP actions, Edge
Functions, run-history/audit (→ 5c); new **action** types (set any column kind, move group, post
update — deferred); multi-assignee notify fan-out and dropdown "option removed" / multi-option
**triggers** (deferred); dropdown/people **condition** matching (deferred, mirrors D3b which also
defers them); realtime on the rules list itself.

## 2. Data model

The `automations` table (5a) is reused. Two changes:

**(a) `trigger` jsonb becomes a discriminated union on `type`** (no DDL — jsonb; the Zod layer is
the integrity guard):

| `type`                    | shape                            | fires when                                                   |
| ------------------------- | -------------------------------- | ------------------------------------------------------------ |
| `status_changed` _(5a)_   | `{ columnId, toOptionId\|null }` | a status/dropdown cell changes (unchanged from 5a)           |
| `item_created` _(new)_    | `{}` (type only)                 | a new item row is inserted on the board                      |
| `person_assigned` _(new)_ | `{ columnId }`                   | the People cell at `columnId` **gains** a user (an addition) |

- `status_changed`: unchanged — `toOptionId: null` = any change; otherwise the option must match
  (`optionId` for status, membership of `optionIds` for dropdown).
- `person_assigned`: `columnId` must be a **people** column on the board. Fires only when a userId
  is **newly present** (on UPDATE: some id in `new.value->'userIds'` is absent from
  `old.value->'userIds'`; on INSERT: the cell has ≥1 userId). Removals and no-op writes do not
  fire.
- `item_created`: no column. **Ordering caveat (documented):** an item row is inserted _before_ its
  cells, so at fire time People cells and most condition cells are typically empty. `item_created`
  therefore pairs well with **`set_option`** (which creates the cell — e.g. "set Status → Working")
  and **`notify/member`** (fixed recipient); **`notify/owner` and cell-conditions will usually be
  empty at creation** and effectively no-op. The builder steers the recipe toward `set_option`.

**(b) New nullable `condition` column** (`jsonb`, default `null`) on `automations` — the optional
"If" step. Shape **reuses D3b's filter** verbatim:

```
{ "combinator": "and" | "or", "conditions": [ { "columnId": "<uuid>", "operator": "<op>", "value": <string|number|null> } ] }
```

`null` or an empty `conditions` array ⇒ the rule **always passes** (no gate). Operators are D3b's
`operatorsForKind` set over **status / text / numbers / date** columns; dropdown/people conditions
are deferred (same as D3b).

**Indexes:** add a partial index for the item-created lookup:
`automations_item_created_idx on automations (board_id) where enabled and trigger->>'type' = 'item_created'`.
The existing `automations_trigger_col_idx on (board_id, (trigger->>'columnId')) where enabled`
continues to serve `status_changed` and `person_assigned` (both carry `columnId`).

RLS is unchanged (org-scoped, `is_org_member` + `board_in_org`, mirrors 5a/`columns`).

## 3. Execution engine (Postgres, in-DB)

5a's engine is extended, **keeping the depth-cap loop guard** (`pulse.aut_depth`, max 5, read via
`nullif(current_setting(...), '')` — the gotcha-17 empty-string GUC fix is preserved). All new
functions are `language plpgsql security definer set search_path = ''`.

**Shared action-runner** — extract `public._automation_run(p_automation_id, p_actions, p_condition,
p_item_id, p_org_id, p_board_id, p_actor)` (or equivalent signature) that:

1. **Condition gate:** `if not _automation_conditions_pass(p_condition, p_item_id) then return; end if;`
2. Runs the existing **notify / set_option** action loop (5a logic, verbatim — owner = first
   `userIds[0]`; member = fixed userId; self-actor excluded; unread-dupe guard for notify;
   skip-if-equal for set_option).

Both trigger entry points below call this per matched rule, so the action/condition logic lives in
one place.

**Condition gate** — `public._automation_conditions_pass(p_condition jsonb, p_item_id uuid) returns
boolean`:

- `null` condition or empty `conditions` ⇒ return `true`.
- For each condition, build an `EXISTS(select 1 from public.cell_values cv where cv.item_id =
<p_item_id> and cv.column_id = <columnId> and <operator-predicate>)` fragment, join fragments
  with the `combinator` (`and`/`or`), and `execute 'select ' || v_where into v_pass`.
- The operator→SQL mapping mirrors D3b's `_dashboard_list_predicate` (status `is`/`is_not`, text
  `contains`/`eq`, numbers `num_eq`/`num_ne`/`gt`/`lt`, date `before`/`after`/`on`, `is_empty`/
  `not_empty`), **injection-safe** via `format(%L)` with numeric/date cast guards (malformed →
  `false`). **Decision (§1.3 of brainstorm):** this is a **new, isolated helper**
  (`_automation_condition_predicate`) that copies the mapping rather than coupling to the shipped
  D3b RPC — zero blast radius on D3b. DRY consolidation into one shared predicate helper is a
  deferred cleanup.

**Trigger paths:**

1. **`cell_values` trigger** (existing `tg_run_automations`, `after insert or update on
cell_values for each row`): keeps the no-op guard + depth guard. Matching is extended:
   - `status_changed` rules — as in 5a.
   - `person_assigned` rules — `trigger->>'columnId' = new.column_id::text`,
     `trigger->>'type' = 'person_assigned'`, and the people cell **gained** a userId (compare
     `new.value->'userIds'` vs `old.value->'userIds'`; on INSERT any non-empty counts).
   - For each matched rule, call `_automation_run(...)`.

2. **`items` trigger** (new `tg_run_item_automations`, `after insert on items for each row`):
   depth guard; select enabled `item_created` rules for `new.board_id`; call `_automation_run(...)`
   per rule. (No `items` AFTER INSERT trigger exists today — this is the first.)

`set_option` actions continue to re-enter the `cell_values` trigger at `depth+1`, bounded by the
cap. Legitimate chaining (rule A's set_option satisfies rule B) still works; runaway cascades are
still capped.

## 4. Server Actions + client

**Server Actions** (`src/lib/boards/automation-actions.ts`) — **no new actions**;
`createAutomation` / `updateAutomation` gain an optional `condition` passthrough (Zod-validated,
org/board derived server-side, RLS-guarded). `getAutomations` / `listAutomations` are unchanged
(`select *` returns the new `condition` column once types are regenerated).

**Validation** (`src/lib/validations/automations.ts`):

- `automationTriggerSchema` → `z.discriminatedUnion("type", [...])`:
  - `status_changed`: `{ type, columnId, toOptionId: string|null }` (existing fields).
  - `item_created`: `{ type }`.
  - `person_assigned`: `{ type, columnId }`.
- `automationConditionSchema` → **reuse** `filterConditionSchema` + combinator from
  `src/lib/validations/dashboards.ts` (DRY at the Zod layer; the SQL stays isolated per §3).
  Optional; `null`/empty allowed.
- `createAutomationSchema` / `updateAutomationSchema` gain optional `condition`.

**Client:**

- `AutomationBuilder` gains a **trigger-type selector** as its first control —
  "**When** [ Status changes ▾ | Item is created | Person is assigned ]" — rendering type-specific
  controls beneath: status_changed → column + option pickers (as today); item_created → none;
  person_assigned → People-column picker.
- A new **"If" section** between When and Then: an optional, **collapsed-by-default** reuse of
  D3b's **`FilterBuilder`** ("If _(optional)_ → + Add condition" reveals AND/OR rows). Columns
  offered = status / text / numbers / date. The **Then** action list (notify / set_option) is
  unchanged.
- `AutomationsDialog` sentence summaries extended to render the new trigger types and an "… if …"
  clause.
- **Recipes** — keep 5a's; add two: "When **item created**, set Status → _(pick)_" (ordering-safe)
  and "When **person assigned**, notify them" (notify/owner = first assignee).

Only status/dropdown columns appear in `set_option`/status pickers; only People columns in the
`person_assigned` picker and owner recipient; condition columns are status/text/numbers/date.

## 5. Realtime

No new wiring. `set_option` writes flow through the existing `cell_values` Realtime subscription;
`notify` inserts flow through the per-user `notifications` Realtime → inbox bell. `item_created`
actions emit the same downstream writes and reconcile the same way. The rules list stays
optimistic-update + refetch-on-open (concurrent rule editing is rare).

## 6. Testing

- **Integration (cloud RLS + engine; extend the existing `*.rls.integration.test.ts` suite):**
  - `item_created` fires → `set_option` sets a default cell; `notify/member` delivers.
  - `person_assigned` fires on a user **addition**; does **not** fire on removal or an unrelated
    people-cell write.
  - **If condition** gates: passes when met / blocks when not, across `and` + `or`, over
    status/text/number/date operators; `null`/empty condition always passes.
  - **Regressions:** 5a `status_changed` unchanged; loop-safety depth cap still terminates;
    disabled rules never fire; cross-org isolation; RLS denies cross-org CRUD on `automations`.
- **Unit:** discriminated-union trigger schema (valid + invalid per type); condition schema; the
  builder's JSON construction per trigger type and with/without a condition; recipe prefills;
  sentence-summary rendering.
- **e2e (Playwright):** build "When item created → set Status" with an If condition; create an item;
  assert the target cell updates / is gated. Build "When person assigned → notify"; assign a user;
  assert an inbox notification appears.

## 7. Non-functional

- **Performance & data-fetching budget:** the dialog loads the board's **bounded** rule list in
  **one** query on open (unchanged). The builder (including the If section) is **pure client
  state** — 0 new server round-trips on in-page interaction. Create / update / delete change
  **server data** → Server Actions + targeted TanStack cache update (NOT `<Link>`/router nav, so no
  RSC re-run). Engine: item-insert adds one **indexed** lookup (partial index on `item_created`
  rules); the `cell_values` path adds the `person_assigned` branch to the existing indexed match;
  condition eval is one dynamic `select` against `cell_values` by **PK (`item_id`)** — bounded, no
  scans. No unbounded `select *`.
- **Security:** RLS is the boundary — `automations` default-deny, org-scoped; every new function is
  `SECURITY DEFINER` with `search_path=''`; actions write only within the firing row's
  `org_id`/`board_id`; `auth.uid()` is the notification actor. Condition predicates are
  injection-safe (`format(%L)` + numeric/date cast guards; malformed → `false`).
- **Schema discipline:** all changes via versioned migrations in `supabase/migrations/`; after
  applying, regenerate `src/types/database.types.ts` (`pnpm db:types`, filtering the PostHog
  telemetry line) and run advisors; **pin `search_path`** on every new function (advisor parity).
- **Done gate:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all green + the
  integration/e2e evidence in §6, before any completion claim.

## 8. Risks / notes

- **`item_created` ordering** (item row before cells) is the headline footgun. Mitigation: document
  it, steer the recipe to `set_option`, and accept that `notify/owner` + cell-conditions at
  creation are usually empty. Tested explicitly (set_option works; owner-at-create no-ops).
- **Cascade safety** is preserved by the unchanged depth cap; re-tested via a chain that crosses the
  new triggers (item_created → set_option → status_changed rule).
- **`person_assigned` addition semantics** (gain a user, not any people-cell write) is the subtle
  bit — tested for addition / removal / no-op.
- **Predicate duplication** (§3): a deliberate isolation choice over DRY; flagged as deferred
  consolidation, not an oversight.
- **Migrations:** (1) add `automations.condition` column + the `item_created` partial index;
  (2) the engine migration — `_automation_condition_predicate`, `_automation_conditions_pass`,
  `_automation_run`, the `person_assigned` branch on `tg_run_automations`, and the new
  `tg_run_item_automations` + its `after insert on items` trigger. Keep jsonb shapes open so 5b-2
  (date triggers) and 5c (external actions) extend without further `automations` DDL.
