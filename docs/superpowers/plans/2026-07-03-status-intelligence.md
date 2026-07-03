# Status Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-03-status-intelligence-design.md` — read it first. It
holds the central decision (health = computed self-clearing flag on `items`, rules = `health_*`
automations rows evaluated by a dedicated level-based evaluator; Completed⇔100% = edge
automations via new `percent_reached` trigger + `set_percent` action), the predicate semantics,
and the decisions taken.

**Goal:** Auto-flag items as **Delayed** (past due, incomplete) or **At Risk** (due soon +
low progress, or an immediate predecessor's dates slipped), self-clearing, per-board toggleable
via automation recipes, surfaced as a badge in table/kanban/panel/Gantt with a client-side
health filter — plus a loop-safe Completed⇔100% two-way sync.

**Architecture:** One migration adds `items.health`/`health_reasons` + a SECURITY DEFINER
evaluator (`_health_recompute_items/_board`, cell/dependency triggers, org-local-midnight pg*cron
sweep) that reads enabled `health*\*` automations rows as declarative rule config. A second
migration extends the existing engine (`tg_run_automations`, `\_automation_run`) with
`percent_reached`/`set_percent`. TypeScript work is Zod unions, recipe factories, builder/dialog
UI, badge + cache plumbing, and a History-API filter chip.

**Tech Stack:** Postgres (plpgsql, pg_cron), Supabase RLS, Next.js 16 App Router (RSC + Server
Actions), Zod, Vitest (+ serial integration project), pulse-ui tokens.

## Global Constraints

- **Migrations are applied to cloud dev MANUALLY BY THE USER** (the agent's classifier blocks
  `db push`/DDL — see memory note "migration apply blocked by classifier"). Task 4 is a hard
  user gate: write files → user applies → agent verifies → `pnpm db:types` → commit types.
- Never hand-edit `src/types/database.types.ts` — regen with `pnpm db:types` only.
- All new SQL functions: `security definer set search_path = ''`, fully-qualified table names —
  match the engine conventions in `20260619100000_automations_5c1_run_history.sql`.
- Health values: exactly `'at_risk' | 'delayed'`; reason codes exactly
  `'overdue' | 'due_soon' | 'dependency'`. Severity: `delayed` > `at_risk`.
- Rule-config field names (Zod ⇄ SQL contract, verbatim): `dateColumnId`, `startColumnId`,
  `endColumnId`, `statusColumnId`, `doneOptionIds`, `percentColumnId`, `withinDays` (default 3),
  `belowPercent` (default 50), `percent` (default 100), `health`.
- Date comparisons in SQL are **text comparisons** of ISO `YYYY-MM-DD` strings (the proven
  5b2 pattern — no cast errors on malformed jsonb).
- In-page interactions (filter chip) are client state + `window.history.replaceState` — never a
  router navigation (gotcha-09). Mutations are Server Actions.
- UI uses pulse-ui semantic tokens only; At risk = `bg-status-yellow`, Delayed = `bg-status-red`;
  color always paired with text/icon.
- No `any`; validate at boundaries with Zod. Commit subjects lowercase after `type(scope):`,
  descriptive body, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, stage by path.
- Gates before finish: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (cold-typecheck
  cacheLife gotcha: run `pnpm build` first if `.next/types` is missing).

---

## File structure

| File                                                                                  | Task | Responsibility                                              |
| ------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------- |
| `supabase/migrations/20260703090000_status_intelligence_health.sql`                   | 1    | health columns, indexes, evaluator, triggers, sweep, RPC    |
| `supabase/migrations/20260703091000_automations_percent_sync.sql`                     | 2    | `percent_reached` trigger match + `set_percent` action      |
| `src/lib/validations/automations.ts` (+ `.test.ts`)                                   | 3    | new trigger/action Zod members                              |
| `src/components/boards/automations/recipes.ts` (+ `.test.ts`)                         | 3    | 5 new recipe factories                                      |
| `src/types/database.types.ts`                                                         | 4    | regenerated (items.health / health_reasons)                 |
| `src/lib/boards/automation-actions.ts` (+ `.test.ts`)                                 | 5    | `recompute_board_health` RPC call on health-rule writes     |
| `src/components/boards/automations/AutomationBuilder.tsx`                             | 6    | sentences/pickers for new trigger & action types            |
| `src/components/boards/automations/AutomationsDialog.tsx`                             | 6    | recipe buttons + availability gating                        |
| `src/components/boards/ItemHealthBadge.tsx` (+ `.test.tsx`)                           | 7    | the badge (pill + icon-only variants)                       |
| `src/lib/boards/cache.ts`, `src/lib/boards/queries.ts`                                | 7    | `health`/`health_reasons` on CacheItem/payload (types-only) |
| `src/lib/boards/realtime-buffer.test.ts`                                              | 7    | pin item-UPDATE fold preserves health                       |
| `src/components/boards/BoardTable.tsx`, `KanbanBoard.tsx`, `item-panel/ItemPanel.tsx` | 7    | badge attachment                                            |
| `src/components/boards/GanttBoard.tsx` (+ test)                                       | 8    | name-rail badge + bar ring                                  |
| `src/lib/boards/health-filter.ts` (+ `.test.ts`)                                      | 9    | `filterItemsByHealth`                                       |
| `src/components/boards/BoardViews.tsx` (+ toolbar component it uses)                  | 9    | filter chip + `?health=` History API sync                   |
| `src/lib/boards/health.integration.test.ts`                                           | 10   | evaluator behavior end-to-end                               |
| `src/lib/boards/automations.percent-sync.integration.test.ts`                         | 10   | sync recipes + loop guard                                   |

---

### Task 1: Migration — health schema + evaluator + triggers + sweep

**Files:**

- Create: `supabase/migrations/20260703090000_status_intelligence_health.sql`

**Interfaces:**

- Consumes: existing tables `items`, `cell_values`, `automations`, `item_dependencies`,
  `automation_runs`, `organizations.timezone`; helper `public.is_org_member(uuid)`; pg_cron.
- Produces (exact names later tasks and item 8 rely on):
  - Columns `public.items.health text` (check `in ('at_risk','delayed')`, nullable),
    `public.items.health_reasons jsonb not null default '[]'`.
  - Indexes `items_board_health_idx`, `cell_values_due_idx`, `automations_health_idx`.
  - Functions `public._health_recompute_items(p_board_id uuid, p_item_ids uuid[])`,
    `public._health_recompute_board(p_board_id uuid)`,
    `public._health_sweep(p_now timestamptz default now())`.
  - RPC `public.recompute_board_health(p_board_id uuid)` (granted to `authenticated`).
  - Triggers `cell_values_health_recompute` (AFTER INSERT OR UPDATE OR DELETE on `cell_values`),
    `item_dependencies_health_recompute` (AFTER INSERT OR DELETE on `item_dependencies`).
  - Cron job `health-sweep` (`'15 * * * *'`).

- [ ] **Step 1: Write the migration**

The full file (structure below is complete; keep the section comments):

```sql
-- Status intelligence: computed item health (at_risk | delayed), evaluated from
-- enabled `health_*` automation rules. Spec:
-- docs/superpowers/specs/2026-07-03-status-intelligence-design.md
-- Health is a level-based, self-clearing flag written ONLY by these definer
-- functions. Loop-safe by construction: they write public.items, and no
-- automation/health trigger fires on items UPDATE.

-- 1) Schema ------------------------------------------------------------------
alter table public.items
  add column health text check (health in ('at_risk', 'delayed')),
  add column health_reasons jsonb not null default '[]'::jsonb;

create index items_board_health_idx
  on public.items (board_id, health) where health is not null;

-- due(item) = coalesce(end, date); cell_values_date_idx only covers ->>'date'.
create index cell_values_due_idx
  on public.cell_values (column_id, (coalesce(value->>'end', value->>'date')));

-- fast bail for the cell trigger: does this board have any enabled health rule?
create index automations_health_idx
  on public.automations (board_id)
  where enabled and (trigger->>'type') in
    ('health_overdue','health_due_soon','health_dependency');

-- 2) Core evaluator ----------------------------------------------------------
create or replace function public._health_recompute_items(
  p_board_id uuid, p_item_ids uuid[]
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org_id uuid;
  v_today  date;
begin
  select b.org_id, (now() at time zone coalesce(o.timezone, 'UTC'))::date
    into v_org_id, v_today
  from public.boards b
  join public.organizations o on o.id = b.org_id
  where b.id = p_board_id;
  if v_org_id is null or p_item_ids is null or array_length(p_item_ids, 1) is null then
    return;
  end if;

  with rules as (
    select a.id,
           a.trigger->>'type'                                as rtype,
           nullif(a.trigger->>'dateColumnId','')::uuid       as date_col,
           nullif(a.trigger->>'startColumnId','')::uuid      as start_col,
           nullif(a.trigger->>'endColumnId','')::uuid        as end_col,
           nullif(a.trigger->>'statusColumnId','')::uuid     as status_col,
           coalesce(a.trigger->'doneOptionIds','[]'::jsonb)  as done_opts,
           nullif(a.trigger->>'percentColumnId','')::uuid    as pct_col,
           coalesce((a.trigger->>'withinDays')::int, 3)      as within_days,
           coalesce((a.trigger->>'belowPercent')::int, 50)   as below_pct,
           coalesce(a.actions->0->>'health', 'at_risk')      as target,
           a.position
    from public.automations a
    where a.board_id = p_board_id and a.enabled
      and a.trigger->>'type' in ('health_overdue','health_due_soon','health_dependency')
  ),
  targets as (select unnest(p_item_ids) as id),
  matches as (
    -- date rules (overdue / due_soon)
    select t.id as item_id, r.id as rule_id, r.target, r.position, r.rtype,
           case r.rtype when 'health_overdue' then 'overdue' else 'due_soon' end as reason
    from targets t
    join rules r on r.rtype in ('health_overdue','health_due_soon')
    join public.cell_values dcv
      on dcv.item_id = t.id and dcv.column_id = r.date_col
    left join public.cell_values scv
      on scv.item_id = t.id and scv.column_id = r.status_col
    left join public.cell_values pcv
      on pcv.item_id = t.id and pcv.column_id = r.pct_col
    where coalesce(dcv.value->>'end', dcv.value->>'date') is not null
      -- incomplete: not a done option, and (no percent col or percent < 100)
      and not (r.done_opts ? coalesce(scv.value->>'optionId', ''))
      and (r.pct_col is null
           or coalesce((pcv.value->>'percent')::numeric, 0) < 100)
      and (
        ( r.rtype = 'health_overdue'
          and coalesce(dcv.value->>'end', dcv.value->>'date') < v_today::text )
        or
        ( r.rtype = 'health_due_soon'
          and coalesce(dcv.value->>'end', dcv.value->>'date') >= v_today::text
          and coalesce(dcv.value->>'end', dcv.value->>'date')
                <= (v_today + r.within_days)::text
          and coalesce((pcv.value->>'percent')::numeric, 0) < r.below_pct )
      )
    union all
    -- dependency rule: successor flagged when an immediate predecessor is
    -- incomplete and its end overlaps the successor's start (FS breach).
    select t.id, r.id, r.target, r.position, r.rtype, 'dependency'
    from targets t
    join rules r on r.rtype = 'health_dependency'
    left join public.cell_values sscv
      on sscv.item_id = t.id and sscv.column_id = r.status_col
    where not (r.done_opts ? coalesce(sscv.value->>'optionId', ''))
      and exists (
        select 1
        from public.item_dependencies d
        join public.cell_values s_start
          on s_start.item_id = t.id and s_start.column_id = r.start_col
        join public.cell_values p_start
          on p_start.item_id = d.predecessor_id and p_start.column_id = r.start_col
        left join public.cell_values p_end
          on p_end.item_id = d.predecessor_id
         and r.end_col is not null and p_end.column_id = r.end_col
        left join public.cell_values p_status
          on p_status.item_id = d.predecessor_id and p_status.column_id = r.status_col
        where d.successor_id = t.id
          and not (r.done_opts ? coalesce(p_status.value->>'optionId', ''))
          and s_start.value->>'date' is not null
          and coalesce(p_end.value->>'date',
                       p_start.value->>'end', p_start.value->>'date')
              > (s_start.value->>'date')
      )
  ),
  agg as (
    select item_id,
           case when bool_or(target = 'delayed') then 'delayed'
                else 'at_risk' end as health,
           (select coalesce(jsonb_agg(distinct m2.reason), '[]'::jsonb)
              from matches m2 where m2.item_id = m.item_id) as reasons
    from matches m
    group by item_id
  ),
  changed as (
    update public.items it
    set health = a.health,
        health_reasons = coalesce(a.reasons, '[]'::jsonb)
    from targets t
    left join agg a on a.item_id = t.id
    where it.id = t.id
      and (it.health is distinct from a.health
           or it.health_reasons is distinct from coalesce(a.reasons, '[]'::jsonb))
    returning it.id, it.health
  )
  -- run history: one row per item that just FLIPPED to a flagged state,
  -- attributed to the highest-severity matching rule (lowest position tiebreak).
  insert into public.automation_runs
    (automation_id, org_id, board_id, item_id, trigger_type, status, actions)
  select distinct on (c.id)
         m.rule_id, v_org_id, p_board_id, c.id, m.rtype, 'ran',
         jsonb_build_array(jsonb_build_object('type','set_health','health',c.health))
  from changed c
  join matches m on m.item_id = c.id and m.target = c.health
  where c.health is not null
  order by c.id, m.position;
end;
$$;

create or replace function public._health_recompute_board(p_board_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._health_recompute_items(
    p_board_id,
    array(select i.id from public.items i where i.board_id = p_board_id)
  );
end;
$$;

-- 3) Authenticated RPC (rule create/toggle backfill) --------------------------
create or replace function public.recompute_board_health(p_board_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null or not public.is_org_member(v_org_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public._health_recompute_board(p_board_id);
end;
$$;
grant execute on function public.recompute_board_health(uuid) to authenticated;

-- 4) Reactive triggers ---------------------------------------------------------
create or replace function public.tg_health_on_cell_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row   record;
  v_items uuid[];
begin
  v_row := coalesce(new, old); -- DELETE carries old only
  -- fast bail (automations_health_idx): boards without health rules pay one probe.
  if not exists (
    select 1 from public.automations a
    where a.board_id = v_row.board_id and a.enabled
      and a.trigger->>'type' in
        ('health_overdue','health_due_soon','health_dependency')
  ) then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.value is not distinct from old.value then
    return null;
  end if;

  v_items := array[v_row.item_id];
  -- date-bearing column of some rule changed → this item may be a predecessor:
  -- recompute immediate successors too (single hop, per spec).
  if exists (
    select 1 from public.automations a
    where a.board_id = v_row.board_id and a.enabled
      and a.trigger->>'type' in
        ('health_overdue','health_due_soon','health_dependency')
      and v_row.column_id::text in (
        a.trigger->>'dateColumnId', a.trigger->>'startColumnId',
        a.trigger->>'endColumnId')
  ) then
    v_items := v_items || array(
      select d.successor_id from public.item_dependencies d
      where d.predecessor_id = v_row.item_id);
  end if;

  perform public._health_recompute_items(v_row.board_id, v_items);
  return null;
end;
$$;

create trigger cell_values_health_recompute
  after insert or update or delete on public.cell_values
  for each row execute function public.tg_health_on_cell_change();

create or replace function public.tg_health_on_dependency_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row record;
begin
  v_row := coalesce(new, old);
  perform public._health_recompute_items(v_row.board_id, array[v_row.successor_id]);
  return null;
end;
$$;

create trigger item_dependencies_health_recompute
  after insert or delete on public.item_dependencies
  for each row execute function public.tg_health_on_dependency_change();

-- 5) Daily sweep (time passing moves items into overdue / due-soon) -----------
create or replace function public._health_sweep(p_now timestamptz default now())
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org   record;
  v_rule  record;
  v_today date;
  v_items uuid[];
begin
  for v_org in select id, timezone from public.organizations loop
    begin
      -- once per org-local day, at local midnight (hourly cron gates here)
      if extract(hour from (p_now at time zone coalesce(v_org.timezone,'UTC'))) <> 0 then
        continue;
      end if;
      v_today := (p_now at time zone coalesce(v_org.timezone, 'UTC'))::date;

      for v_rule in
        select a.id, a.board_id,
               nullif(a.trigger->>'dateColumnId','')::uuid as date_col,
               coalesce((a.trigger->>'withinDays')::int, 3) as within_days
        from public.automations a
        where a.org_id = v_org.id and a.enabled
          and a.trigger->>'type' in ('health_overdue','health_due_soon')
      loop
        -- transition window only: entering overdue (today-1) .. entering due-soon
        -- (today+withinDays). Leaving states happens via data changes → cell trigger.
        select array_agg(distinct cv.item_id) into v_items
        from public.cell_values cv
        where cv.column_id = v_rule.date_col
          and coalesce(cv.value->>'end', cv.value->>'date')
                between (v_today - 1)::text and (v_today + v_rule.within_days)::text;
        if v_items is not null then
          perform public._health_recompute_items(v_rule.board_id, v_items);
        end if;
      end loop;
    exception when others then
      raise warning 'health sweep skipped org %: %', v_org.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- offset :15 to avoid contention with automations-date-sweep (:00)
select cron.schedule('health-sweep', '15 * * * *',
  $cron$ select public._health_sweep() $cron$);
```

- [ ] **Step 2: Sanity-check the SQL locally**

Run: `pnpm exec prettier --check supabase/migrations/20260703090000_status_intelligence_health.sql || true`
then re-read the file checking: every table reference schema-qualified; both triggers return
`null` (AFTER); `done_opts ?` operator used on jsonb arrays; text date comparisons throughout.
(No DB apply here — Task 4 is the apply gate; Task 10 is the behavioral verification.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260703090000_status_intelligence_health.sql
git commit -m "feat(health): item health schema, evaluator, triggers, sweep" \
  -m "Adds items.health/health_reasons (computed, self-clearing at_risk/delayed),
the set-based _health_recompute_items evaluator reading enabled health_* automation
rules, cell/dependency reactive triggers with an indexed fast-bail, the
recompute_board_health RPC, and an org-local-midnight pg_cron sweep over the
bounded due-date transition window. Spec: 2026-07-03-status-intelligence-design.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — `percent_reached` trigger + `set_percent` action

**Files:**

- Create: `supabase/migrations/20260703091000_automations_percent_sync.sql`

**Interfaces:**

- Consumes: current bodies of `public.tg_run_automations()` (latest in
  `supabase/migrations/20260619100000_automations_5c1_run_history.sql`) and
  `public._automation_run(...)` (latest in
  `supabase/migrations/20260622130000_automation_move_to_group.sql`). This migration
  `create or replace`s both — **copy the current body verbatim and add the new branches**; do
  not re-derive them.
- Produces: engine understands trigger `{"type":"percent_reached","columnId":…,"percent":100}`
  (fires on crossing writes only) and action
  `{"type":"set_percent","columnId":…,"percent":0..100}` (idempotent, logs `skipped_equal`).

- [ ] **Step 1: Write the migration**

Two `create or replace function` statements. In the copied `tg_run_automations` body, extend the
rule-matching `where` clause's trigger-type disjunction with:

```sql
      or ( r_trigger_type = 'percent_reached'  -- adapt to the body's alias for trigger->>'type'
           and (new.value->>'percent') is not null
           and (new.value->>'percent')::numeric
                 >= coalesce((trigger->>'percent')::numeric, 100)
           and ( tg_op = 'INSERT'
                 or old.value->>'percent' is null
                 or (old.value->>'percent')::numeric
                      < coalesce((trigger->>'percent')::numeric, 100) ) )
```

(The existing `trigger->>'columnId' = new.column_id::text` guard already scopes it to the right
percent column. Edge semantics — "crossing" — are what prevent re-fires; keep the INSERT arm.)

In the copied `_automation_run` body, add a branch after `set_option`, mirroring its structure
and local variable names exactly (upsert path, `skipped_equal` log entry, run-log append):

```sql
    elsif v_action->>'type' = 'set_percent' then
      -- idempotent: skip when the cell already holds the target percent
      select cv.value into v_current
      from public.cell_values cv
      where cv.item_id = p_item_id
        and cv.column_id = (v_action->>'columnId')::uuid;
      if v_current is not null
         and (v_current->>'percent')::numeric = (v_action->>'percent')::numeric then
        v_action_log := v_action_log
          || jsonb_build_object('type','set_percent','result','skipped_equal');
      else
        insert into public.cell_values (org_id, board_id, item_id, column_id, value)
        values (p_org_id, p_board_id, p_item_id,
                (v_action->>'columnId')::uuid,
                jsonb_build_object('percent', (v_action->>'percent')::numeric))
        on conflict (item_id, column_id)
          do update set value = excluded.value, updated_at = now();
        v_action_log := v_action_log
          || jsonb_build_object('type','set_percent','result','ok');
      end if;
```

Header comment must state the loop analysis: Done → `set_percent 100` (write fires
`tg_run_automations` again, depth+1) → `percent_reached` rule → `set_option` Done →
`skipped_equal`, chain ends at depth 2; `pulse.aut_depth` (≥5 bail) is the backstop.

- [ ] **Step 2: Diff-check against the source bodies**

Run: `git diff --stat` and manually compare the copied portions against
`20260622130000_automation_move_to_group.sql` / `20260619100000_automations_5c1_run_history.sql`
— the ONLY deltas must be the two new branches and the header comment.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260703091000_automations_percent_sync.sql
git commit -m "feat(automations): percent_reached trigger and set_percent action" \
  -m "Extends the engine for the Completed<->100% two-way sync: percent_reached
fires only on threshold-crossing percent writes; set_percent writes {percent:n}
with skipped_equal idempotence so the Done->100->Done chain terminates at depth 2
(pulse.aut_depth remains the backstop).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Zod unions + recipe factories

**Files:**

- Modify: `src/lib/validations/automations.ts`
- Modify: `src/components/boards/automations/recipes.ts`
- Test: `src/lib/validations/automations.test.ts` (extend or create, matching existing test
  layout), `src/components/boards/automations/recipes.test.ts` (extend)

**Interfaces:**

- Consumes: nothing from other tasks (pure TS — runs in parallel with Tasks 1–2, but the field
  names MUST match Task 1's SQL exactly; both copy from Global Constraints).
- Produces (Tasks 5, 6, 10 rely on these exact names):
  - `automationTriggerSchema` gains members with `type`:
    `"health_overdue" | "health_due_soon" | "health_dependency" | "percent_reached"`.
  - `automationActionSchema` gains `"set_health"` and `"set_percent"` members.
  - `HEALTH_TRIGGER_TYPES = ["health_overdue","health_due_soon","health_dependency"] as const`
    and `isHealthTrigger(trigger: AutomationTrigger): boolean`, exported from
    `src/lib/validations/automations.ts`.
  - Recipe factories (from `recipes.ts`, all returning `Draft`):
    - `recipeHealthOverdue(dateColumnId, statusColumnId, doneOptionIds, percentColumnId)`
    - `recipeHealthDueSoon(dateColumnId, percentColumnId, statusColumnId, doneOptionIds)`
    - `recipeHealthDependency(startColumnId, endColumnId, statusColumnId, doneOptionIds)`
    - `recipeCompletedSetsPercent(statusColumnId, doneOptionId, percentColumnId)`
    - `recipePercentSetsCompleted(percentColumnId, statusColumnId, doneOptionId)`
    - `guessDoneOptionIds(options: ColumnOption[]): string[]` — labels matching
      `/done|complete/i`, empty array if none.

- [ ] **Step 1: Write the failing tests**

In `automations.test.ts` (follow the file's existing parse-style assertions):

```ts
it("parses health_overdue and applies no defaults it shouldn't", () => {
  const t = automationTriggerSchema.parse({
    type: "health_overdue",
    dateColumnId: COL,
    statusColumnId: COL2,
    doneOptionIds: ["o1"],
    percentColumnId: null,
  });
  expect(t.type).toBe("health_overdue");
});

it("defaults withinDays=3 and belowPercent=50 on health_due_soon", () => {
  const t = automationTriggerSchema.parse({
    type: "health_due_soon",
    dateColumnId: COL,
    percentColumnId: COL3,
    statusColumnId: COL2,
    doneOptionIds: ["o1"],
  });
  expect(t).toMatchObject({ withinDays: 3, belowPercent: 50 });
});

it("rejects set_health with an unknown level", () => {
  expect(() =>
    automationActionSchema.parse({ type: "set_health", health: "on_fire" }),
  ).toThrow();
});

it("defaults percent_reached to 100 and bounds set_percent", () => {
  expect(
    automationTriggerSchema.parse({ type: "percent_reached", columnId: COL3 }),
  ).toMatchObject({ percent: 100 });
  expect(() =>
    automationActionSchema.parse({
      type: "set_percent",
      columnId: COL3,
      percent: 101,
    }),
  ).toThrow();
});

it("isHealthTrigger discriminates the family", () => {
  expect(
    isHealthTrigger({
      type: "health_dependency",
      startColumnId: COL,
      endColumnId: null,
      statusColumnId: COL2,
      doneOptionIds: ["o1"],
    }),
  ).toBe(true);
  expect(
    isHealthTrigger({ type: "percent_reached", columnId: COL3, percent: 100 }),
  ).toBe(false);
});
```

In `recipes.test.ts`: each factory's draft round-trips through
`createAutomationSchema` (trigger + actions valid), `recipeHealthOverdue` carries
`actions: [{ type: "set_health", health: "delayed" }]`, the other two health recipes carry
`at_risk`, and `guessDoneOptionIds([{label:"Done"},{label:"Completed"},{label:"Stuck"}])`
returns the first two ids.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/validations/automations.test.ts src/components/boards/automations/recipes.test.ts`
Expected: FAIL — unknown discriminator values / missing exports.

- [ ] **Step 3: Implement**

In `automations.ts`, add to the trigger discriminated union (match the file's uuid/string
conventions exactly — reuse whatever `z.string().uuid()` helper the existing members use):

```ts
const doneConfigFields = {
  statusColumnId: z.string().uuid(),
  doneOptionIds: z.array(z.string().min(1)).min(1),
};

// health_* family: level-based rules read by the SQL evaluator
// (_health_recompute_items) — field names are a Zod<->SQL contract, do not rename.
z.object({
  type: z.literal("health_overdue"),
  dateColumnId: z.string().uuid(),
  percentColumnId: z.string().uuid().nullable(),
  ...doneConfigFields,
}),
z.object({
  type: z.literal("health_due_soon"),
  dateColumnId: z.string().uuid(),
  withinDays: z.number().int().min(1).max(30).default(3),
  percentColumnId: z.string().uuid(),
  belowPercent: z.number().int().min(1).max(100).default(50),
  ...doneConfigFields,
}),
z.object({
  type: z.literal("health_dependency"),
  startColumnId: z.string().uuid(),
  endColumnId: z.string().uuid().nullable(),
  ...doneConfigFields,
}),
z.object({
  type: z.literal("percent_reached"),
  columnId: z.string().uuid(),
  percent: z.number().int().min(1).max(100).default(100),
}),
```

Actions union additions:

```ts
z.object({
  type: z.literal("set_health"),
  health: z.enum(["at_risk", "delayed"]),
}),
z.object({
  type: z.literal("set_percent"),
  columnId: z.string().uuid(),
  percent: z.number().int().min(0).max(100),
}),
```

Plus:

```ts
export const HEALTH_TRIGGER_TYPES = [
  "health_overdue",
  "health_due_soon",
  "health_dependency",
] as const;
export function isHealthTrigger(trigger: AutomationTrigger): boolean {
  return (HEALTH_TRIGGER_TYPES as readonly string[]).includes(trigger.type);
}
```

In `recipes.ts`, five factories following the existing `Draft` pattern, e.g.:

```ts
export function recipeHealthOverdue(
  dateColumnId: string,
  statusColumnId: string,
  doneOptionIds: string[],
  percentColumnId: string | null,
): Draft {
  return {
    name: "Flag overdue items as Delayed",
    trigger: {
      type: "health_overdue",
      dateColumnId,
      statusColumnId,
      doneOptionIds,
      percentColumnId,
    },
    actions: [{ type: "set_health", health: "delayed" }],
  };
}

export function guessDoneOptionIds(options: ColumnOption[]): string[] {
  return options.filter((o) => /done|complete/i.test(o.label)).map((o) => o.id);
}
```

(`recipeHealthDueSoon` → `set_health at_risk` with defaults applied by Zod;
`recipeHealthDependency` → `set_health at_risk`; `recipeCompletedSetsPercent` → trigger
`{ type: "status_changed", columnId: statusColumnId, toOptionId: doneOptionId }`, actions
`[{ type: "set_percent", columnId: percentColumnId, percent: 100 }]`;
`recipePercentSetsCompleted` → trigger `{ type: "percent_reached", columnId: percentColumnId,
percent: 100 }`, actions `[{ type: "set_option", columnId: statusColumnId,
optionId: doneOptionId }]` — write each out fully.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/validations/automations.test.ts src/components/boards/automations/recipes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/automations.ts src/lib/validations/automations.test.ts \
        src/components/boards/automations/recipes.ts \
        src/components/boards/automations/recipes.test.ts
git commit -m "feat(automations): health and percent-sync trigger/action schemas + recipes" \
  -m "Adds the health_* trigger family (overdue / due_soon / dependency),
percent_reached, set_health and set_percent to the Zod unions, the
isHealthTrigger helper, and five recipe factories incl. done-option guessing
for custom status vocabularies.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: USER GATE — apply migrations to cloud dev, regenerate types

**Files:**

- Modify: `src/types/database.types.ts` (regenerated only)

**Interfaces:**

- Consumes: the two migration files (Tasks 1–2).
- Produces: `Tables<"items">` gains `health: string | null` and `health_reasons: Json`; the
  `recompute_board_health` RPC appears in the generated `Functions` types. Tasks 5, 7–10 depend
  on this.

- [ ] **Step 1: Hand the SQL to the user**

The agent CANNOT apply migrations (classifier blocks DDL — memory note "migration apply blocked
by classifier"). Post both file paths and ask the user to apply them to **cloud dev** (hjqca… per
memory: labels in `.mcp.json` are inverted) in order: `20260703090000` then `20260703091000`.

- [ ] **Step 2: Verify application (read-only)**

After the user confirms, verify via the dev MCP `execute_sql` (read-only):
`select column_name from information_schema.columns where table_name='items' and column_name in ('health','health_reasons');`
and `select jobname from cron.job where jobname = 'health-sweep';`
Expected: two columns + the job row.

- [ ] **Step 3: Regenerate + commit types**

Run: `pnpm db:types`
Then: `pnpm typecheck` (build first if the cacheLife cold-typecheck gotcha bites).

```bash
git add src/types/database.types.ts
git commit -m "chore(types): regenerate for items.health and recompute rpc" \
  -m "Generated after applying 20260703090000/20260703091000 to cloud dev
(migrations applied manually by the user; agent verified via read-only checks).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire `recompute_board_health` into the automation Server Actions

**Files:**

- Modify: `src/lib/boards/automation-actions.ts` (`createAutomation`, `updateAutomation`,
  `deleteAutomation`)
- Test: `src/lib/boards/automation-actions.test.ts` (extend; create if absent following
  `org/admin-actions.test.ts` mock style)

**Interfaces:**

- Consumes: `isHealthTrigger` from `@/lib/validations/automations` (Task 3); RPC name
  `recompute_board_health` (Task 1); generated RPC types (Task 4 — for typecheck only; the unit
  tests mock the client and can run before Task 4 lands).
- Produces: behavior only — any create/update/delete of a rule whose trigger (or, for
  update/delete, whose STORED trigger) is a `health_*` type calls
  `supabase.rpc("recompute_board_health", { p_board_id: boardId })` after the write succeeds.
  Toggling the last rule off clears all flags because the evaluator then matches nothing.

- [ ] **Step 1: Write the failing tests**

Mock the supabase server client chain (existing file pattern); assert:

```ts
it("createAutomation recomputes board health for a health rule", async () => {
  await createAutomation({
    boardId: BOARD,
    trigger: healthOverdueTrigger,
    actions: [{ type: "set_health", health: "delayed" }],
  });
  expect(rpc).toHaveBeenCalledWith("recompute_board_health", {
    p_board_id: BOARD,
  });
});

it("createAutomation does NOT recompute for a non-health rule", async () => {
  await createAutomation({
    boardId: BOARD,
    trigger: statusChangedTrigger,
    actions: [notifyAction],
  });
  expect(rpc).not.toHaveBeenCalledWith(
    "recompute_board_health",
    expect.anything(),
  );
});

it("updateAutomation (enabled flip) recomputes when the stored trigger is health_*", async () => {
  // arrange: the row-read mock returns { board_id: BOARD, trigger: healthOverdueTrigger }
  await updateAutomation({ id: RULE, enabled: false });
  expect(rpc).toHaveBeenCalledWith("recompute_board_health", {
    p_board_id: BOARD,
  });
});

it("deleteAutomation recomputes when the deleted rule was health_*", async () => {
  await deleteAutomation({ id: RULE });
  expect(rpc).toHaveBeenCalledWith("recompute_board_health", {
    p_board_id: BOARD,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/boards/automation-actions.test.ts`
Expected: FAIL — rpc never called with `recompute_board_health`.

- [ ] **Step 3: Implement**

In `createAutomation`: after the successful insert, `if (isHealthTrigger(parsed.data.trigger))
await supabase.rpc("recompute_board_health", { p_board_id: parsed.data.boardId });`.

In `updateAutomation` / `deleteAutomation`: these receive only `id` — read
`board_id, trigger` for the row before the write (updateAutomation already reads the row for the
webhook admin gate; extend that select). After a successful write, recompute when EITHER the
stored trigger or (for update) the incoming `parsed.data.trigger` is a health type:

```ts
const touchesHealth =
  isHealthTrigger(existing.trigger as AutomationTrigger) ||
  (parsed.data.trigger !== undefined &&
    isHealthTrigger(parsed.data.trigger as AutomationTrigger));
if (touchesHealth) {
  await supabase.rpc("recompute_board_health", {
    p_board_id: existing.board_id,
  });
}
```

RPC failure must not fail the action (the rule write succeeded; flags heal on the next
trigger/sweep): log via the file's existing error path and still return `ok`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/boards/automation-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/automation-actions.ts src/lib/boards/automation-actions.test.ts
git commit -m "feat(automations): backfill board health on health-rule writes" \
  -m "create/update/deleteAutomation now call the recompute_board_health RPC when
the touched rule is a health_* type, so flags appear on enable and clear on
disable/delete without waiting for the next cell write or nightly sweep.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Builder sentences + recipe buttons in the automations UI

**Files:**

- Modify: `src/components/boards/automations/AutomationBuilder.tsx`
- Modify: `src/components/boards/automations/AutomationsDialog.tsx`
- Test: extend the components' existing test files (same directory)

**Interfaces:**

- Consumes: Task 3's recipe factories, `guessDoneOptionIds`, trigger/action types;
  `defaultTimelineColumns`-style column guessing from `src/lib/boards/dates.ts` (start =
  `/start|begin/i`, due/end = `/due|end|finish|target/i`).
- Produces: user-visible rule sentences and five "Start from a recipe" buttons. No new exports.

- [ ] **Step 1: Write the failing tests**

Extend the dialog/builder tests (existing render-with-columns fixtures):

- Renders a recipe button "Flag overdue items as Delayed" when the board has status + date
  columns; hides it when no date column exists.
- "Flag items due soon with low progress At Risk" requires status + date + percent columns.
- "Flag successors of slipped items At Risk" requires status + date columns.
- "Completed sets 100%" / "100% sets Completed" require status + percent columns.
- Builder renders a readable sentence for a `health_overdue` draft (e.g. "When an item is past
  its {Due date} and not {Done}, mark it Delayed") and for `set_percent` ("set {Progress} to
  100%").

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/boards/automations`
Expected: FAIL — buttons/sentences absent.

- [ ] **Step 3: Implement**

`AutomationsDialog.tsx`: follow the existing availability-gate pattern (`canNotifyOwner` etc.):
`canHealthOverdue = hasStatus && hasDate`, `canHealthDueSoon = hasStatus && hasDate &&
hasPercent`, `canHealthDependency = hasStatus && hasDate`, `canPercentSync = hasStatus &&
hasPercent`. Each button builds its draft with guessed defaults: due column via
`/due|end|finish|target/i` name match (fallback: first date column), start via `/start|begin/i`,
done options via `guessDoneOptionIds` (fallback: preselect nothing and let the builder's
existing option picker force a choice — `doneOptionIds` min(1) makes the draft invalid until
picked, which the builder already surfaces). Buttons call `startBuild(draft)` exactly like the
existing recipes.

`AutomationBuilder.tsx`: add sentence segments for the four new trigger types and two new action
types, composing the existing column/option picker primitives (`columnOptions`). `health_*`
triggers render pickers for their column fields + a done-options multi-select (reuse the
condition builder's option multi-select if one exists; otherwise the status-option picker in
multiple mode); `set_health` renders as fixed text ("mark it At Risk" / "mark it Delayed") — not
editable beyond the at_risk/delayed choice; `set_percent` renders the percent-column picker + a
fixed "to 100%" for the recipe defaults (numeric input bounded 0–100).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/boards/automations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/automations/AutomationsDialog.tsx \
        src/components/boards/automations/AutomationBuilder.tsx \
        src/components/boards/automations/*.test.tsx
git commit -m "feat(automations): builder and recipes ui for status intelligence" \
  -m "Five new recipe buttons (three health rules + the two percent-sync rules)
with column-presence gating and done-option guessing, plus builder sentences
and pickers for the health_*, percent_reached, set_health and set_percent types.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `ItemHealthBadge` + cache plumbing + table/kanban/panel attachment

**Files:**

- Create: `src/components/boards/ItemHealthBadge.tsx`
- Test: `src/components/boards/ItemHealthBadge.test.tsx`
- Modify: `src/lib/boards/cache.ts` (CacheItem already `Tables<"items">` — verify; if it narrows
  fields, add `health`/`health_reasons`)
- Modify: `src/components/boards/BoardTable.tsx` (NameCell trailing slot, ~1587–1614),
  `src/components/boards/KanbanBoard.tsx` (pills row, ~489–501),
  `src/components/boards/item-panel/ItemPanel.tsx` (header flex, ~90–98)
- Test: extend `src/lib/boards/realtime-buffer.test.ts` (item UPDATE fold keeps health)

**Interfaces:**

- Consumes: regenerated `Tables<"items">` (Task 4).
- Produces (Tasks 8–9 rely on):
  - `ItemHealth = "at_risk" | "delayed"` and
    `ItemHealthBadge({ health, reasons, size }: { health: ItemHealth; reasons: string[];
size?: "sm" | "md" }): JSX.Element` from `@/components/boards/ItemHealthBadge`.
  - `healthFromItem(item: Pick<CacheItem, "health" | "health_reasons">):
{ health: ItemHealth; reasons: string[] } | null` (same module) — the single
    narrowing/parsing point from row types to the badge props.

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders Delayed with text (not color-only)", () => {
  render(<ItemHealthBadge health="delayed" reasons={["overdue"]} />);
  expect(screen.getByText("Delayed")).toBeInTheDocument();
});

it("icon-only sm variant keeps an accessible name", () => {
  render(
    <ItemHealthBadge health="at_risk" reasons={["dependency"]} size="sm" />,
  );
  expect(screen.getByLabelText(/at risk/i)).toBeInTheDocument();
});

it("healthFromItem returns null for healthy items and parses reasons", () => {
  expect(healthFromItem({ health: null, health_reasons: [] })).toBeNull();
  expect(
    healthFromItem({
      health: "at_risk",
      health_reasons: ["due_soon"] as never,
    }),
  ).toEqual({ health: "at_risk", reasons: ["due_soon"] });
});
```

Realtime fold test (extend `realtime-buffer.test.ts`): an `items` UPDATE event whose `new` row
carries `health: "delayed"` replaces the cached item and the fold result exposes the new health.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/boards/ItemHealthBadge.test.tsx src/lib/boards/realtime-buffer.test.ts`
Expected: FAIL — module not found (badge); fold test may already pass (row replace is generic —
if so it pins the behavior, keep it).

- [ ] **Step 3: Implement the badge**

```tsx
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CacheItem } from "@/lib/boards/cache";

export type ItemHealth = "at_risk" | "delayed";

const LABELS: Record<ItemHealth, string> = {
  at_risk: "At risk",
  delayed: "Delayed",
};
// pulse-ui normative mapping: at risk = yellow, overdue/stuck = red.
const COLORS: Record<ItemHealth, string> = {
  at_risk: "bg-status-yellow",
  delayed: "bg-status-red",
};
const REASON_TEXT: Record<string, string> = {
  overdue: "Past its due date",
  due_soon: "Due soon with low progress",
  dependency: "A predecessor's dates overlap this item",
};

export function healthFromItem(
  item: Pick<CacheItem, "health" | "health_reasons">,
): { health: ItemHealth; reasons: string[] } | null {
  if (item.health !== "at_risk" && item.health !== "delayed") return null;
  const reasons = Array.isArray(item.health_reasons)
    ? item.health_reasons.filter((r): r is string => typeof r === "string")
    : [];
  return { health: item.health, reasons };
}

export function ItemHealthBadge({
  health,
  reasons,
  size = "md",
}: {
  health: ItemHealth;
  reasons: string[];
  size?: "sm" | "md";
}) {
  const tooltip = reasons.map((r) => REASON_TEXT[r] ?? r).join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {size === "sm" ? (
          <span
            aria-label={LABELS[health]}
            className={cn(
              "inline-flex size-4 items-center justify-center rounded-full text-white",
              COLORS[health],
            )}
          >
            <TriangleAlert className="size-3" aria-hidden />
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5",
              "text-xs font-medium text-white",
              COLORS[health],
            )}
          >
            <TriangleAlert className="size-3" aria-hidden />
            {LABELS[health]}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{tooltip || LABELS[health]}</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Attach in the three surfaces**

Each attachment is `const h = healthFromItem(item); {h && <ItemHealthBadge {...h} size=… />}`:
BoardTable `NameCell` trailing slot (size `sm` — dense rows), KanbanCard pills row (size `md`),
ItemPanel header beside `SheetTitle` (size `md`). Client boundaries already exist in all three —
no new `"use client"`.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/components/boards src/lib/boards/realtime-buffer.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/ItemHealthBadge.tsx src/components/boards/ItemHealthBadge.test.tsx \
        src/components/boards/BoardTable.tsx src/components/boards/KanbanBoard.tsx \
        src/components/boards/item-panel/ItemPanel.tsx src/lib/boards/cache.ts \
        src/lib/boards/realtime-buffer.test.ts
git commit -m "feat(boards): item health badge in table, kanban, and item panel" \
  -m "ItemHealthBadge pairs status color with text (AA), tooltips explain the
reason codes, and healthFromItem is the single row->badge narrowing point.
Flags ride the existing items payload and realtime channel - zero new reads.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Gantt surfacing

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx` (`GanttRowItem`, name rail ~790–848, bar
  ~887–931)
- Test: extend `src/components/boards/GanttBoard.test.tsx`

**Interfaces:**

- Consumes: `ItemHealthBadge`/`healthFromItem` (Task 7); `cache.items` already threaded into
  `GanttBoard`.
- Produces: none (leaf UI). The existing `detectViolations` red arrows are untouched.

- [ ] **Step 1: Write the failing test**

Render `GanttBoard` with a fixture item whose row carries `health: "at_risk"`; assert the name
rail shows the badge (`getByLabelText(/at risk/i)`) and the bar element has the risk ring class.
Assert a healthy item renders neither.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/boards/GanttBoard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Thread a `healthByItem: Map<string, { health: ItemHealth; reasons: string[] }>` computed once in
`GanttBoard` from `cache.items` (next to the existing `rowColors` map) down to `GanttRowItem`.
In the sticky name label: `size="sm"` badge after the name. On the bar div: add
`ring-2 ring-status-red` / `ring-status-yellow` (delayed/at_risk) via `cn()` — ring, not fill,
so the user's chosen status color stays legible. Milestone diamonds get the ring too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/boards/GanttBoard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/GanttBoard.tsx src/components/boards/GanttBoard.test.tsx
git commit -m "feat(gantt): surface item health on bars and the name rail" \
  -m "At-risk/delayed items get a badge in the sticky name rail and a status-
colored ring on their bar/milestone; the existing per-edge violation arrows
are unchanged (edge-level signal vs the new item-level flag).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Health filter chip (client state + History API)

**Files:**

- Create: `src/lib/boards/health-filter.ts`
- Test: `src/lib/boards/health-filter.test.ts`
- Modify: `src/components/boards/BoardViews.tsx` (and the board toolbar component it renders)

**Interfaces:**

- Consumes: `CacheItem` health fields (Task 7 plumbing).
- Produces: `type HealthFilterMode = "all" | "flagged" | "delayed"` and
  `filterItemsByHealth<T extends Pick<CacheItem, "health">>(items: T[],
mode: HealthFilterMode): T[]` from `@/lib/boards/health-filter` (item 8 reuses this in
  dashboard widgets).

- [ ] **Step 1: Write the failing tests**

```ts
const items = [
  { id: "a", health: null },
  { id: "b", health: "at_risk" },
  { id: "c", health: "delayed" },
] as never[];

it("all is identity", () =>
  expect(filterItemsByHealth(items, "all")).toHaveLength(3));
it("flagged keeps at_risk and delayed", () =>
  expect(filterItemsByHealth(items, "flagged").map((i) => i.id)).toEqual([
    "b",
    "c",
  ]));
it("delayed keeps only delayed", () =>
  expect(filterItemsByHealth(items, "delayed").map((i) => i.id)).toEqual([
    "c",
  ]));
```

- [ ] **Step 2: Run tests to verify they fail** — `pnpm vitest run src/lib/boards/health-filter.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement helper + chip**

Helper is a pure three-way filter. In the board toolbar (where `ViewSwitcher` lives), add a
compact chip button cycling `all → flagged → delayed → all`, labeled "Health: All / At risk /
Delayed" with a `TriangleAlert` `size-3.5` icon; ghost button styling, monochrome until active
(active state uses `bg-accent`, NOT brand). State: `useState` initialized from
`useSearchParams().get("health")`, and on change
`window.history.replaceState(null, "", url)` with the `health` param set/removed — **no router
navigation** (gotcha-09; Next 16 syncs History API into `useSearchParams()`). Apply
`filterItemsByHealth` in the item-list derivations passed to table/kanban/gantt (the same place
existing per-view item mapping happens in `BoardViews`/each view's row builder — one call site
per view, before grouping). Hide the chip when no item on the board is flagged AND the board has
no enabled health rule info available client-side (simplest robust proxy: hide when zero items
are flagged and mode is `all`).

- [ ] **Step 4: Run tests + typecheck** — `pnpm vitest run src/lib/boards && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/health-filter.ts src/lib/boards/health-filter.test.ts \
        src/components/boards/BoardViews.tsx
git commit -m "feat(boards): health filter chip over loaded items" \
  -m "All/At-risk/Delayed cycle chip in the board toolbar; pure client state
synced to ?health= via history.replaceState (0 server round-trips per
gotcha-09), applied by the shared filterItemsByHealth helper across table,
kanban, and gantt derivations.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Integration tests — evaluator + percent sync

**Files:**

- Create: `src/lib/boards/health.integration.test.ts`
- Create: `src/lib/boards/automations.percent-sync.integration.test.ts`

**Interfaces:**

- Consumes: applied migrations (Task 4), Zod shapes (Task 3). Follow the provisioning +
  serial-project conventions of `src/lib/boards/automations.engine.5b1.integration.test.ts` and
  the 5b2 sweep test (inject `p_now` into `_health_sweep`).
- Produces: the behavioral spec of the evaluator (item 8 builds on these fixtures).

- [ ] **Step 1: Write the health evaluator tests** (each seeds a board with status/date/percent
      columns, a `health_*` automations row inserted with the Task 3 shapes, then asserts
      `items.health`/`health_reasons` after cell writes):

  1. `health_overdue`: item due yesterday + status "Working on it" → `delayed`, `["overdue"]`;
     set status to a done option → cleared (`null`, `[]`); move due date to next week → cleared.
  2. percent completes: overdue item with percent 100 → NOT flagged (incomplete guard).
  3. `health_due_soon` boundaries: due today+3 & percent 49 → `at_risk` `["due_soon"]`;
     percent 50 → clear; due today+4 → clear; due today → flagged.
  4. `health_dependency`: A→B FS breach (A end after B start, A incomplete) → B `at_risk`
     `["dependency"]`; B→C chain: C NOT flagged (single hop); mark A done → B cleared;
     delete the dependency → B cleared.
  5. Severity: item both overdue and dependency-hit → `delayed` with both reasons.
  6. Rule lifecycle: `recompute_board_health` RPC as a member backfills; disabling the only rule
     - RPC clears every flag; RPC as an outsider raises `42501`.
  7. Sweep: seed due = sweep-day − 1, call
     `_health_sweep('<org-local midnight instant>'::timestamptz)` via service SQL → item flips
     to `delayed`; call again at a non-midnight hour → no writes.
  8. Run history: the flip in (1) inserted an `automation_runs` row with
     `trigger_type = 'health_overdue'` and a `set_health` actions log.

- [ ] **Step 2: Write the percent-sync tests:**

  1. "Completed sets 100%": status → done option ⇒ percent cell becomes `{percent:100}`.
  2. "100% sets Completed": percent write 40→100 ⇒ status cell becomes the done option.
  3. Loop guard: with BOTH rules enabled, one status→Done write settles (percent 100, status
     Done) and the run history shows a `skipped_equal` on the second hop — no depth exhaustion.
  4. No re-fire: percent 100→100 rewrite does not fire `percent_reached` (crossing semantics).

- [ ] **Step 3: Run** — `pnpm vitest run src/lib/boards/health.integration.test.ts src/lib/boards/automations.percent-sync.integration.test.ts`
      Expected: PASS (these run against cloud dev like the existing engine tests; flakes → memory
      note "integration-test provisioning flake": serial project + signInWithRetry already handle it).

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/health.integration.test.ts \
        src/lib/boards/automations.percent-sync.integration.test.ts
git commit -m "test(health): evaluator and percent-sync integration coverage" \
  -m "Pins overdue/due-soon boundaries and self-clearing, single-hop dependency
propagation with done-predecessor clearing, severity aggregation, rule
lifecycle + RPC authz, the midnight sweep window, run-history flips, and the
loop-guarded completed<->100% sync in both directions.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Execution DAG (working agreement #6)

**Dependency graph:**

- Task 1 (health migration) — no deps
- Task 2 (engine migration) — no deps
- Task 3 (Zod + recipes) — no deps (field-name contract copied from Global Constraints)
- Task 4 (USER GATE: apply + db:types) — depends on 1, 2
- Task 5 (actions wiring) — depends on 3 (unit tests mock the client; final typecheck needs 4)
- Task 6 (builder/dialog UI) — depends on 3
- Task 7 (badge + attachment) — depends on 4
- Task 8 (gantt) — depends on 7
- Task 9 (filter chip) — depends on 7
- Task 10 (integration tests) — depends on 3, 4

**Parallel batches** (≥2 tasks in a batch → dispatch per
`superpowers:dispatching-parallel-agents` / parallel subagent-driven-development):

| Batch | Tasks       | Note                                                                      |
| ----- | ----------- | ------------------------------------------------------------------------- |
| A     | 1, 2, 3     | fully independent files                                                   |
| gate  | 4           | **user applies migrations manually** — request early, right after batch A |
| B     | 5, 6, 7, 10 | 5/6 need only 3; 7/10 need 4; all touch disjoint files                    |
| C     | 8, 9        | both consume Task 7's exports; disjoint files                             |

**Critical path:** 1 → 4 (user gate) → 7 → 8/9 — the wall-clock floor is dominated by the
manual migration-apply turnaround, so surface Task 4's request to the user the moment batch A
lands.

**Finish:** `scripts/finish-task.sh` from the worktree (gates: typecheck, lint, test incl.
integration, build), then the "How to test this" walkthrough per AGENTS.md.

## What item 8 (health summary + alerts) consumes from this plan

Produced here and stable for item 8 — do not re-decide:

- **`items.health` / `items.health_reasons` + `items_board_health_idx`** (Task 1) — org/board
  flag aggregation for the dashboard summary and weekly digest queries.
- **The `health_*` trigger family** (Tasks 1, 3) — item 8's "structurally incomplete" rule joins
  the same family (new `health_incomplete` trigger type + reason code), evaluated by the same
  `_health_recompute_items` with one more `union all` arm.
- **`automation_runs` flip rows** (`trigger_type = 'health_*'`, Task 1) — the "newly flagged"
  event stream for in-app notifications and the digest.
- **`_health_sweep` / pg_cron pattern** (Task 1) — the digest cron reuses the org-local-hour
  gating shape.
- **`ItemHealthBadge` / `healthFromItem`** (Task 7) and **`filterItemsByHealth`** (Task 9) —
  reusable in dashboard list widgets.
