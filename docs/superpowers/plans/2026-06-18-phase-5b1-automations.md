# Phase 5b-1 Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the 5a in-DB automations engine with two new triggers (`item_created`, `person_assigned`) and an optional multi-condition AND/OR "If" gate, plus the builder UI to author them.

**Architecture:** Reactive Postgres triggers, no new infrastructure. The `automations.trigger` jsonb becomes a discriminated union on `type`; a new nullable `automations.condition` jsonb stores the "If" filter (D3b's `listFilterSchema` shape). A shared plpgsql `_automation_run` gates on the condition then runs the unchanged 5a notify/set_option loop; it is called from the existing `cell_values` trigger (status_changed + a new person_assigned branch) and a new `items` AFTER INSERT trigger (item_created). The condition is evaluated by an isolated `_automation_conditions_pass` helper that mirrors D3b's injection-safe predicate SQL bound to a single `item_id`.

**Tech Stack:** Next.js 16 / React 19, Supabase Postgres (plpgsql, RLS, SECURITY DEFINER), Zod, TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-18-phase-5b1-automations-design.md`

**Conventions (from 5a / AGENTS.md):**

- All schema via versioned migration files in `supabase/migrations/`. Applying to cloud needs **per-session authorization** (`supabase db push --linked`, or the Supabase MCP). Never `apply_migration` ad-hoc — the file is the source of truth.
- After a migration: `pnpm db:types` (then strip any PostHog telemetry line containing `"_tag"` before prettier), commit the regenerated `src/types/database.types.ts` in the same task.
- Every new plpgsql function: `language plpgsql ... set search_path = ''` (advisor parity).
- Done gate (Task 10): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all green + integration + e2e evidence.

---

## File Structure

| File                                                               | Change                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260618160000_automations_5b1_condition.sql` | **Create** — add `automations.condition` column + `item_created` partial index                                       |
| `supabase/migrations/20260618160001_automations_5b1_engine.sql`    | **Create** — predicate helper, conditions-pass, `_automation_run`, replace `tg_run_automations`, new `items` trigger |
| `src/types/database.types.ts`                                      | **Regenerate** — picks up `condition` column                                                                         |
| `src/lib/validations/automations.ts`                               | **Modify** — discriminated-union trigger; reuse `listFilterSchema` as condition; add `condition` to create/update    |
| `src/components/boards/automations/recipes.ts`                     | **Modify** — `Draft` gains `condition`; add `recipeItemCreatedSetOption`, `recipePersonAssignedNotify`               |
| `src/lib/boards/automation-actions.ts`                             | **Modify** — pass `condition` through create/update                                                                  |
| `src/components/boards/automations/AutomationBuilder.tsx`          | **Rewrite** — trigger-type selector, type-specific controls, "If" section (reuse `FilterBuilder`)                    |
| `src/components/boards/automations/AutomationsDialog.tsx`          | **Modify** — `summarize` handles union + condition clause; wire new recipes                                          |
| `src/components/boards/automations/AutomationBuilder.test.tsx`     | **Modify** — unit tests for new trigger types + condition construction                                               |
| `src/lib/validations/automations.test.ts`                          | **Create/Modify** — Zod union + condition tests                                                                      |
| `<existing automations integration test>.ts`                       | **Modify** — engine cases (item_created, person_assigned, condition gate, regressions)                               |
| `e2e/` automations spec                                            | **Modify** — item_created + person_assigned flows                                                                    |

---

## Task 1: Migration A — `condition` column + `item_created` index

**Files:**

- Create: `supabase/migrations/20260618160000_automations_5b1_condition.sql`
- Regenerate: `src/types/database.types.ts`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 5b-1: optional "If" condition gate + item_created trigger lookup index.
-- The `condition` jsonb mirrors the dashboards listFilter shape:
--   { "combinator": "and"|"or", "conditions": [ { columnId, operator, value } ] }
-- NULL or empty `conditions` ⇒ the rule always passes (no gate).
alter table public.automations
  add column condition jsonb;

-- item_created rules carry no columnId, so the existing
-- automations_trigger_col_idx does not serve them — add a dedicated partial index.
create index automations_item_created_idx
  on public.automations (board_id)
  where enabled and (trigger ->> 'type') = 'item_created';
```

- [ ] **Step 2: Apply to cloud** (requires authorization)

Run: `supabase db push --linked`
Expected: applies `20260618160000_automations_5b1_condition.sql` with no error.

- [ ] **Step 3: Regenerate + clean types**

Run: `pnpm db:types`
Then verify `src/types/database.types.ts` has `condition: Json | null` under the `automations` Row/Insert/Update types, and remove any stray line containing `"_tag"` (PostHog telemetry leak) if present.

- [ ] **Step 4: Verify column exists**

Run: `supabase db push --linked --dry-run` (expect "no changes") OR a quick check via MCP `execute_sql`: `select column_name from information_schema.columns where table_name='automations' and column_name='condition';`
Expected: one row.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260618160000_automations_5b1_condition.sql src/types/database.types.ts
git commit -m "feat(automations): add condition column + item_created index (5b-1)"
```

---

## Task 2: Zod — discriminated-union trigger + condition schema

**Files:**

- Modify: `src/lib/validations/automations.ts`
- Test: `src/lib/validations/automations.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  automationTriggerSchema,
  createAutomationSchema,
} from "@/lib/validations/automations";

const COL = "11111111-1111-1111-1111-111111111111";
const OPT = "22222222-2222-2222-2222-222222222222";

describe("automationTriggerSchema (5b-1 union)", () => {
  it("accepts status_changed", () => {
    expect(
      automationTriggerSchema.safeParse({
        type: "status_changed",
        columnId: COL,
        toOptionId: null,
      }).success,
    ).toBe(true);
  });

  it("accepts item_created with no extra fields", () => {
    expect(
      automationTriggerSchema.safeParse({ type: "item_created" }).success,
    ).toBe(true);
  });

  it("accepts person_assigned with a columnId", () => {
    expect(
      automationTriggerSchema.safeParse({
        type: "person_assigned",
        columnId: COL,
      }).success,
    ).toBe(true);
  });

  it("rejects person_assigned without a columnId", () => {
    expect(
      automationTriggerSchema.safeParse({ type: "person_assigned" }).success,
    ).toBe(false);
  });

  it("rejects an unknown trigger type", () => {
    expect(
      automationTriggerSchema.safeParse({ type: "nope", columnId: COL })
        .success,
    ).toBe(false);
  });
});

describe("createAutomationSchema condition", () => {
  const base = {
    boardId: COL,
    trigger: { type: "item_created" as const },
    actions: [{ type: "set_option" as const, columnId: COL, optionId: OPT }],
  };

  it("accepts an absent condition", () => {
    expect(createAutomationSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a multi-condition AND/OR filter", () => {
    expect(
      createAutomationSchema.safeParse({
        ...base,
        condition: {
          combinator: "or",
          conditions: [{ columnId: COL, operator: "is", value: OPT }],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid operator in a condition", () => {
    expect(
      createAutomationSchema.safeParse({
        ...base,
        condition: {
          combinator: "and",
          conditions: [{ columnId: COL, operator: "bogus", value: "x" }],
        },
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/validations/automations.test.ts`
Expected: FAIL (item_created/person_assigned rejected by the current `status_changed`-only literal; `condition` unknown).

- [ ] **Step 3: Rewrite the schema**

Replace the trigger schema and extend create/update in `src/lib/validations/automations.ts`:

```ts
import { z } from "zod";
import { listFilterSchema } from "@/lib/validations/dashboards";

export const automationTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status_changed"),
    columnId: z.string().uuid(),
    toOptionId: z.string().min(1).nullable(),
  }),
  z.object({
    type: z.literal("item_created"),
  }),
  z.object({
    type: z.literal("person_assigned"),
    columnId: z.string().uuid(),
  }),
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

const notifyRecipientSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("owner"), peopleColumnId: z.string().uuid() }),
  z.object({ kind: z.literal("member"), userId: z.string().uuid() }),
]);

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notify"), recipient: notifyRecipientSchema }),
  z.object({
    type: z.literal("set_option"),
    columnId: z.string().uuid(),
    optionId: z.string().min(1),
  }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const automationActionsSchema = z.array(automationActionSchema).min(1);

/** The optional "If" gate — reuses the dashboards D3b filter shape. */
export const automationConditionSchema = listFilterSchema;
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

export const createAutomationSchema = z.object({
  boardId: z.string().uuid(),
  name: z.string().trim().max(120).optional(),
  trigger: automationTriggerSchema,
  actions: automationActionsSchema,
  condition: automationConditionSchema.nullish(),
});

export const updateAutomationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional(),
  trigger: automationTriggerSchema.optional(),
  actions: automationActionsSchema.optional(),
  condition: automationConditionSchema.nullish(),
});

export const deleteAutomationSchema = z.object({ id: z.string().uuid() });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/validations/automations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/automations.ts src/lib/validations/automations.test.ts
git commit -m "feat(automations): discriminated-union trigger + condition schema (5b-1)"
```

---

## Task 3: Recipes — `Draft.condition` + two new recipes

**Files:**

- Modify: `src/components/boards/automations/recipes.ts`

- [ ] **Step 1: Write the failing test** (append to `src/components/boards/automations/AutomationBuilder.test.tsx`)

```ts
import {
  recipeItemCreatedSetOption,
  recipePersonAssignedNotify,
} from "@/components/boards/automations/recipes";

describe("5b-1 recipes", () => {
  it("recipeItemCreatedSetOption builds an item_created → set_option draft", () => {
    const d = recipeItemCreatedSetOption("col-1", "opt-1");
    expect(d.trigger).toEqual({ type: "item_created" });
    expect(d.actions).toEqual([
      { type: "set_option", columnId: "col-1", optionId: "opt-1" },
    ]);
  });

  it("recipePersonAssignedNotify builds a person_assigned → notify-owner draft", () => {
    const d = recipePersonAssignedNotify("people-1");
    expect(d.trigger).toEqual({
      type: "person_assigned",
      columnId: "people-1",
    });
    expect(d.actions).toEqual([
      {
        type: "notify",
        recipient: { kind: "owner", peopleColumnId: "people-1" },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Edit `recipes.ts`** — add the `ListFilter` import, extend `Draft`, append the two recipes (keep the existing `recipeNotifyOwner` / `recipeSetOption` unchanged):

```ts
import type {
  AutomationAction,
  AutomationTrigger,
} from "@/lib/validations/automations";
import type { ListFilter } from "@/lib/validations/dashboards";

export type Draft = {
  name?: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  condition?: ListFilter | null;
};

// ... existing recipeNotifyOwner / recipeSetOption unchanged ...

/** "When an item is created, set a status/dropdown column to Y." */
export function recipeItemCreatedSetOption(
  targetColumnId: string,
  toOptionId: string,
): Draft {
  return {
    trigger: { type: "item_created" },
    actions: [
      { type: "set_option", columnId: targetColumnId, optionId: toOptionId },
    ],
  };
}

/** "When someone is assigned in a People column, notify them (first assignee)." */
export function recipePersonAssignedNotify(peopleColumnId: string): Draft {
  return {
    trigger: { type: "person_assigned", columnId: peopleColumnId },
    actions: [{ type: "notify", recipient: { kind: "owner", peopleColumnId } }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: PASS for the recipe tests (builder tests updated in Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/automations/recipes.ts src/components/boards/automations/AutomationBuilder.test.tsx
git commit -m "feat(automations): Draft.condition + item_created/person_assigned recipes (5b-1)"
```

---

## Task 4: Server Actions — pass `condition` through create/update

**Files:**

- Modify: `src/lib/boards/automation-actions.ts`

- [ ] **Step 1: Edit `createAutomation`** — add `condition` to the input type and the insert payload:

In the input type:

```ts
export async function createAutomation(input: {
  boardId: string;
  name?: string;
  trigger: unknown;
  actions: unknown;
  condition?: unknown;
}): Promise<ActionResult<{ id: string }>> {
```

In the `.insert({ ... })` object (add the last field):

```ts
      created_by: user?.id ?? null,
      position: (nextPos?.position ?? -1) + 1,
      condition: (parsed.data.condition ?? null) as unknown as Json,
```

- [ ] **Step 2: Edit `updateAutomation`** — add `condition` to the input type and patch:

In the input type:

```ts
export async function updateAutomation(input: {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger?: unknown;
  actions?: unknown;
  condition?: unknown;
}): Promise<ActionResult> {
```

In the `patch` object (add to the spread chain):

```ts
    ...(parsed.data.condition !== undefined
      ? { condition: parsed.data.condition as unknown as Json }
      : {}),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (the regenerated types from Task 1 include `condition`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/automation-actions.ts
git commit -m "feat(automations): persist condition via create/update actions (5b-1)"
```

---

## Task 5: Migration B — engine (condition gate + new triggers)

**Files:**

- Create: `supabase/migrations/20260618160001_automations_5b1_engine.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 5b-1: engine — isolated condition predicate, condition gate, shared
-- action runner, person_assigned branch on cell_values, item_created on items.
-- All functions: SECURITY DEFINER, search_path='' (advisor parity).

-- 1) Build an injection-safe EXISTS/NOT EXISTS predicate for one condition,
--    bound to a specific item. Mirrors D3b's _dashboard_list_predicate but
--    isolated (no coupling to the shipped dashboards RPC).
create or replace function public._automation_condition_predicate(
  p_col uuid, p_op text, p_val text, p_item_id uuid
) returns text
language plpgsql immutable set search_path = '' as $$
declare
  e_open text := format(
    'exists(select 1 from public.cell_values cv where cv.item_id = %L and cv.column_id = %L and ',
    p_item_id, p_col
  );
  n_open text := format(
    'not exists(select 1 from public.cell_values cv where cv.item_id = %L and cv.column_id = %L and ',
    p_item_id, p_col
  );
begin
  -- malformed numeric/date values yield a guaranteed-false predicate
  if p_op in ('num_eq','num_ne','gt','lt')
     and (p_val is null or p_val !~ '^-?[0-9]+(\.[0-9]+)?$') then
    return 'false';
  end if;
  if p_op in ('before','after','on')
     and (p_val is null or p_val !~ '^\d{4}-\d{2}-\d{2}$') then
    return 'false';
  end if;

  return case p_op
    when 'is'        then e_open || format('cv.value->>''optionId'' = %L)', p_val)
    when 'is_not'    then e_open || format('cv.value->>''optionId'' is distinct from %L)', p_val)
    when 'contains'  then e_open || format('cv.value->>''text'' ilike %L)', '%' || coalesce(p_val,'') || '%')
    when 'eq'        then e_open || format('cv.value->>''text'' = %L)', p_val)
    when 'num_eq'    then e_open || format('(cv.value->>''n'')::numeric = %L::numeric)', p_val)
    when 'num_ne'    then e_open || format('(cv.value->>''n'')::numeric <> %L::numeric)', p_val)
    when 'gt'        then e_open || format('(cv.value->>''n'')::numeric > %L::numeric)', p_val)
    when 'lt'        then e_open || format('(cv.value->>''n'')::numeric < %L::numeric)', p_val)
    when 'before'    then e_open || format('(cv.value->>''date'')::date < %L::date)', p_val)
    when 'after'     then e_open || format('(cv.value->>''date'')::date > %L::date)', p_val)
    when 'on'        then e_open || format('(cv.value->>''date'')::date = %L::date)', p_val)
    when 'not_empty' then e_open || 'cv.value is not null)'
    when 'is_empty'  then n_open || 'cv.value is not null)'
    else 'false'
  end;
end; $$;

-- 2) Evaluate the whole condition jsonb against one item. NULL/empty ⇒ pass.
create or replace function public._automation_conditions_pass(
  p_condition jsonb, p_item_id uuid
) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_comb  text;
  v_preds text[] := '{}';
  c       jsonb;
  v_where text;
  v_pass  boolean;
begin
  if p_condition is null
     or jsonb_typeof(p_condition->'conditions') is distinct from 'array'
     or jsonb_array_length(p_condition->'conditions') = 0 then
    return true;
  end if;

  v_comb := case
    when lower(coalesce(p_condition->>'combinator','and')) = 'or' then 'or'
    else 'and'
  end;

  for c in select * from jsonb_array_elements(p_condition->'conditions')
  loop
    v_preds := array_append(
      v_preds,
      public._automation_condition_predicate(
        (c->>'columnId')::uuid,
        c->>'operator',
        c->>'value',
        p_item_id
      )
    );
  end loop;

  v_where := array_to_string(v_preds, ' ' || v_comb || ' ');
  execute 'select (' || v_where || ')' into v_pass;
  return coalesce(v_pass, false);
end; $$;

-- 3) Shared action runner: condition gate + the 5a notify/set_option loop.
create or replace function public._automation_run(
  p_automation_id uuid,
  p_actions jsonb,
  p_condition jsonb,
  p_item_id uuid,
  p_org_id uuid,
  p_board_id uuid,
  p_actor uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a        jsonb;
  v_rid    uuid;
  v_target uuid;
  v_opt    text;
begin
  if not public._automation_conditions_pass(p_condition, p_item_id) then
    return;
  end if;

  for a in select * from jsonb_array_elements(p_actions)
  loop
    if a->>'type' = 'notify' then
      if a#>>'{recipient,kind}' = 'member' then
        v_rid := (a#>>'{recipient,userId}')::uuid;
      else
        select (cv.value->'userIds'->>0)::uuid
          into v_rid
        from public.cell_values cv
        where cv.item_id = p_item_id
          and cv.column_id = (a#>>'{recipient,peopleColumnId}')::uuid;
      end if;

      if v_rid is not null and v_rid is distinct from p_actor then
        if not exists (
          select 1 from public.notifications n
          where n.recipient_id = v_rid
            and n.item_id = p_item_id
            and n.automation_id = p_automation_id
            and n.read_at is null
        ) then
          insert into public.notifications
            (org_id, recipient_id, actor_id, kind, board_id, item_id, automation_id)
          values
            (p_org_id, v_rid, p_actor, 'automation', p_board_id, p_item_id, p_automation_id);
        end if;
      end if;

    elsif a->>'type' = 'set_option' then
      v_target := (a->>'columnId')::uuid;
      v_opt := a->>'optionId';
      if not exists (
        select 1 from public.cell_values cv
        where cv.item_id = p_item_id
          and cv.column_id = v_target
          and cv.value->>'optionId' = v_opt
      ) then
        insert into public.cell_values (org_id, board_id, item_id, column_id, value)
        values (p_org_id, p_board_id, p_item_id, v_target,
                jsonb_build_object('optionId', v_opt))
        on conflict (item_id, column_id) do update set value = excluded.value;
      end if;
    end if;
  end loop;
end; $$;

-- 4) Replace the cell_values trigger: status_changed (5a) + person_assigned (new).
create or replace function public.tg_run_automations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_depth    int  := coalesce(nullif(current_setting('pulse.aut_depth', true), '')::int, 0);
  v_actor    uuid := (select auth.uid());
  v_new_opt  text := new.value->>'optionId';
  v_assigned boolean;
  r          record;
begin
  if (tg_op = 'UPDATE' and new.value is not distinct from old.value) then
    return new;
  end if;

  if v_depth >= 5 then
    return new;
  end if;
  perform set_config('pulse.aut_depth', (v_depth + 1)::text, true);

  -- True iff a People cell gained a userId (addition). Empty for non-people cells.
  v_assigned := exists (
    select 1
    from jsonb_array_elements_text(coalesce(new.value->'userIds', '[]'::jsonb)) nu(uid)
    where tg_op = 'INSERT'
       or not (coalesce(old.value->'userIds', '[]'::jsonb) ? nu.uid)
  );

  for r in
    select id, actions, condition
    from public.automations
    where board_id = new.board_id
      and enabled
      and trigger->>'columnId' = new.column_id::text
      and (
        (
          trigger->>'type' = 'status_changed'
          and (
            trigger->>'toOptionId' is null
            or trigger->>'toOptionId' = v_new_opt
            or (new.value ? 'optionIds'
                and (new.value->'optionIds') ? (trigger->>'toOptionId'))
          )
        )
        or (trigger->>'type' = 'person_assigned' and v_assigned)
      )
  loop
    perform public._automation_run(
      r.id, r.actions, r.condition, new.item_id, new.org_id, new.board_id, v_actor
    );
  end loop;

  return new;
end; $$;

-- 5) New items AFTER INSERT trigger for item_created rules.
create or replace function public.tg_run_item_automations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_depth int  := coalesce(nullif(current_setting('pulse.aut_depth', true), '')::int, 0);
  v_actor uuid := (select auth.uid());
  r       record;
begin
  if v_depth >= 5 then
    return new;
  end if;
  perform set_config('pulse.aut_depth', (v_depth + 1)::text, true);

  for r in
    select id, actions, condition
    from public.automations
    where board_id = new.board_id
      and enabled
      and trigger->>'type' = 'item_created'
  loop
    perform public._automation_run(
      r.id, r.actions, r.condition, new.id, new.org_id, new.board_id, v_actor
    );
  end loop;

  return new;
end; $$;

drop trigger if exists items_run_automations on public.items;
create trigger items_run_automations
  after insert on public.items
  for each row execute function public.tg_run_item_automations();
```

- [ ] **Step 2: Apply to cloud** (requires authorization)

Run: `supabase db push --linked`
Expected: applies `20260618160001_automations_5b1_engine.sql` with no error.

- [ ] **Step 3: Advisor parity check**

Verify (via Supabase MCP `get_advisors` if available, else inspect) that all five new/replaced functions report no `function_search_path_mutable` warning. All carry `set search_path = ''`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618160001_automations_5b1_engine.sql
git commit -m "feat(automations): engine — condition gate + item_created/person_assigned triggers (5b-1)"
```

---

## Task 6: Integration tests — engine behavior (cloud)

**Files:**

- Modify: the existing 5a automations integration test. Locate it first:

Run: `git ls-files | grep -i automation | grep -i integration`
(Likely `src/lib/boards/automations.rls.integration.test.ts` or similar — follow its existing fixture helpers for seeding org/board/columns/items/cells and the authed client.)

- [ ] **Step 1: Add the new engine cases** (mirror the existing suite's setup/teardown; each asserts via the same helpers):

Cases to add:

1. **item_created → set_option fires.** Create an `item_created` rule with `actions: [{set_option, columnId: status, optionId: working}]`. Insert a new item. Assert a `cell_values` row for `(item, status)` equals `{optionId: working}`.
2. **item_created → notify/member fires.** Rule with `notify/member` recipient. Insert item. Assert a notification (kind `automation`, automation_id) for that member.
3. **person_assigned fires on addition.** Rule `{type: person_assigned, columnId: people}` + `notify/owner(people)`. Upsert the people cell from `{userIds:[]}` to `{userIds:[U]}` (U ≠ actor). Assert a notification for U.
4. **person_assigned does NOT fire on removal / no-op.** From `{userIds:[U]}` to `{userIds:[]}` (removal) and an identical re-write (no-op): assert no new notification.
5. **condition gate — passes.** status_changed rule with `condition {combinator: and, conditions:[{columnId: priority(status), operator: is, value: high}]}`. Set the priority cell to `high`, then fire the trigger. Assert the action ran.
6. **condition gate — blocks.** Same rule, priority cell = `low`. Fire the trigger. Assert the action did NOT run.
7. **condition OR.** Two conditions joined `or`; one matches. Assert the action ran.
8. **condition over text/number/date.** One case each: `contains`/`gt`/`on` — matching and non-matching. Assert gate result.
9. **null/empty condition always passes.** Rule with `condition: null`. Fire. Assert the action ran (regression that the gate defaults open).
10. **Regression — 5a status_changed unchanged.** Existing 5a cases still green.
11. **Regression — loop-safety still caps.** Two rules whose `set_option`s feed each other terminate without error (depth cap), now also crossing the item_created path (item_created sets a status that a status_changed rule reacts to → bounded).
12. **Regression — disabled rules never fire** for the new trigger types; **cross-org isolation** for the new trigger types.

- [ ] **Step 2: Run the integration suite**

Run: `pnpm test -- <integration-test-path>` (needs cloud credentials in env, per the 5a pattern).
Expected: all new + existing cases PASS.

- [ ] **Step 3: Commit**

```bash
git add <integration-test-path>
git commit -m "test(automations): engine integration — item_created, person_assigned, condition gate (5b-1)"
```

---

## Task 7: AutomationBuilder — trigger-type selector + "If" section

**Files:**

- Rewrite: `src/components/boards/automations/AutomationBuilder.tsx`
- Modify: `src/components/boards/automations/AutomationBuilder.test.tsx`

- [ ] **Step 1: Write the failing tests** (extend the existing test file; these drive the new UI):

```tsx
// Helpers assumed from the existing test file: renderBuilder(columns, members, onSubmit), pickers.
// Add columns of kinds: status, people, text. members: [{userId:'u1',...}]

it("builds an item_created → set_option draft", async () => {
  const onSubmit = vi.fn();
  // render, select trigger type "Item is created", add a "Set a column" action,
  // pick the status column + an option, Save.
  // assert onSubmit called with trigger {type:'item_created'} and the set_option action.
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ trigger: { type: "item_created" } }),
  );
});

it("builds a person_assigned trigger from a People column", async () => {
  const onSubmit = vi.fn();
  // select "Person is assigned", pick the people column, add notify owner, Save.
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      trigger: { type: "person_assigned", columnId: expect.any(String) },
    }),
  );
});

it("attaches an If condition when one is added", async () => {
  const onSubmit = vi.fn();
  // status_changed trigger; reveal If; add a condition column=status op=is value=opt;
  // add notify action; Save.
  const arg = onSubmit.mock.calls[0][0];
  expect(arg.condition.conditions).toHaveLength(1);
});

it("omits the condition when none added", async () => {
  const onSubmit = vi.fn();
  // status_changed trigger + action only; Save.
  expect(onSubmit.mock.calls[0][0].condition).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: FAIL (no trigger-type selector / no If section).

- [ ] **Step 3: Rewrite `AutomationBuilder.tsx`** with this full content:

```tsx
"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FilterBuilder,
  type FilterColumn,
} from "@/components/dashboards/FilterBuilder";
import { valueControlFor } from "@/lib/dashboards/filter-meta";
import type { CacheColumn } from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";
import type { ListFilter, FilterCondition } from "@/lib/validations/dashboards";
import type {
  AutomationAction,
  AutomationTrigger,
} from "@/lib/validations/automations";
import type { Draft } from "@/components/boards/automations/recipes";

export type BuilderMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
};

/** Read the option list off a column's JSON settings (status/dropdown only). */
export function columnOptions(column: CacheColumn): ColumnOption[] {
  const settings = column.settings as { options?: ColumnOption[] } | null;
  return settings?.options ?? [];
}

const selectClass =
  "bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm";

const ANY = "__any__";
const CONDITION_KINDS = ["status", "text", "numbers", "date"];
type TriggerType = AutomationTrigger["type"];

type DraftAction = AutomationAction & { _id: string };

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `a${idCounter}`;
}
function withIds(actions: AutomationAction[]): DraftAction[] {
  return actions.map((a) => ({ ...a, _id: nextId() }));
}
function stripId(a: DraftAction): AutomationAction {
  const { _id, ...rest } = a;
  void _id;
  return rest;
}
function isActionComplete(a: AutomationAction): boolean {
  if (a.type === "notify") {
    return a.recipient.kind === "owner"
      ? !!a.recipient.peopleColumnId
      : !!a.recipient.userId;
  }
  return !!a.columnId && !!a.optionId;
}
function memberLabel(m: BuilderMember): string {
  return m.fullName ?? m.email ?? m.userId;
}
function isConditionComplete(c: FilterCondition, kind: string): boolean {
  if (valueControlFor(kind, c.operator) === "none") return true;
  return c.value !== undefined && c.value !== null && `${c.value}` !== "";
}

export function AutomationBuilder({
  columns,
  members,
  initial,
  onSubmit,
  onCancel,
}: {
  columns: CacheColumn[];
  members: BuilderMember[];
  initial?: Draft;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const statusColumns = columns.filter(
    (c) => c.kind === "status" || c.kind === "dropdown",
  );
  const peopleColumns = columns.filter((c) => c.kind === "people");
  const conditionColumns: FilterColumn[] = columns
    .filter((c) => CONDITION_KINDS.includes(c.kind))
    .map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      options: columnOptions(c),
    }));

  const it = initial?.trigger;
  const [triggerType, setTriggerType] = useState<TriggerType>(
    it?.type ?? (statusColumns[0] ? "status_changed" : "item_created"),
  );
  const [statusColId, setStatusColId] = useState<string>(
    it?.type === "status_changed" ? it.columnId : (statusColumns[0]?.id ?? ""),
  );
  const [statusOptId, setStatusOptId] = useState<string>(
    it?.type === "status_changed" ? (it.toOptionId ?? ANY) : ANY,
  );
  const [peopleColId, setPeopleColId] = useState<string>(
    it?.type === "person_assigned" ? it.columnId : (peopleColumns[0]?.id ?? ""),
  );
  const [actions, setActions] = useState<DraftAction[]>(() =>
    initial ? withIds(initial.actions) : [],
  );
  const [condition, setCondition] = useState<ListFilter>(() => ({
    combinator: initial?.condition?.combinator ?? "and",
    conditions: initial?.condition?.conditions ?? [],
  }));
  const [showCondition, setShowCondition] = useState<boolean>(
    () => (initial?.condition?.conditions?.length ?? 0) > 0,
  );

  const trigger: AutomationTrigger =
    triggerType === "status_changed"
      ? {
          type: "status_changed",
          columnId: statusColId,
          toOptionId: statusOptId === ANY ? null : statusOptId,
        }
      : triggerType === "person_assigned"
        ? { type: "person_assigned", columnId: peopleColId }
        : { type: "item_created" };

  const triggerValid =
    triggerType === "status_changed"
      ? !!statusColId
      : triggerType === "person_assigned"
        ? !!peopleColId
        : true;

  const valid =
    triggerValid && actions.length > 0 && actions.every(isActionComplete);

  const triggerColumn = statusColumns.find((c) => c.id === statusColId);
  const triggerOpts = triggerColumn ? columnOptions(triggerColumn) : [];

  function updateAction(id: string, next: AutomationAction) {
    setActions((prev) =>
      prev.map((a) => (a._id === id ? { ...next, _id: id } : a)),
    );
  }
  function removeAction(id: string) {
    setActions((prev) => prev.filter((a) => a._id !== id));
  }
  function addNotify() {
    setActions((prev) => [
      ...prev,
      {
        _id: nextId(),
        type: "notify",
        recipient: {
          kind: "owner",
          peopleColumnId: peopleColumns[0]?.id ?? "",
        },
      },
    ]);
  }
  function addSetOption() {
    setActions((prev) => [
      ...prev,
      { _id: nextId(), type: "set_option", columnId: "", optionId: "" },
    ]);
  }

  function submit() {
    if (!valid) return;
    const cleaned = condition.conditions.filter((c) => {
      const col = columns.find((x) => x.id === c.columnId);
      return col && isConditionComplete(c, col.kind);
    });
    const cond =
      showCondition && cleaned.length > 0
        ? { combinator: condition.combinator ?? "and", conditions: cleaned }
        : undefined;
    onSubmit({ trigger, actions: actions.map(stripId), condition: cond });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* When */}
      <fieldset className="bg-surface flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium">
          When
        </legend>
        <label className="text-sm">
          <span className="text-muted-foreground">Trigger</span>
          <select
            aria-label="Trigger type"
            className={selectClass}
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value as TriggerType)}
          >
            <option value="status_changed">A status or dropdown changes</option>
            <option value="item_created">An item is created</option>
            <option value="person_assigned">A person is assigned</option>
          </select>
        </label>

        {triggerType === "status_changed" ? (
          statusColumns.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add a Status or Dropdown column to use this trigger.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="text-muted-foreground">Column</span>
                <select
                  aria-label="Trigger column"
                  className={selectClass}
                  value={statusColId}
                  onChange={(e) => {
                    setStatusColId(e.target.value);
                    setStatusOptId(ANY);
                  }}
                >
                  {statusColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Changes to</span>
                <select
                  aria-label="Trigger value"
                  className={selectClass}
                  value={statusOptId}
                  onChange={(e) => setStatusOptId(e.target.value)}
                >
                  <option value={ANY}>Any value</option>
                  {triggerOpts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )
        ) : null}

        {triggerType === "person_assigned" ? (
          peopleColumns.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add a People column to use this trigger.
            </p>
          ) : (
            <label className="text-sm">
              <span className="text-muted-foreground">People column</span>
              <select
                aria-label="People column"
                className={selectClass}
                value={peopleColId}
                onChange={(e) => setPeopleColId(e.target.value)}
              >
                {peopleColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : null}

        {triggerType === "item_created" ? (
          <p className="text-muted-foreground text-sm">
            Runs when a new item is added. Tip: cells are empty at creation —
            pair with “Set a column”.
          </p>
        ) : null}
      </fieldset>

      {/* If (optional) */}
      <fieldset className="bg-surface flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium">
          If (optional)
        </legend>
        {conditionColumns.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Add a status, text, number, or date column to filter.
          </p>
        ) : showCondition ? (
          <>
            <FilterBuilder
              columns={conditionColumns}
              value={condition}
              onChange={setCondition}
            />
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCondition(false);
                  setCondition({ combinator: "and", conditions: [] });
                }}
              >
                Remove condition
              </Button>
            </div>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCondition(true)}
          >
            <Plus className="size-3.5" /> Add condition
          </Button>
        )}
      </fieldset>

      {/* Then */}
      <fieldset className="bg-surface flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium">
          Then
        </legend>

        {actions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Add at least one action.
          </p>
        ) : (
          actions.map((action) => (
            <div
              key={action._id}
              className="flex items-start gap-2 rounded-md border p-2"
            >
              <div className="grid flex-1 grid-cols-2 gap-2">
                {action.type === "notify" ? (
                  <NotifyRow
                    action={action}
                    peopleColumns={peopleColumns}
                    members={members}
                    onChange={(next) => updateAction(action._id, next)}
                  />
                ) : (
                  <SetOptionRow
                    action={action}
                    statusColumns={statusColumns}
                    onChange={(next) => updateAction(action._id, next)}
                  />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove action"
                onClick={() => removeAction(action._id)}
              >
                <Trash2 className="text-muted-foreground size-3.5" />
              </Button>
            </div>
          ))
        )}

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addNotify}>
            <Plus className="size-3.5" /> Notify
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSetOption}
          >
            <Plus className="size-3.5" /> Set a column
          </Button>
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!valid}>
          Save
        </Button>
      </div>
    </div>
  );
}
```

Keep the existing `NotifyRow` and `SetOptionRow` function components **unchanged** at the bottom of the file (copy them verbatim from the current file).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: PASS. (Adjust any test helper that previously assumed the status-only "When" layout — the column picker now lives under the `status_changed` branch.)

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/automations/AutomationBuilder.tsx src/components/boards/automations/AutomationBuilder.test.tsx
git commit -m "feat(automations): builder trigger-type selector + If condition section (5b-1)"
```

---

## Task 8: AutomationsDialog — union summary + new recipes

**Files:**

- Modify: `src/components/boards/automations/AutomationsDialog.tsx`

- [ ] **Step 1: Replace `summarize` to handle the union + condition clause.** Add a `ListFilter` import and an `OPERATOR_LABEL` import:

```ts
import { OPERATOR_LABEL } from "@/lib/dashboards/filter-meta";
import type { ListFilter } from "@/lib/validations/dashboards";
```

Replace `summarize`:

```ts
function condClause(
  condition: ListFilter | null,
  columns: CacheColumn[],
): string {
  if (!condition?.conditions?.length) return "";
  const parts = condition.conditions.map((c) => {
    const name = colName(columns, c.columnId);
    const op = OPERATOR_LABEL[c.operator] ?? c.operator;
    const val =
      c.value == null || `${c.value}` === ""
        ? ""
        : ` ${optName(columns, c.columnId, String(c.value))}`;
    return `${name} ${op}${val}`;
  });
  const joiner = condition.combinator === "or" ? " or " : " and ";
  return ` if ${parts.join(joiner)}`;
}

function summarize(
  rule: Automation,
  columns: CacheColumn[],
  members: BuilderMember[],
): string {
  const trigger = rule.trigger as unknown as AutomationTrigger;
  const actions = rule.actions as unknown as AutomationAction[];
  const condition = rule.condition as unknown as ListFilter | null;

  let when: string;
  if (trigger.type === "item_created") {
    when = "When an item is created";
  } else if (trigger.type === "person_assigned") {
    when = `When someone is assigned in ${colName(columns, trigger.columnId)}`;
  } else {
    when =
      trigger.toOptionId == null
        ? `When ${colName(columns, trigger.columnId)} changes`
        : `When ${colName(columns, trigger.columnId)} changes to ${optName(
            columns,
            trigger.columnId,
            trigger.toOptionId,
          )}`;
  }

  const thens = actions.map((a) => {
    if (a.type === "notify") {
      return a.recipient.kind === "owner"
        ? `notify the owner (${colName(columns, a.recipient.peopleColumnId)})`
        : `notify ${memberName(members, a.recipient.userId)}`;
    }
    return `set ${colName(columns, a.columnId)} to ${optName(
      columns,
      a.columnId,
      a.optionId,
    )}`;
  });

  return `${when}${condClause(condition, columns)}, ${thens.join(" and ")}.`;
}
```

- [ ] **Step 2: Wire the two new recipes.** Update the recipes import and the quick-start section.

Import:

```ts
import {
  recipeNotifyOwner,
  recipeSetOption,
  recipeItemCreatedSetOption,
  recipePersonAssignedNotify,
  type Draft,
} from "@/components/boards/automations/recipes";
```

In the recipe quick-start block (alongside the existing `canNotifyOwner` / `canSetOption` buttons), add:

```tsx
{
  statusColumns.length > 0 ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        const target = statusColumns[0];
        const toOpt = columnOptions(target)[0]?.id ?? "";
        startBuild(recipeItemCreatedSetOption(target.id, toOpt));
      }}
    >
      Set a column when an item is created
    </Button>
  ) : null;
}
{
  peopleColumns.length > 0 ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        startBuild(recipePersonAssignedNotify(peopleColumns[0].id))
      }
    >
      Notify on assignment
    </Button>
  ) : null;
}
```

Also broaden the `(canNotifyOwner || canSetOption)` guard around the recipe block to include the new cases:

```tsx
{(canNotifyOwner || canSetOption || statusColumns.length > 0 || peopleColumns.length > 0) && !initialDraft ? (
```

- [ ] **Step 3: Update the dialog description** (optional polish) to reflect the broader trigger set:

```tsx
<DialogDescription>
  Run actions automatically when items change, are created, or are assigned.
</DialogDescription>
```

- [ ] **Step 4: Typecheck + run unit tests**

Run: `pnpm typecheck && pnpm test -- src/components/boards/automations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/automations/AutomationsDialog.tsx
git commit -m "feat(automations): dialog summary for union triggers + condition; new recipes (5b-1)"
```

---

## Task 9: e2e — item_created + person_assigned flows

**Files:**

- Modify: the existing automations Playwright spec (locate via `git ls-files e2e | grep -i automation`).

- [ ] **Step 1: Add two scenarios** following the existing spec's auth/seed pattern:

1. **item_created → set_option:** open Automations → New automation → Trigger "An item is created" → add "Set a column" → pick a status column + option → Save. Add a new item to the board. Assert the new item's status cell shows the chosen option.
2. **person_assigned → notify:** create the "Notify on assignment" recipe → Save. As user A, assign user B to the People column of an item. Switch to user B; assert the inbox bell shows an unread automation notification.

- [ ] **Step 2: Run e2e**

Run: `pnpm test:e2e -- <automations-spec>` (or the project's e2e command)
Expected: both scenarios PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e
git commit -m "test(automations): e2e item_created + person_assigned (5b-1)"
```

---

## Task 10: Done gate + advisors

- [ ] **Step 1: Full gate**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 2: Advisors clean**

Confirm Supabase advisors report no new warnings (esp. `function_search_path_mutable`) for the five new/replaced functions.

- [ ] **Step 3: Final commit (if any lint/format drift)**

```bash
git add -A
git commit -m "chore(automations): 5b-1 gate green (typecheck/lint/test/build)"
```

- [ ] **Step 4: Push**

Run: `git push origin develop`

---

## Self-Review

**Spec coverage:**

- §2 trigger union → Task 2 (Zod) + Task 5 (engine matching) + Task 7 (builder). ✓
- §2 `condition` column + item_created index → Task 1. ✓
- §3 shared `_automation_run`, `_automation_conditions_pass`, isolated predicate, person_assigned branch, items trigger → Task 5. ✓
- §3 depth-cap / gotcha-17 GUC fix preserved → Task 5 (`nullif(current_setting(...), '')`). ✓
- §4 actions condition passthrough, no new actions → Task 4. ✓
- §4 builder trigger-type selector + If section + recipes → Tasks 3, 7, 8. ✓
- §6 integration + unit + e2e → Tasks 2, 3, 6, 7, 9. ✓
- §7 budget (bounded read, client-state builder, indexed engine lookups) → preserved (no unbounded reads added); item_created partial index in Task 1. ✓
- §7 schema discipline (migrations, db:types, advisors, search_path) → Tasks 1, 5, 10. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code or an exact targeted edit. Integration/e2e tasks name the case list explicitly and instruct locating the existing fixture file (intentional — those tests are coupled to existing seed helpers).

**Type consistency:** `Draft.condition?: ListFilter | null` (Task 3) matches `createAutomation` passing `condition` (Task 4) and the builder emitting `condition` (Task 7) and Zod `automationConditionSchema = listFilterSchema` (Task 2). `_automation_run` signature is identical at definition (Task 5 step 3) and both call sites (Task 5 steps 4–5). `AutomationTrigger` union members are identical across Zod (Task 2), builder (Task 7), and summary (Task 8).

**Deferred (per spec non-goals):** date-based triggers (5b-2), new action types, multi-assignee fan-out, dropdown/people conditions, predicate-helper DRY consolidation.
