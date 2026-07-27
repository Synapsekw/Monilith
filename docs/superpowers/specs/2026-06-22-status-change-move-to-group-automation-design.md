# Automation action: move item to a group on status change

**Date:** 2026-06-22
**Status:** Approved (design) — ready for implementation plan
**Scope:** Add a `move_to_group` automation action so a rule like "When status changes to Done,
move the item to the Done group" works end to end.

## Summary

Monolith already has a complete automation engine: `automations` / `automation_runs` tables, a
`status_changed` trigger, an optional condition gate, run-history recording, and Supabase Realtime
propagation of `items.group_id` changes. The existing action types are `notify`, `set_option`, and
`call_webhook`.

This feature adds **one new action type**, `move_to_group`, to the three layers that already follow
a clear per-action pattern: the Zod validation union, the Postgres action runner, and the builder
UI. No new tables, enums, or generated types.

**Out of scope (deferred):** moving an item to a *different board*. That requires a column/cell
remapping policy (target board has different columns and status options) and is explicitly a later
phase. This spec is **same-board, group-to-group only**.

## Why this is safe and small

- Updating `items.group_id` fires **no** automation triggers: the `cell_values` trigger
  (`tg_run_automations`) only watches cell changes, and the items trigger
  (`tg_run_item_automations`) only fires `AFTER INSERT`. So a move cannot cascade. The existing
  depth-5 guard (`pulse.aut_depth`) backstops it regardless.
- The move runs inside the same transaction as the triggering status change — atomic.
- Realtime already subscribes to `items` changes filtered by `board_id`, and the client cache
  already reconciles `group_id` updates. Other clients see the move with no new code.

## Architecture / components

### 1. Validation — `src/lib/validations/automations.ts`

Add a case to the `automationActionSchema` discriminated union:

```ts
z.object({ type: z.literal("move_to_group"), groupId: z.string().uuid() })
```

`AutomationAction` (the inferred type) gains the new variant automatically. `automationActionsSchema`
and the create/update schemas need no other change.

### 2. Engine — new migration, `CREATE OR REPLACE FUNCTION public._automation_run(...)`

Add a branch to the action loop, mirroring the existing `set_option` branch. The move is a single
guarded `UPDATE`:

```sql
elsif a->>'type' = 'move_to_group' then
  v_group := (a->>'groupId')::uuid;
  update public.items i
     set group_id = v_group,
         position = coalesce(
           (select max(i2.position) from public.items i2
             where i2.group_id = v_group and i2.parent_id is null),
           0
         ) + 1
   where i.id = p_item_id
     and i.parent_id is null                       -- top-level items only
     and i.group_id is distinct from v_group       -- no-op if already there
     and exists (                                  -- same-board guard
       select 1 from public.groups g
        where g.id = v_group and g.board_id = p_board_id
     );
```

Guarantees:

- **Top-level only** — subitems (`parent_id is not null`) are ignored; their group belongs to the
  parent.
- **No-op when already in the target group** — avoids needless Realtime churn.
- **Stale / cross-board `groupId` → safe no-op** — the `exists` guard. If the target group was
  deleted, or somehow references another board, nothing happens (no error).
- **Placement** — appended to the bottom of the target group (`max(position) + 1`), consistent with
  how new items are created (`midpoint(last, null)`).

The function keeps `security definer set search_path = ''`. The migration only replaces a function
body — **no table/enum change, so `database.types.ts` is untouched and `pnpm db:types` is not run.**

> Implementation note: confirm the exact `position` step convention against
> `src/lib/boards/position.ts` (`midpoint`) and the `set_option` branch in
> `supabase/migrations/20260618160001_automations_5b1_engine.sql` when writing the migration. The
> `max(position) + 1` shown above is the intent (append to end); match the repo's float8 ordering
> convention.

### 3. Builder UI — `src/components/boards/automations/AutomationBuilder.tsx`

- A `MoveToGroupRow` component: a single labelled `<select>` of the board's groups (id → name),
  following the `SetOptionRow` pattern.
- An `addMoveToGroup()` helper and a "Move to group" button in the "Then" action toolbar.
- A `move_to_group` case in `isActionComplete` (`!!a.groupId`).
- A `move_to_group` branch in the action-row render switch.

The builder needs the group list. Thread a `groups` prop (id + name; `CacheGroup[]` or a slimmed
shape) through the call chain:

`BoardHeader` → `AutomationsDialog` → `AutomationBuilder`.

`BoardHeader` does not currently receive `groups`; add it to its props and pass from the board page
where the board cache (which already holds `groups`) is in scope.

### 4. Dialog summary + recipe

- `summarize()` in `AutomationsDialog.tsx` gains a `move_to_group` clause: "…move to
  **{group name}**" (resolve the name from the threaded groups; fall back to a generic label if the
  group was deleted).
- Add `recipeStatusChangedMoveToGroup(statusColumnId, optionId, groupId)` to `recipes.ts` so the
  common "When status → Done, move to the Done group" is a one-click recipe.

## Data flow

1. User edits a status cell → `upsertCell` writes `cell_values` (unchanged path).
2. `tg_run_automations` matches enabled `status_changed` rules on that column, evaluates the optional
   condition, and calls `_automation_run`.
3. `_automation_run` hits the new `move_to_group` branch → `UPDATE items SET group_id, position`.
4. The `items` UPDATE replicates via Realtime (`board:<id>` channel, `board_id=eq` filter) → other
   clients' caches reconcile the moved item into the new group.
5. `automation_runs` records the run with its actions payload (existing behavior).

## Error handling / edge cases

| Case                          | Behavior                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| Item already in target group  | No-op (guard) — no Realtime churn                             |
| Target group deleted / stale  | No-op (`exists` guard) — no error                            |
| Target group on another board | No-op (`exists` checks `board_id = p_board_id`)              |
| Subitem (`parent_id` set)     | Ignored (guard)                                              |
| Condition gate fails          | Whole run returns early (existing `_automation_conditions_pass`) |
| Cascade risk                  | None — `items` UPDATE fires no automation triggers; depth guard backstops |

## Performance & data-fetching budget

- **First paint:** unchanged. The feature adds no page-load cost.
- **Builder interaction:** **0 new server round-trips** — the group `<select>` reads the
  already-loaded board cache. Adding an action is local React state.
- **Runtime:** the move is one indexed `UPDATE` by primary key inside the existing trigger
  transaction; no new hot-path read.
- **Migration:** function-body replace only; no type regen.

## Testing

Follow existing patterns (`automations.engine.5b1.integration.test.ts`, `validations/automations.test.ts`,
`AutomationBuilder.test.tsx`, `AutomationsDialog.test.tsx`).

1. **Validation** — `move_to_group` parses with a valid uuid; rejects missing/invalid `groupId`.
2. **Engine integration** (DB):
   - Status change to the configured option → item's `group_id` updates to the target group.
   - Condition gate respected (no move when condition fails).
   - No-op when the item is already in the target group.
   - No-op when `groupId` belongs to another board / does not exist.
   - Subitem is not moved.
   - Trigger `toOptionId = null` (any change) also moves.
3. **Builder UI** — add a "Move to group" action, pick a group, action becomes complete; submit
   produces a `move_to_group` action in the draft.
4. **Summary** — `summarize()` renders "…move to {group name}".

Gates (run per the worktree caveats — integration tests need the symlinked `.env.local`; build in
the main checkout): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Execution DAG

- **T1 — Validation + recipe** (`automations.ts`, `recipes.ts`) — S. No deps.
- **T2 — Engine migration** (`_automation_run` branch + integration tests) — S/M. No deps.
- **T3 — Builder UI + plumbing** (`AutomationBuilder.tsx`, `AutomationsDialog.tsx`,
  `BoardHeader.tsx` + board page groups prop, UI tests) — M. Depends on **T1** (uses the new action
  type / `AutomationAction` variant).

**Batches:** Batch A = {T1, T2} (disjoint footprints, parallel). Batch B = {T3} (after T1).
**Critical path:** T1 → T3.

## Manual test walkthrough (post-merge)

1. Pull `develop`, open a board with a Status column and at least two groups.
2. Open the board's **Automations** dialog → **Add automation**.
3. Set trigger: *When a status changes* → pick the Status column → *Changes to* → **Done**.
4. Add action: **Move to group** → pick the target group (e.g. "Done"). Save.
5. On the board, change an item's status to **Done**.
6. **Expected:** the item moves into the target group (bottom), live, and appears for other open
   clients without refresh. The run shows in **Recent runs**.
7. Negative check: change a status to a value other than Done → item does **not** move.
