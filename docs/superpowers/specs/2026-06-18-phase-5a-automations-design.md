---
type: spec
status: approved
date: 2026-06-18
phase: 5a
title: Automations + Rules — engine + lean When/Then (Phase 5a)
tags: [project/pulse, spec, phase-5, automations]
related:
  - "[[2026-06-14-pulse-design]]"
  - "[[00-north-star]]"
---

# Phase 5a — Automations engine + lean When/Then

## 1. Goal & context

Phase 5 (master spec §7, PRD F-9) is no-code **When/If/Then** automations on a board, backed by
Postgres triggers (+ Edge Functions later). The PRD's open risk: "how much rule complexity to
expose without becoming feature-soup." This slice (**5a**) ships the smallest engine that is
genuinely useful and safe: a **Postgres-native, in-DB** rule engine plus a per-board builder, with
a deliberately lean trigger/action menu. Later slices expand it.

**Decomposition of Phase 5:**

- **5a (this spec):** in-DB engine + `automations` storage + a Status/Dropdown-change trigger →
  notify-person + set-Status/Dropdown actions + per-board builder dialog with recipe quick-starts.
- **5b (later):** more triggers (item created, person assigned, date-based), more actions
  (set any column kind, move group, post update), the optional "If" condition step.
- **5c (later):** external actions via Edge Functions (webhooks/Slack), run history/audit.

**Non-goals for 5a:** Edge Functions; external/HTTP actions; the "If" condition step; triggers
other than status/dropdown change; actions other than notify + set-option; a run-history/audit log;
realtime on the rules list itself.

## 2. Data model

New table `automations` — follows the existing `columns`/`groups` RLS + denormalization pattern.

| Column       | Type                          | Notes                                                    |
| ------------ | ----------------------------- | -------------------------------------------------------- |
| `id`         | uuid pk                       | `gen_random_uuid()`                                      |
| `org_id`     | uuid not null                 | denormalized for RLS + trigger guards                    |
| `board_id`   | uuid not null                 | references `boards(id)` on delete cascade                |
| `name`       | text                          | optional label; UI derives a default sentence when blank |
| `enabled`    | boolean not null default true |                                                          |
| `trigger`    | jsonb not null                | see shape below                                          |
| `actions`    | jsonb not null                | array; see shape below                                   |
| `created_by` | uuid                          | `auth.uid()` at insert                                   |
| `position`   | int not null default 0        | rule ordering within a board                             |
| `created_at` | timestamptz default now()     |                                                          |
| `updated_at` | timestamptz default now()     |                                                          |

Indexes: `(board_id, position)` for listing; `(org_id)` for RLS. A partial/expression index to
speed trigger lookup by triggering column — `(board_id, (trigger->>'columnId')) where enabled`.

**`trigger` shape (5a — one type):**

```
{ "type": "status_changed", "columnId": "<uuid>", "toOptionId": "<uuid>" | null }
```

`toOptionId: null` = fires on any value change of that column. The column must be a `status` or
`dropdown` column on the board.

**`actions` shape (5a — array, chainable, two types):**

```
{ "type": "notify", "recipient": { "kind": "owner", "peopleColumnId": "<uuid>" } }
{ "type": "notify", "recipient": { "kind": "member", "userId": "<uuid>" } }
{ "type": "set_option", "columnId": "<uuid>", "optionId": "<uuid>" }
```

- `notify`/`owner`: recipient is the first user in the item's People column `peopleColumnId`
  (`value->'userIds'->>0`); if empty, the action no-ops for that item.
- `notify`/`member`: a fixed org member chosen in the builder.
- `set_option`: set target status/dropdown column to `optionId`.

Zod schemas (`src/lib/validations/automations.ts`) validate trigger + actions at every Server
Action boundary. RLS: org-scoped select/insert/update/delete for org members; writes additionally
require the `board_id` to resolve to the caller's org (reuse the existing board-in-org guard
helper used by `columns`/`groups`).

`notification_kind` enum gains a new value `'automation'` (enum-extend migration). The notification
row for an automation carries `board_id` + `item_id` and (where applicable) a reference to the rule
via a new nullable `automation_id` column on `notifications` (FK, on delete set null) so the inbox
can label/deep-link it.

## 3. Execution engine (Postgres, in-DB)

One trigger function `tg_run_automations()` — `language plpgsql security definer set search_path =
''`, attached `after insert or update on public.cell_values for each row`.

Algorithm:

1. **No-op guard:** on UPDATE, if `new.value is not distinct from old.value`, return early.
2. **Depth guard (loop safety):** read `current_setting('pulse.aut_depth', true)`; if `null` treat
   as 0. If `depth >= 5`, return early (cascade cap reached). Otherwise
   `perform set_config('pulse.aut_depth', (depth+1)::text, true)` before performing actions, so
   nested cell writes from `set_option` inherit the incremented depth within the transaction.
3. **Match rules:** select enabled `automations` for `new.board_id` where
   `trigger->>'columnId' = new.column_id::text` and the trigger value matches:
   - status: `new.value->>'optionId'` equals `trigger->>'toOptionId'`, OR `trigger->>'toOptionId'`
     is null (any change).
   - dropdown: `trigger->>'toOptionId'` is null, OR it appears in `new.value->'optionIds'`.
4. **Run actions** in array order for each matched rule:
   - `notify`: resolve recipient (owner → first userId of the item's `peopleColumnId` cell; member
     → `userId`). Skip if unresolved or equals the actor (`auth.uid()`). De-dupe: don't insert a
     duplicate unread automation notification for the same `(recipient, item, automation)` within
     the same statement. Insert into `notifications` (kind `'automation'`, `automation_id`,
     `board_id`, `item_id`, `actor_id = auth.uid()`).
   - `set_option`: if the target cell already equals the desired `{optionId}`, skip; else upsert
     `cell_values` for `(item_id, target columnId)` with `{ "optionId": <optionId> }`. This write
     re-enters the trigger at `depth+1`, bounded by step 2.

Rationale for the depth cap over an "automation-origin" flag: a cap permits legitimate chains
(rule A sets a status that rule B reacts to) while still bounding runaway cascades; an origin flag
would block all chaining.

## 4. Server Actions + client

**Server Actions** — `src/lib/boards/automation-actions.ts` (`"use server"`; mutations only;
Zod-validated; org/board derived server-side; RLS-guarded):

- `listAutomations(boardId)` — board's rules ordered by `position` (read; used by the dialog).
- `createAutomation(boardId, { name?, trigger, actions })` — insert at next position.
- `updateAutomation(id, patch)` — toggle `enabled`, rename, or replace `trigger`/`actions`.
- `deleteAutomation(id)`.

**Client:**

- A board-header **"Automations"** button opens `AutomationsDialog` (client). It lists the board's
  rules as sentence summaries with an **enable/disable** toggle and **delete** (both optimistic via
  the existing TanStack-Query patterns), and a **`+ New automation`** entry.
- `AutomationBuilder` (client) — a **guided sentence builder**:
  "**When** [status/dropdown column ▾] **changes to** [option ▾ | _any value_] **, then**" followed
  by a chainable action list: **notify** [owner | member ▾] and/or **set** [status/dropdown column
  ▾] **to** [option ▾]. "+ Add action" appends; each action removable. Builds the `trigger`/`actions`
  JSON validated by the shared Zod schema before submit.
- **Recipe quick-starts:** 3 prefilled templates that populate the builder, e.g. "When Status → Done,
  notify owner", "When Status → Stuck, notify owner", "When Status → Done, set [pick] → [pick]".
  (Recipes are pure client-side prefills over the same builder; no separate storage.)

Only status/dropdown columns appear in the trigger/`set_option` pickers; only People columns appear
for the owner recipient. If a board has no status/dropdown column, the builder explains that a
status column is required.

## 5. Realtime

No new realtime wiring. Automation `set_option` writes flow through the existing `cell_values`
Realtime subscription (`use-board-realtime.ts`) → open board clients reconcile and re-render.
Automation `notify` inserts flow through the existing per-user `notifications` Realtime → the inbox
bell updates. The `automations` rules list is not realtime in 5a (concurrent rule editing is rare);
the dialog uses optimistic updates + refetch on open.

## 6. Testing

- **Integration (cloud RLS, pattern of `*.rls.integration.test.ts`):**
  - rule with `toOptionId` set fires only on that option; `null` fires on any change.
  - `notify/owner` inserts a notification for the item's owner; `notify/member` for the chosen user;
    self-actor excluded; unresolved owner no-ops.
  - `set_option` sets the target cell; skips when already equal.
  - **loop safety:** two rules that set each other's columns terminate (depth cap), no error, bounded
    writes.
  - disabled rules never fire; cross-org isolation (a rule in org A never touches org B); RLS denies
    cross-org CRUD on `automations`.
- **Unit:** Zod trigger/actions schema (valid + invalid shapes); the builder's JSON construction and
  the recipe prefills; any pure resolution helpers.
- **e2e (Playwright):** open Automations dialog, build "When Status → Done, notify owner" + a
  `set_option`, save; change an item's status to Done; assert the target cell updates and an inbox
  notification appears; toggle the rule off and confirm it no longer fires.

## 7. Non-functional

- **Performance & data-fetching budget:** the dialog loads the board's **bounded** rule list
  (indexed `(board_id, position)`) in **one** query on open. Enable/disable, edit, delete, and
  create change **server data** → Server Actions + targeted cache update (NOT `<Link>`/router
  navigation, so no RSC re-run). The builder is pure **client state**. Trigger evaluation is in-DB
  with an indexed lookup per cell change (expression index on `(board_id, trigger->>'columnId')
where enabled`). No unbounded `select *`.
- **Security:** RLS is the boundary — `automations` default-deny, org-scoped; the trigger is
  `SECURITY DEFINER` with `search_path=''` (the proven pattern); actions write only within the
  triggering row's `org_id`/`board_id`. `auth.uid()` is the actor for notifications.
- **Schema discipline:** all changes via a versioned migration in `supabase/migrations/`; after
  applying, regenerate `src/types/database.types.ts` (`pnpm db:types`, filtering the PostHog
  telemetry line) and run advisors; pin `search_path` on the new function (advisor parity).
- **Done gate:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all green + the
  integration/e2e evidence above, before any completion claim.

## 8. Risks / notes

- **Cascade safety** is the headline risk; the depth cap (§3) is the mitigation, explicitly tested.
- **Dropdown semantics:** 5a treats a dropdown trigger as "the option is now present" (added).
  Removal-triggers and multi-option conditions are deferred to 5b.
- **Owner ambiguity:** "owner" = first user in the chosen People column; multi-assignee fan-out is
  deferred (5b can notify all assignees).
- Keeping `trigger`/`actions` as jsonb (not normalized child tables) matches `columns.settings`,
  keeps the engine readable in plpgsql, and lets 5b/5c extend shapes without migrations. The Zod
  layer is the integrity guard at write time.
