# Agent Orchestration & Addressing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Spec 3 — a per-user built-in orchestrator agent that delegates to the owner's other agents through one capability-gated `delegate` tool, `@handle` addressing on item updates and in `/ask`, and a renameable built-in assistant.

**Architecture:** `user_agent_runs` becomes a shallow tree (`parent_run_id`, `depth`, `trigger`) whose non-scheduled rows are created only through one `SECURITY DEFINER` claim RPC that enforces depth, fan-out, mention cooldown, the daily cap and ownership under a row lock. The per-run work currently inlined in `/api/ai/personal-agent/route.ts` is extracted into `executeAgentRun`, which both the route and the delegate tool handler call. `user_agents` gains a typeable `handle` and a `kind` marker; a seeded `kind='builtin'` row per org membership is the orchestrator.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase Postgres + RLS, Vercel AI SDK (`ai@7`), Zod v4, Vitest, TanStack Query, Tailwind v4 + shadcn.

**Spec:** `docs/superpowers/specs/2026-09-04-agent-orchestration-addressing-design.md`

## Global Constraints

- Migrations are minted **only** with `scripts/new-migration.sh <slug>` — never a hand-invented version stamp. Apply to DEV via the `supabase-dev` MCP with the **same version + name** as the committed file, then verify with `pnpm db:ledger-check`.
- `pnpm db:types` throws `LegacyProjectNotLinkedError` inside a worktree. Regenerate through the `supabase-dev` MCP's `generate_typescript_types`, then `pnpm format`. Commit the regenerated `src/types/database.types.ts` in the same task.
- `public.user_agents` has **column-scoped** INSERT/UPDATE grants for `authenticated`. A new column that is not re-granted is a hard Postgres failure on every save. Existing INSERT list: `org_id, owner_id, name, template_id, instructions, board_scope, cadence, run_at_local_hour, enabled, provider, model_id, capabilities, run_on_weekday, run_on_day_of_month`. UPDATE list: the same minus `org_id, owner_id`, plus `updated_at`.
- Dropping and recreating a function **destroys its grants**. Every `drop function`/`create function` pair must restate `revoke ... from public, anon, authenticated` and `grant execute ... to <role>` against the **new** argument list. `create or replace` on a `security definer` function likewise does not restore revoked grants.
- `AGENT_MAX_STEPS = 12`. `DELEGATE_FANOUT_MAX = 3`. Max delegation depth = `1`.
- `CLAIM_PLACEHOLDER = "claimed; result not yet recorded"` (`src/lib/agents/run-status.ts:29`) is a byte-identical contract between SQL and TS. Never retype it — import it, or copy it exactly.
- Every commit is authored `Danijel Jovanovic <info@synapse-solutions.ai>`; stage explicitly by path, never `git add -A`.
- Gates before any task is "done": `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- `*.integration.test.ts` suites **skip cleanly** without `PULSE_TEST_DB` and must never be forced.

---

## File Structure

| File                                                                     | Responsibility                                                                                      | Task |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---- |
| `supabase/migrations/<v>_agent_run_graph.sql`                            | `parent_run_id`/`depth`/`trigger`, partial slot index, `agent_run_claim`                            | 1    |
| `supabase/migrations/<v>_agent_handles_and_builtin.sql`                  | `handle`, `kind`, `'manual'` cadence, column grants, built-in seed                                  | 1    |
| `supabase/migrations/<v>_agent_delegate_and_usage_run_id.sql`            | `agent.delegate` vocabulary, `ai_usage.run_id`, `record_ai_usage`, `org_ai_settings.assistant_name` | 1    |
| `supabase/migrations/<v>_agent_reply_notification_kind.sql`              | `alter type notification_kind add value 'agent_reply'` (alone)                                      | 1    |
| `src/lib/ai/gateway.ts`                                                  | thread `runId` into `record_ai_usage`                                                               | 1    |
| `src/lib/agents/capabilities.ts`, `capability-copy.ts`                   | `agent.delegate` vocabulary + copy                                                                  | 2    |
| `src/lib/agents/handle.ts`                                               | **new** — handle shape, reserved list, slugifier                                                    | 2    |
| `src/lib/agents/agent-config.ts`                                         | `handle` on the settings schema, `'manual'` cadence                                                 | 2    |
| `src/lib/agents/execute-run.ts`                                          | **new** — one run: budget → tools → loop → proposals                                                | 3    |
| `src/lib/collaboration/mentions.ts`                                      | `MentionTarget` union, `applyMention` for agents                                                    | 4    |
| `src/lib/validations/collaboration-actions.ts`                           | `mentionTargetSchema`, `.max(20)`                                                                   | 4    |
| `src/components/boards/item-panel/MentionTextarea.tsx`, `UpdatesTab.tsx` | agent candidates, handle highlighting, submit shape                                                 | 4    |
| `src/lib/agents/run-claim.ts`                                            | **new** — typed wrapper over `agent_run_claim`                                                      | 5    |
| `src/lib/agents/delegate-tool.ts`                                        | **new** — the `delegate` descriptor + nested run                                                    | 5    |
| `src/lib/agents/run-loop.ts`                                             | optional `task` on the user message                                                                 | 5    |
| `src/lib/agents/agents-db.ts`, `actions.ts`                              | `handle`/`kind` columns, built-in guards, cap filters                                               | 6    |
| `src/components/agents/AgentEditor.tsx`, `AgentRoster.tsx`               | handle field, `'manual'`, built-in affordances                                                      | 6    |
| `src/app/(app)/settings/agents/page.tsx`                                 | widened roster select                                                                               | 6    |
| `src/components/agents/AgentRunHistory.tsx`                              | nested child-run tree + subtree tokens                                                              | 7    |
| `src/components/ai/ask/Composer.tsx`, `AskChat.tsx`                      | `@handle` persona selection                                                                         | 8    |
| `src/lib/org/assistant-name.ts` + `/settings/ai`                         | **new** — per-org platform-bot name                                                                 | 9    |
| `src/app/api/ai/personal-agent/route.ts`                                 | `{run_id}` body, finalize by id, delegation, `maxDuration`                                          | 10   |
| `src/lib/rate-limit/agent-mention-rate-limit.ts`                         | **new** — mention limiter                                                                           | 11   |
| `src/lib/collaboration/actions.ts`                                       | agent targets, claim, dispatch, bot reply                                                           | 11   |
| `src/lib/agents/mention-dispatch.ts`                                     | **new** — signed fire-and-forget POST                                                               | 11   |

---

## Task 1: Schema + metering correlation

**Files:**

- Create: four migrations under `supabase/migrations/` (names below), minted with `scripts/new-migration.sh`
- Modify: `src/types/database.types.ts` (regenerated), `src/lib/ai/gateway.ts:198-297`
- Test: `src/lib/ai/gateway.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: columns `user_agent_runs.parent_run_id: uuid|null`, `.depth: number`, `.trigger: 'schedule'|'delegation'|'mention'`; `user_agents.handle: string`, `.kind: 'user'|'builtin'`; cadence value `'manual'`; capability value `'agent.delegate'`; `ai_usage.run_id: uuid|null`; `org_ai_settings.assistant_name: string`; enum value `notification_kind.agent_reply`; RPC `agent_run_claim(p_agent_id uuid, p_trigger text, p_parent_run_id uuid) returns table(outcome text, run_id uuid)`; RPC `record_ai_usage(..., p_run_id uuid default null)`; `runAi(args & { runId?: string }, fn)`.

- [ ] **Step 1: Mint the four migration files**

```bash
scripts/new-migration.sh agent_run_graph
scripts/new-migration.sh agent_handles_and_builtin
scripts/new-migration.sh agent_delegate_and_usage_run_id
scripts/new-migration.sh agent_reply_notification_kind
```

Each file gets the standard header comment block (copy the shape from `supabase/migrations/20260827095748_agent_memory.sql:1-55`): what it does, and **why** each non-obvious clause is there.

- [ ] **Step 2: Write migration 1 — the run graph**

```sql
alter table public.user_agent_runs
  add column parent_run_id uuid references public.user_agent_runs(id) on delete cascade,
  add column depth smallint not null default 0,
  add column trigger text not null default 'schedule';

alter table public.user_agent_runs alter column fire_hour drop not null;

alter table public.user_agent_runs
  add constraint user_agent_runs_trigger_known
    check (trigger in ('schedule','delegation','mention')),
  add constraint user_agent_runs_depth_root
    check ((parent_run_id is null) = (depth = 0)),
  add constraint user_agent_runs_depth_capped
    check (depth between 0 and 1),
  add constraint user_agent_runs_slot_shape
    check ((trigger = 'schedule') = (fire_hour is not null));

-- The slot lock now covers SCHEDULED runs only. A delegated or mention run has
-- no fire slot to race for; its arbitration is agent_run_claim below.
drop index if exists public.user_agent_runs_slot_uniq;
create unique index user_agent_runs_slot_uniq
  on public.user_agent_runs (user_agent_id, fire_date, fire_hour)
  where trigger = 'schedule';

create index user_agent_runs_parent_idx
  on public.user_agent_runs (parent_run_id) where parent_run_id is not null;
create index user_agent_runs_mention_idx
  on public.user_agent_runs (user_agent_id, created_at desc) where trigger = 'mention';

comment on column public.user_agent_runs.trigger is
  'schedule = the hourly sweep; delegation = a child run started by delegate; '
  'mention = an @handle in an item update. Only schedule occupies a fire slot.';
```

Then the claim RPC in the same file:

```sql
create or replace function public.agent_run_claim(
  p_agent_id      uuid,
  p_trigger       text,
  p_parent_run_id uuid default null
) returns table (outcome text, run_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent    record;
  v_parent   record;
  v_actor    uuid := auth.uid();
  v_tz       text;
  v_today    date;
  v_depth    smallint := 0;
  v_siblings int;
  v_recent   int;
  v_runs     int;
  v_cap      int;
  v_id       uuid;
begin
  if p_trigger not in ('delegation','mention') then
    return query select 'refused_bad_trigger'::text, null::uuid; return;
  end if;

  -- The SAME row lock agent_remember takes, for the same reason: every count
  -- below is a count-then-insert, which is not atomic at READ COMMITTED.
  select ua.id, ua.org_id, ua.owner_id, ua.enabled
    into v_agent
    from public.user_agents ua
   where ua.id = p_agent_id
     for update;
  if not found then
    return query select 'refused_not_owner'::text, null::uuid; return;
  end if;

  -- v_actor is NULL under service_role (the delegation path runs inside the
  -- agent route). A session user may only ever summon their own agent.
  if v_actor is not null and v_actor <> v_agent.owner_id then
    return query select 'refused_not_owner'::text, null::uuid; return;
  end if;
  if not v_agent.enabled then
    return query select 'refused_disabled'::text, null::uuid; return;
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = v_agent.org_id;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  if p_trigger = 'delegation' then
    if p_parent_run_id is null then
      return query select 'refused_depth'::text, null::uuid; return;
    end if;
    select r.id, r.owner_id, r.depth, r.fire_date into v_parent
      from public.user_agent_runs r where r.id = p_parent_run_id for update;
    if not found or v_parent.owner_id <> v_agent.owner_id or v_parent.depth <> 0 then
      return query select 'refused_depth'::text, null::uuid; return;
    end if;
    select count(*) into v_siblings
      from public.user_agent_runs r where r.parent_run_id = p_parent_run_id;
    if v_siblings >= 3 then
      return query select 'refused_fanout'::text, null::uuid; return;
    end if;
    v_depth := 1;
    v_today := v_parent.fire_date;   -- a child belongs to its parent's day
  else
    if p_parent_run_id is not null then
      return query select 'refused_depth'::text, null::uuid; return;
    end if;
    select count(*) into v_recent
      from public.user_agent_runs r
     where r.user_agent_id = p_agent_id
       and r.trigger = 'mention'
       and r.created_at > now() - interval '5 minutes';
    if v_recent > 0 then
      return query select 'refused_cooldown'::text, null::uuid; return;
    end if;
    select s.max_agent_runs_per_user_per_day into v_cap
      from public.org_ai_settings s where s.org_id = v_agent.org_id;
    v_cap := coalesce(v_cap, 3);
    select count(*) into v_runs
      from public.user_agent_runs r
     where r.owner_id = v_agent.owner_id
       and r.org_id = v_agent.org_id
       and r.fire_date = v_today
       and r.parent_run_id is null;
    if v_runs >= v_cap then
      return query select 'refused_daily_cap'::text, null::uuid; return;
    end if;
  end if;

  insert into public.user_agent_runs
    (user_agent_id, org_id, owner_id, fire_date, fire_hour, status, error,
     parent_run_id, depth, trigger)
  values
    (v_agent.id, v_agent.org_id, v_agent.owner_id, v_today, null, 'error',
     'claimed; result not yet recorded', p_parent_run_id, v_depth, p_trigger)
  returning id into v_id;

  return query select 'claimed'::text, v_id;
end; $$;

revoke all on function public.agent_run_claim(uuid, text, uuid)
  from public, anon;
grant execute on function public.agent_run_claim(uuid, text, uuid)
  to authenticated, service_role;
```

The literal `'claimed; result not yet recorded'` must equal `CLAIM_PLACEHOLDER` in `src/lib/agents/run-status.ts:29` byte for byte — Step 12 adds the guard test.

- [ ] **Step 3: Write migration 2 — handles, `kind`, `'manual'`, the built-in seed**

```sql
alter table public.user_agents
  add column handle text,
  add column kind text not null default 'user';

with slugged as (
  select id, owner_id,
         nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), '') as s
    from public.user_agents
), candidate as (
  select id, owner_id,
         case
           when s is null or length(s) < 2
             or s in ('here','all','everyone','channel','admin','system','monolith','support','none','me')
           then 'agent-' || left(replace(id::text, '-', ''), 8)
           else left(s, 30)
         end as h
    from slugged
), ranked as (
  select id, h,
         row_number() over (partition by owner_id, h order by id) as n
    from candidate
)
update public.user_agents ua
   set handle = case when r.n = 1 then r.h else left(r.h, 28) || '-' || r.n end
  from ranked r where r.id = ua.id;

alter table public.user_agents
  alter column handle set not null,
  add constraint user_agents_kind_known check (kind in ('user','builtin')),
  add constraint user_agents_handle_shape check (handle ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  add constraint user_agents_handle_not_reserved check (handle not in
    ('here','all','everyone','channel','admin','system','monolith','support','none','me'));

create unique index user_agents_owner_handle_uniq
  on public.user_agents (owner_id, lower(handle));
create unique index user_agents_owner_builtin_uniq
  on public.user_agents (org_id, owner_id) where kind = 'builtin';

-- GLOBAL CONSTRAINT: column-scoped grants do not extend themselves.
-- `kind` is deliberately in NEITHER list — only seed_builtin_agent writes it.
grant insert (org_id, owner_id, name, template_id, instructions, board_scope,
              cadence, run_at_local_hour, enabled, provider, model_id,
              capabilities, run_on_weekday, run_on_day_of_month, handle)
  on public.user_agents to authenticated;
grant update (name, template_id, instructions, board_scope, cadence,
              run_at_local_hour, enabled, provider, model_id, capabilities,
              run_on_weekday, run_on_day_of_month, updated_at, handle)
  on public.user_agents to authenticated;

alter table public.user_agents drop constraint user_agents_cadence_check;
alter table public.user_agents add constraint user_agents_cadence_check
  check (cadence in ('daily','weekdays','weekly','monthly','manual'));
alter table public.user_agents drop constraint user_agents_cadence_fields;
alter table public.user_agents add constraint user_agents_cadence_fields check (
  (cadence in ('daily','weekdays','manual')
     and run_on_weekday is null and run_on_day_of_month is null)
  or (cadence = 'weekly'  and run_on_weekday is not null and run_on_day_of_month is null)
  or (cadence = 'monthly' and run_on_weekday is null and run_on_day_of_month is not null)
);
```

`_personal_agent_sweep` needs **no change**: its `case cadence ... else false end`
(`20260812060142:143-150`) already refuses an unrecognised cadence, so `'manual'` never fires.

Then the seed:

```sql
create or replace function public.seed_builtin_agent(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_handle text := 'assistant'; v_n int := 1;
begin
  while exists (select 1 from public.user_agents
                 where owner_id = p_user and lower(handle) = v_handle) loop
    v_n := v_n + 1; v_handle := 'assistant-' || v_n;
    if v_n > 20 then return; end if;
  end loop;
  insert into public.user_agents
    (org_id, owner_id, name, handle, kind, template_id, instructions,
     board_scope, cadence, run_at_local_hour, enabled, capabilities)
  values
    (p_org, p_user, 'Assistant', v_handle, 'builtin', 'builtin-orchestrator',
     'You coordinate this person''s other agents. When a question is better '
     'answered by a teammate, delegate it to them and combine what comes back '
     'into one short answer. Do the simple lookups yourself.',
     '{"mode":"all"}'::jsonb, 'manual', 7, true, array['agent.delegate']::text[])
  on conflict do nothing;
end; $$;

revoke all on function public.seed_builtin_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.seed_builtin_agent(uuid, uuid) to service_role;

create or replace function public.seed_builtin_agent_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.seed_builtin_agent(new.org_id, new.user_id); return new; end; $$;

drop trigger if exists org_members_seed_builtin_agent on public.org_members;
create trigger org_members_seed_builtin_agent
  after insert on public.org_members
  for each row execute function public.seed_builtin_agent_trigger();

-- One-time backfill for existing memberships.
do $$ declare m record; begin
  for m in select org_id, user_id from public.org_members loop
    perform public.seed_builtin_agent(m.org_id, m.user_id);
  end loop;
end $$;
```

`capabilities` is seeded with `agent.delegate`, which migration 3 adds to
`user_agents_capabilities_known` — so **migration 3 must apply before this backfill**, or the CHECK
rejects the seed. Order the two files so the delegate-vocabulary migration's version stamp is
**earlier**; mint it first.

- [ ] **Step 4: Write migration 3 — capability vocabulary, `ai_usage.run_id`, `record_ai_usage`, assistant name**

```sql
alter table public.user_agents drop constraint user_agents_capabilities_known;
alter table public.user_agents add constraint user_agents_capabilities_known
  check (capabilities <@ array['board.write','files.write','automation.create',
                              'time.log','memory.write','agent.delegate']::text[]);

alter table public.org_ai_settings drop constraint org_ai_settings_ceiling_known;
alter table public.org_ai_settings add constraint org_ai_settings_ceiling_known
  check (agent_capability_ceiling <@ array['board.write','files.write',
         'automation.create','time.log','memory.write','agent.delegate']::text[]);
alter table public.org_ai_settings alter column agent_capability_ceiling set default
  array['board.write','files.write','automation.create','time.log']::text[];

-- OPEN QUESTION 2 in the spec. Uncomment ONLY on the owner's explicit ruling:
-- update public.org_ai_settings
--    set agent_capability_ceiling = agent_capability_ceiling || 'agent.delegate'
--  where not ('agent.delegate' = any (agent_capability_ceiling));

alter table public.ai_usage add column run_id uuid;
create index ai_usage_run_idx on public.ai_usage (run_id) where run_id is not null;
comment on column public.ai_usage.run_id is
  'Correlation id for a user_agent_runs row. Deliberately NOT a foreign key: '
  'the ledger is money and must never fail to write because a run row was '
  'cascaded away.';

alter table public.org_ai_settings
  add column assistant_name text not null default 'Monolith Autopilot'
    check (length(trim(assistant_name)) between 1 and 40);

drop function if exists public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric, integer, integer);

create function public.record_ai_usage(
  p_org uuid, p_user uuid, p_feature text, p_provider text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_credits numeric,
  p_cache_read_tokens integer default 0, p_cache_write_tokens integer default 0,
  p_run_id uuid default null
) returns void language sql security definer set search_path = public as $$
  insert into public.ai_usage
    (org_id, user_id, feature, provider, model, input_tokens, output_tokens,
     cost_usd, credits, cache_read_tokens, cache_write_tokens, run_id)
  values
    (p_org, p_user, p_feature, p_provider, p_model, p_input_tokens, p_output_tokens,
     p_cost_usd, p_credits, coalesce(p_cache_read_tokens, 0),
     coalesce(p_cache_write_tokens, 0), p_run_id);
$$;

-- GLOBAL CONSTRAINT: grants do NOT survive the drop. Restate both, against the
-- new 12-argument signature. Nothing in typecheck/lint/test/build catches this.
revoke all on function public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric,
  integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric,
  integer, integer, uuid) to service_role;
```

- [ ] **Step 5: Write migration 4 — the enum value, alone**

```sql
alter type public.notification_kind add value if not exists 'agent_reply';
```

Nothing else in the file. A new enum value cannot be referenced in the transaction that adds it —
header prose to copy: `supabase/migrations/20260801095917_agent_briefing_notification_kind.sql`.

- [ ] **Step 6: Apply to DEV and verify the ledger**

Apply each file through the `supabase-dev` MCP `apply_migration` with the **same version + name**
as the committed filename, in version order. Then:

```bash
pnpm db:ledger-check
```

Expected: in sync, exit 0. A ledger row with no committed file is exit 2 and always a defect.

- [ ] **Step 7: Regenerate types**

Call the `supabase-dev` MCP `generate_typescript_types`, write the result to
`src/types/database.types.ts`, then `pnpm format`. Confirm `Enums.notification_kind` now contains
`agent_reply` and `Tables.user_agent_runs.Row` contains `parent_run_id`, `depth`, `trigger`.

- [ ] **Step 8: Write the failing gateway test**

Add to `src/lib/ai/gateway.test.ts`:

```ts
it("passes runId through to record_ai_usage as p_run_id", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  // ...existing service-client + catalog stubs from this file's other cases...
  await runAi(
    { orgId: ORG, userId: USER, feature: "personal_agent_run", runId: RUN },
    async () => ({ result: null, usage: { inputTokens: 10, outputTokens: 5 } }),
  );
  expect(rpc).toHaveBeenCalledWith(
    "record_ai_usage",
    expect.objectContaining({ p_run_id: RUN }),
  );
});

it("omits p_run_id as null when no runId is given", async () => {
  // same setup, no runId
  expect(rpc).toHaveBeenCalledWith(
    "record_ai_usage",
    expect.objectContaining({ p_run_id: null }),
  );
});
```

- [ ] **Step 9: Run it and watch it fail**

Run: `pnpm vitest run src/lib/ai/gateway.test.ts`
Expected: FAIL — `p_run_id` is not in the call.

- [ ] **Step 10: Thread `runId` through `runAi`**

In `src/lib/ai/gateway.ts`, add to `runAi`'s `args` object type, immediately after `tier`:

```ts
    /**
     * The `user_agent_runs.id` this call belongs to, when there is one.
     * Correlation only — `ai_usage.run_id` has no foreign key, so a deleted
     * run never fails the ledger write. Nested agent runs pass their OWN id,
     * which is what makes a delegated child's spend attributable at all.
     */
    runId?: string;
```

and inside `meter`, after `p_credits: credits,`:

```ts
      p_run_id: args.runId ?? null,
```

- [ ] **Step 11: Run the gateway tests**

Run: `pnpm vitest run src/lib/ai/gateway.test.ts`
Expected: PASS.

- [ ] **Step 12: Add the SQL/TS contract guard**

Create `src/lib/agents/claim-placeholder.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAIM_PLACEHOLDER } from "./run-status";

describe("agent_run_claim", () => {
  it("inserts the exact CLAIM_PLACEHOLDER string the UI decodes", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const file = readdirSync(dir).find((f) =>
      f.endsWith("_agent_run_graph.sql"),
    );
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file!), "utf8");
    expect(sql).toContain(`'${CLAIM_PLACEHOLDER}'`);
  });
});
```

- [ ] **Step 13: Run the full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 14: Commit**

```bash
git add supabase/migrations src/types/database.types.ts src/lib/ai/gateway.ts \
        src/lib/ai/gateway.test.ts src/lib/agents/claim-placeholder.test.ts
git commit -m "feat(db): agent run graph, handles, delegate capability, usage run correlation"
```

---

## Task 2: Capability, handle and cadence vocabulary

**Files:**

- Create: `src/lib/agents/handle.ts`, `src/lib/agents/handle.test.ts`
- Modify: `src/lib/agents/capabilities.ts:7-15`, `src/lib/agents/capability-copy.ts:11-38`, `src/lib/agents/agent-config.ts:17-115`
- Test: `src/lib/agents/agent-config.test.ts`, `src/components/agents/CapabilityToggles.test.tsx`

**Interfaces:**

- Consumes: nothing (pure TS; no DB shapes).
- Produces: `AGENT_CAPABILITIES` including `"agent.delegate"`; `AGENT_CADENCES` including `"manual"`; `HANDLE_MIN = 2`, `HANDLE_MAX = 32`, `RESERVED_HANDLES: readonly string[]`, `handleSchema: z.ZodString`, `slugifyHandle(name: string, id: string): string`; `personalAgentSettingsSchema` with a required `handle: string`; `PersonalAgentSettings` gains `handle`.

- [ ] **Step 1: Write the failing handle tests**

Create `src/lib/agents/handle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { handleSchema, slugifyHandle, RESERVED_HANDLES } from "./handle";

describe("handleSchema", () => {
  it.each(["ops", "ops-chaser", "a1", "x".repeat(32)])("accepts %s", (h) => {
    expect(handleSchema.safeParse(h).success).toBe(true);
  });
  it.each(["a", "Ops", "ops chaser", "-ops", "ops!", "x".repeat(33), ""])(
    "rejects %s",
    (h) => expect(handleSchema.safeParse(h).success).toBe(false),
  );
  it("rejects every reserved handle", () => {
    for (const r of RESERVED_HANDLES) {
      expect(handleSchema.safeParse(r).success).toBe(false);
    }
  });
});

describe("slugifyHandle", () => {
  const ID = "9f1c2b3d-0000-4000-8000-000000000000";
  it("slugifies a display name", () => {
    expect(slugifyHandle("Overdue Chaser", ID)).toBe("overdue-chaser");
  });
  it("collapses punctuation and trims hyphens", () => {
    expect(slugifyHandle("  Risk // Spotter!  ", ID)).toBe("risk-spotter");
  });
  it("falls back to the id when the slug is empty", () => {
    expect(slugifyHandle("!!!", ID)).toBe("agent-9f1c2b3d");
  });
  it("falls back to the id when the slug is reserved", () => {
    expect(slugifyHandle("System", ID)).toBe("agent-9f1c2b3d");
  });
  it("truncates to HANDLE_MAX", () => {
    expect(slugifyHandle("x".repeat(80), ID)).toHaveLength(32);
  });
  it("always produces something handleSchema accepts", () => {
    for (const n of ["", "  ", "A", "ops", "!!!", "x".repeat(99)]) {
      expect(handleSchema.safeParse(slugifyHandle(n, ID)).success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/agents/handle.test.ts`
Expected: FAIL — cannot resolve `./handle`.

- [ ] **Step 3: Implement `handle.ts`**

```ts
import { z } from "zod";

/**
 * A handle is the TYPEABLE name of an agent. Free of `server-only`: the mention
 * autocomplete, the agent editor and the migration's backfill all speak it.
 *
 * The shape is dictated by `activeMentionQuery` (src/lib/collaboration/mentions.ts),
 * which terminates a mention token at the first whitespace — so a handle may not
 * contain one. Lowercase-only keeps `unique (owner_id, lower(handle))` and the
 * typed token in agreement without a case-folding step at every call site.
 *
 * Mirrors, exactly, `user_agents_handle_shape` and
 * `user_agents_handle_not_reserved` in the agent_handles_and_builtin migration.
 * `handle-parity.test.ts` fails if the two lists drift.
 */
export const HANDLE_MIN = 2;
export const HANDLE_MAX = 32;

/** Names that must never address one person's agent, because they read as
 *  addressing everyone, the platform, or an administrator. */
export const RESERVED_HANDLES = [
  "here",
  "all",
  "everyone",
  "channel",
  "admin",
  "system",
  "monolith",
  "support",
  "none",
  "me",
] as const;

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const handleSchema = z
  .string()
  .trim()
  .min(HANDLE_MIN, `Handle must be at least ${HANDLE_MIN} characters.`)
  .max(HANDLE_MAX, `Handle must be at most ${HANDLE_MAX} characters.`)
  .regex(
    HANDLE_RE,
    "Use lowercase letters, numbers and hyphens; start with a letter or number.",
  )
  .refine((h) => !(RESERVED_HANDLES as readonly string[]).includes(h), {
    message: "That handle is reserved.",
  });

/**
 * Derive a legal handle from a display name. TOTAL by construction — every
 * input produces something `handleSchema` accepts, because the caller (the
 * editor's prefill, and the migration's backfill) has no second chance.
 */
export function slugifyHandle(name: string, id: string): string {
  const fallback = `agent-${id.replace(/-/g, "").slice(0, 8)}`;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_MAX);
  if (slug.length < HANDLE_MIN) return fallback;
  if ((RESERVED_HANDLES as readonly string[]).includes(slug)) return fallback;
  return slug;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run src/lib/agents/handle.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the SQL/TS parity guard**

Create `src/lib/agents/handle-parity.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_HANDLES } from "./handle";

describe("reserved handles", () => {
  it("match the CHECK constraint in the migration", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const f = readdirSync(dir).find((n) =>
      n.endsWith("_agent_handles_and_builtin.sql"),
    );
    expect(f).toBeDefined();
    const sql = readFileSync(join(dir, f!), "utf8");
    for (const h of RESERVED_HANDLES) expect(sql).toContain(`'${h}'`);
  });
});
```

- [ ] **Step 6: Add `agent.delegate` to the vocabulary and its copy**

`src/lib/agents/capabilities.ts` — append to `AGENT_CAPABILITIES`:

```ts
  "agent.delegate",
```

`src/lib/agents/capability-copy.ts` — add to `CAPABILITY_COPY`:

```ts
  "agent.delegate": {
    label: "Ask your other agents for help",
    consequence:
      "This agent can hand a task to up to three of your other agents in one " +
      "run and use what they report back. Each of them acts under its own " +
      "permissions, never this one's.",
  },
```

- [ ] **Step 7: Widen `agent-config.ts`**

`AGENT_CADENCES` — add `"manual"` after `"monthly"`. `capabilitySchema` — bump `.max(5)` to
`.max(6)`. Add to `personalAgentSettingsSchema`, immediately after `name`:

```ts
  handle: handleSchema,
```

with `import { handleSchema } from "./handle";` at the top. Add to `cadenceFieldsMatch`'s switch:

```ts
    case "manual":
      return v.runOnWeekday === null && v.runOnDayOfMonth === null;
```

and add `manual: "Only when I ask"` to `CADENCE_LABELS` in `AgentEditor.tsx:68-73` — the editor's
select is driven by that map, so a value missing from it renders as an empty option.

- [ ] **Step 8: Add the vocabulary parity test**

Append to `src/components/agents/CapabilityToggles.test.tsx`:

```ts
it("has copy for every capability in the vocabulary", () => {
  expect(Object.keys(CAPABILITY_COPY).sort()).toEqual(
    [...AGENT_CAPABILITIES].sort(),
  );
});
```

- [ ] **Step 9: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: `agent-config.test.ts` fails on fixtures missing `handle` — add `handle: "ops"` to each
fixture object in that file and in `src/lib/agents/actions.test.ts`. Re-run until green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/agents/handle.ts src/lib/agents/handle.test.ts \
        src/lib/agents/handle-parity.test.ts src/lib/agents/capabilities.ts \
        src/lib/agents/capability-copy.ts src/lib/agents/agent-config.ts \
        src/lib/agents/agent-config.test.ts src/lib/agents/actions.test.ts \
        src/components/agents/CapabilityToggles.test.tsx
git commit -m "feat(agents): agent.delegate capability, handles, manual cadence"
```

---

## Task 3: Extract `executeAgentRun`

**Files:**

- Create: `src/lib/agents/execute-run.ts`, `src/lib/agents/execute-run.test.ts`
- Modify: `src/app/api/ai/personal-agent/route.ts:300-520`
- Test: `src/app/api/ai/personal-agent/route.test.ts` (must stay green **unchanged** — that is the proof this is a pure extraction)

**Interfaces:**

- Consumes: nothing new.
- Produces:

```ts
export type RunProgress = {
  steps: number;
  toolsUsed: string[];
  grants: AgentCapability[];
  modelSubstituted: boolean;
};
export function newRunProgress(): RunProgress;
export type ExecuteRunResult = {
  text: string;
  usage: AiUsageTokens;
  steps: number;
  toolsUsed: string[];
  documentsOmitted: boolean;
  memoryNotesDropped: number;
};
export async function executeAgentRun(args: {
  svc: SupabaseClient<Database>;
  ownerClient: SupabaseClient<Database>;
  agent: UserAgentRow;
  runId: string;
  ceiling: AgentCapability[];
  /** Replaces the default "Do your work for today…" user message. */
  task?: string;
  /** Adds the `delegate` descriptor. FALSE for a child run — depth is capped. */
  allowDelegation: boolean;
  /** Mutated after every completed step so a caller's catch can still write an
   *  honest audit row for a run that died mid-loop. */
  progress: RunProgress;
}): Promise<ExecuteRunResult>;
```

- [ ] **Step 1: Create `execute-run.ts` by moving code, not rewriting it**

Move, verbatim, from `route.ts`: the `proposals`/`persistProposals` closure, the
`readOrgAiSettings`-derived `effectiveGrants` filter, the whole `runAi(...)` call including the
document/memory budget block, `buildAgentRuntime`, and `runAgentLoop`. Keep every comment. The
function ends by returning the loop result; it does **not** finalize the run row and does **not**
send email — those stay in the route so the existing ordering (proposals → thread → email →
finalize) is unchanged.

`allowDelegation` is threaded but unused in this task (`extra` is still
`[...AGENT_ONLY_DESCRIPTORS, ...makeMemoryDescriptors(...)]`); Task 5 fills it. Add a comment saying
so, so a reviewer does not read it as dead.

Thread `runId: args.runId` into the `runAi({ ... })` args object — the correlation Task 1 added.

- [ ] **Step 2: Rewrite the route's body to call it**

In `route.ts`, replace the extracted region with:

```ts
const progress = newRunProgress();
let result: ExecuteRunResult;
try {
  result = await executeAgentRun({
    svc,
    ownerClient,
    agent,
    runId: claim.runId,
    ceiling: agentCapabilityCeiling,
    allowDelegation: false, // Task 5 flips this to true for root runs
    progress,
  });
} catch (e) {
  /* the EXISTING PersonalAiKeyMissingError / ByoKeyMissingError /
                     ModelNotToolCapableError branches, unchanged */
}
```

and replace the four `safeFinalize` field sources (`effectiveGrants`, `loopSteps`,
`loopToolsUsed`, `modelSubstituted`) with `progress.grants`, `progress.steps`,
`progress.toolsUsed`, `progress.modelSubstituted`.

- [ ] **Step 3: Run the route's existing tests unchanged**

Run: `pnpm vitest run src/app/api/ai/personal-agent/route.test.ts`
Expected: PASS with **zero edits to the test file**. If a test needed changing, the extraction was
not pure — revert and redo.

- [ ] **Step 4: Add one test that pins the seam**

Create `src/lib/agents/execute-run.test.ts`:

```ts
it("uses the default task when none is given", async () => {
  const loop = vi.mocked(runAgentLoop);
  await executeAgentRun({ ...baseArgs });
  expect(loop.mock.calls[0]![0].task).toBeUndefined();
});

it("passes an explicit task straight through", async () => {
  const loop = vi.mocked(runAgentLoop);
  await executeAgentRun({ ...baseArgs, task: "Answer @ops about item 7." });
  expect(loop.mock.calls[0]![0].task).toBe("Answer @ops about item 7.");
});

it("records the effective grants on progress before the loop runs", async () => {
  const progress = newRunProgress();
  await executeAgentRun({
    ...baseArgs,
    progress,
    agent: { ...agentFixture, capabilities: ["board.write", "time.log"] },
    ceiling: ["board.write"],
  });
  expect(progress.grants).toEqual(["board.write"]);
});
```

(`task` is not yet a `runAgentLoop` parameter — Task 5 adds it. Until then the first two cases
assert against the value `executeAgentRun` forwards; mark them `it.todo` if `runAgentLoop`'s type
has not landed and un-todo them in Task 5's Step 4.)

- [ ] **Step 5: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/execute-run.ts src/lib/agents/execute-run.test.ts \
        src/app/api/ai/personal-agent/route.ts
git commit -m "refactor(agents): extract executeAgentRun from the personal-agent route"
```

---

## Task 4: The client mention model

**Files:**

- Modify: `src/lib/collaboration/mentions.ts`, `src/lib/collaboration/mentions.test.ts`, `src/lib/validations/collaboration-actions.ts:1-26`, `src/lib/validations/collaboration-actions.test.ts`, `src/components/boards/item-panel/MentionTextarea.tsx`, `src/components/boards/item-panel/UpdatesTab.tsx:22-99`, `src/lib/collaboration/use-update-mutations.ts:31-147`, `src/lib/collaboration/actions.ts:23-86`
- Test: `src/components/boards/item-panel/MentionTextarea.test.tsx`, `src/lib/collaboration/actions.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
export type MentionTarget =
  | { kind: "user"; userId: string; fullName: string | null }
  | { kind: "agent"; agentId: string; handle: string; name: string };
export function mentionLabel(t: MentionTarget): string;   // "@Ada Lovelace" | "@ops"
export const mentionTargetSchema: z.ZodDiscriminatedUnion<...>;
export type MentionTargetInput = z.infer<typeof mentionTargetSchema>;
// addUpdate({ itemId, text, mentions: MentionTargetInput[] })
```

- [ ] **Step 1: Write the failing mention tests**

Append to `src/lib/collaboration/mentions.test.ts`:

```ts
it("inserts a display name for a user target", () => {
  const r = applyMention("hi @ad", 6, {
    kind: "user",
    userId: "u1",
    fullName: "Ada Lovelace",
  });
  expect(r.text).toBe("hi @Ada Lovelace ");
});

it("inserts a handle for an agent target", () => {
  const r = applyMention("hi @op", 6, {
    kind: "agent",
    agentId: "a1",
    handle: "ops",
    name: "Ops",
  });
  expect(r.text).toBe("hi @ops ");
});

it("labels each kind for display", () => {
  expect(mentionLabel({ kind: "user", userId: "u", fullName: null })).toBe(
    "@Someone",
  );
  expect(
    mentionLabel({ kind: "agent", agentId: "a", handle: "ops", name: "Ops" }),
  ).toBe("@ops");
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/collaboration/mentions.test.ts`
Expected: FAIL — `mentionLabel` is not exported; `applyMention` reads `target.fullName` only.

- [ ] **Step 3: Widen `mentions.ts`**

```ts
/**
 * A mention target is a PERSON or one of the author's own AGENTS.
 *
 * The two carry different text: a person's mention writes their DISPLAY NAME
 * (which may contain spaces and is matched back out by `renderBody`), while an
 * agent's writes its HANDLE — which is what makes an agent mention typeable.
 * `activeMentionQuery` terminates a token at the first whitespace, so a
 * multi-word name can only ever be CLICKED; a handle can be typed straight
 * through, which is the whole point of Spec 3's addressing half.
 */
export type MentionTarget =
  | { kind: "user"; userId: string; fullName: string | null }
  | { kind: "agent"; agentId: string; handle: string; name: string };

export function mentionLabel(target: MentionTarget): string {
  return target.kind === "agent"
    ? `@${target.handle}`
    : `@${target.fullName ?? "Someone"}`;
}
```

and in `applyMention` replace the `const label = ...` line with:

```ts
const label = `${mentionLabel(target)} `;
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm vitest run src/lib/collaboration/mentions.test.ts`
Expected: PASS.

- [ ] **Step 5: Widen the Zod boundary**

In `src/lib/validations/collaboration-actions.ts`:

```ts
/**
 * A mention is now TAGGED. It used to be a bare uuid array, which was fine when
 * every target was a person — but an agent id and a user id are both uuids, so
 * an untagged array forces the server to guess which table to look in and makes
 * "an agent id you do not own" indistinguishable from a typo.
 *
 * `.max(20)` is new and not incidental: the array was UNBOUNDED, and
 * `actions.ts` fans out one notification INSERT per entry with no cap.
 */
export const mentionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().uuid() }),
  z.object({ kind: z.literal("agent"), agentId: z.string().uuid() }),
]);
export type MentionTargetInput = z.infer<typeof mentionTargetSchema>;

export const addUpdateSchema = z.object({
  itemId: z.string().uuid(),
  text: TEXT,
  mentions: z.array(mentionTargetSchema).max(20).default([]),
});
```

- [ ] **Step 6: Update the server fan-out to read tagged targets**

In `src/lib/collaboration/actions.ts`, replace the recipients line (currently
`const recipients = [...new Set(parsed.data.mentions)].filter(id => id !== user.id)`):

```ts
// Humans only here. Agent targets are handled by Task 11's trigger path; an
// agent has no `profiles` row, so a notification row for one would be
// undeliverable and `gate_notification_by_pref` has nothing to gate.
const recipients = [
  ...new Set(
    parsed.data.mentions.filter((m) => m.kind === "user").map((m) => m.userId),
  ),
].filter((id) => id !== user.id);
```

The `body` jsonb keeps the parsed array as-is (`mentions: parsed.data.mentions`), so the stored
shape is self-describing.

- [ ] **Step 7: Update the client chain**

`MentionTextarea.tsx`: rename the `mentionIds: string[]` prop to `mentions: MentionTargetInput[]`,
`onChange: (text: string, mentions: MentionTargetInput[]) => void`; filter candidates on
`mentionLabel(m).slice(1).toLowerCase().includes(q)` so a handle matches; in `choose`, push
`m.kind === "agent" ? { kind: "agent", agentId: m.agentId } : { kind: "user", userId: m.userId }`,
deduping on `JSON.stringify`; render `mentionLabel(m)` in the dropdown with the agent's `name` as
secondary text.

`UpdatesTab.tsx`: `members` becomes `targets: readonly MentionTarget[]`; the reconciliation filter
becomes "keep a target whose `mentionLabel` still appears literally in the trimmed body";
`renderBody`'s candidate list becomes `targets.map(mentionLabel).map(l => l.slice(1))` (still
deduped and sorted longest-first, so `@Ada Lovelace` still beats `@Ada`).

`use-update-mutations.ts`: `addUpdate: (text: string, mentions: MentionTargetInput[]) => ...`.

`ItemPanel.tsx` / `BoardViews.tsx` / `boards/[boardId]/page.tsx`: build `targets` by mapping the
existing `members` array to `{ kind: "user", ... }` and the page's **already-fetched** owner agents
(`page.tsx:37-41`) to `{ kind: "agent", agentId: a.id, handle: a.handle, name: a.name }`. Add
`handle` to that query's select list. **No new query.**

- [ ] **Step 8: Update and extend the component tests**

In `MentionTextarea.test.tsx`, update the existing assertion to the new prop names, then add:

```tsx
it("completes an agent by handle and emits a tagged target", async () => {
  const onChange = vi.fn();
  render(
    <MentionTextarea
      value="ping @op"
      mentions={[]}
      targets={[
        { kind: "agent", agentId: "a1", handle: "ops", name: "Ops Chaser" },
      ]}
      onChange={onChange}
    />,
  );
  await userEvent.click(await screen.findByRole("button", { name: /ops/i }));
  expect(onChange).toHaveBeenCalledWith("ping @ops ", [
    { kind: "agent", agentId: "a1" },
  ]);
});
```

In `src/lib/collaboration/actions.test.ts`, update the mention fixtures to tagged targets and add:

```ts
it("does not create a notification row for an agent target", async () => {
  /* … */
});
it("rejects more than 20 mentions", () => {
  const many = Array.from({ length: 21 }, () => ({
    kind: "user",
    userId: crypto.randomUUID(),
  }));
  expect(
    addUpdateSchema.safeParse({
      itemId: crypto.randomUUID(),
      text: "x",
      mentions: many,
    }).success,
  ).toBe(false);
});
```

- [ ] **Step 9: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/collaboration src/lib/validations/collaboration-actions.ts \
        src/lib/validations/collaboration-actions.test.ts \
        src/components/boards/item-panel src/components/boards/BoardViews.tsx \
        "src/app/(app)/boards/[boardId]/page.tsx"
git commit -m "feat(collab): tagged mention targets, agents addressable by handle"
```

---

## Task 5: The `delegate` tool and nested runs

**Files:**

- Create: `src/lib/agents/run-claim.ts`, `src/lib/agents/run-claim.test.ts`, `src/lib/agents/delegate-tool.ts`, `src/lib/agents/delegate-tool.test.ts`
- Modify: `src/lib/agents/run-loop.ts:255-340`, `src/lib/agents/execute-run.ts`
- Test: `src/lib/agents/run-loop.test.ts`, `src/lib/agents/execute-run.test.ts`

**Interfaces:**

- Consumes: `agent_run_claim` RPC (Task 1); `AGENT_CAPABILITIES` with `"agent.delegate"` (Task 2); `executeAgentRun`, `RunProgress`, `newRunProgress` (Task 3).
- Produces:

```ts
export const DELEGATE_FANOUT_MAX = 3;
export const DELEGATE_REPORT_MAX_CHARS = 4000;
export type ClaimOutcome =
  | "claimed"
  | "refused_bad_trigger"
  | "refused_not_owner"
  | "refused_disabled"
  | "refused_depth"
  | "refused_fanout"
  | "refused_cooldown"
  | "refused_daily_cap";
export async function claimAgentRun(
  client: SupabaseClient<Database>,
  args: {
    agentId: string;
    trigger: "delegation" | "mention";
    parentRunId?: string | null;
  },
): Promise<{ outcome: ClaimOutcome; runId: string | null }>;
export const CLAIM_REFUSAL_COPY: Record<
  Exclude<ClaimOutcome, "claimed">,
  string
>;
export type DelegateRosterEntry = {
  id: string;
  handle: string;
  name: string;
  instructions: string;
};
export function makeDelegateDescriptors(args: {
  svc: SupabaseClient<Database>;
  ownerClient: SupabaseClient<Database>;
  parentRunId: string;
  ceiling: AgentCapability[];
  roster: DelegateRosterEntry[];
}): ToolDescriptor[];
// run-loop.ts:
export const DEFAULT_RUN_TASK =
  "Do your work for today. Report what you did in a short summary.";
// runAgentLoop gains `task?: string`
```

- [ ] **Step 1: Write the failing `run-claim` test**

Create `src/lib/agents/run-claim.test.ts`:

```ts
it("returns the RPC's outcome and run id", async () => {
  const client = fakeClient({
    agent_run_claim: [{ outcome: "claimed", run_id: "r1" }],
  });
  await expect(
    claimAgentRun(client, { agentId: "a1", trigger: "mention" }),
  ).resolves.toEqual({ outcome: "claimed", runId: "r1" });
});

it("returns a refusal with a null run id", async () => {
  const client = fakeClient({
    agent_run_claim: [{ outcome: "refused_fanout", run_id: null }],
  });
  await expect(
    claimAgentRun(client, {
      agentId: "a1",
      trigger: "delegation",
      parentRunId: "p",
    }),
  ).resolves.toEqual({ outcome: "refused_fanout", runId: null });
});

it("treats an RPC error as a refusal rather than throwing", async () => {
  const client = fakeClient({ agent_run_claim: new Error("boom") });
  const r = await claimAgentRun(client, { agentId: "a1", trigger: "mention" });
  expect(r.runId).toBeNull();
});

it("has copy for every refusal outcome", () => {
  const outcomes: ClaimOutcome[] = [
    "refused_bad_trigger",
    "refused_not_owner",
    "refused_disabled",
    "refused_depth",
    "refused_fanout",
    "refused_cooldown",
    "refused_daily_cap",
  ];
  for (const o of outcomes) expect(CLAIM_REFUSAL_COPY[o]).toBeTruthy();
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/agents/run-claim.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `run-claim.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { typedRpc } from "@/lib/supabase/typed-rpc";

export const DELEGATE_FANOUT_MAX = 3;

export type ClaimOutcome =
  | "claimed"
  | "refused_bad_trigger"
  | "refused_not_owner"
  | "refused_disabled"
  | "refused_depth"
  | "refused_fanout"
  | "refused_cooldown"
  | "refused_daily_cap";

/**
 * Sentences for the MODEL and for the user, not log lines. Named refusals, the
 * `remember`/`refused_cap` lesson: a model told only "denied" re-proposes the
 * same call until it runs out of steps, so every refusal says what was wrong
 * AND what to do instead.
 */
export const CLAIM_REFUSAL_COPY: Record<
  Exclude<ClaimOutcome, "claimed">,
  string
> = {
  refused_bad_trigger: "That is not a runnable trigger.",
  refused_not_owner: "That agent does not belong to you.",
  refused_disabled:
    "That agent is switched off. Switch it on in Settings → Agents to use it.",
  refused_depth:
    "An agent you were delegated to cannot delegate again. Do this part yourself.",
  refused_fanout: `You have already delegated ${DELEGATE_FANOUT_MAX} times this run, the maximum. Finish with what you have.`,
  refused_cooldown:
    "That agent ran less than five minutes ago. Give it a moment before asking again.",
  refused_daily_cap:
    "You have used up today's agent runs for this organization.",
};

/**
 * The ONE way a non-scheduled run comes into existence. Everything the model or
 * a mention could otherwise skip — depth, fan-out, the cooldown, the daily cap,
 * ownership, the kill switch — is decided inside `agent_run_claim`, under a row
 * lock, because count-then-insert is not atomic at READ COMMITTED. This wrapper
 * adds types and copy; it must never add a check of its own, or the check that
 * matters would live in two places.
 */
export async function claimAgentRun(
  client: SupabaseClient<Database>,
  args: {
    agentId: string;
    trigger: "delegation" | "mention";
    parentRunId?: string | null;
  },
): Promise<{ outcome: ClaimOutcome; runId: string | null }> {
  const { data, error } = await typedRpc(client, "agent_run_claim", {
    p_agent_id: args.agentId,
    p_trigger: args.trigger,
    p_parent_run_id: args.parentRunId ?? null,
  });
  if (error || !data?.[0]) {
    if (error) console.error("[agents] agent_run_claim failed:", error.message);
    return { outcome: "refused_not_owner", runId: null };
  }
  return {
    outcome: data[0].outcome as ClaimOutcome,
    runId: data[0].run_id ?? null,
  };
}
```

- [ ] **Step 4: Add `task` to `runAgentLoop`**

In `src/lib/agents/run-loop.ts`, export the default and add the parameter:

```ts
/** What an unattended scheduled run is asked to do. Extracted so a summoned run
 *  can replace it without the two drifting into two different prompts. */
export const DEFAULT_RUN_TASK =
  "Do your work for today. Report what you did in a short summary.";
```

add to the args type:

```ts
  /** Replaces the default user message. A mention run passes the update it was
   *  summoned by; a delegated child passes the task its parent handed it. The
   *  system message is unchanged either way — this is the USER turn, which is
   *  outside the cached prefix, so a per-run task costs no cache. */
  task?: string;
```

and change the user message content to `args.task ?? DEFAULT_RUN_TASK`.

Un-`todo` the two `task` assertions in `execute-run.test.ts` from Task 3 Step 4, and add to
`run-loop.test.ts`:

```ts
it("sends DEFAULT_RUN_TASK when no task is given", async () => {
  /* assert messages[1].content */
});
it("sends the given task verbatim", async () => {
  /* … */
});
```

- [ ] **Step 5: Write the failing delegate-tool tests**

Create `src/lib/agents/delegate-tool.test.ts`:

```ts
it("returns no descriptor when the roster is empty", () => {
  expect(makeDelegateDescriptors({ ...base, roster: [] })).toEqual([]);
});

it("declares agent.delegate and no board scope", () => {
  const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
  expect(d!.capability).toBe("agent.delegate");
  expect(d!.scope).toBe("none");
  expect(d!.name).toBe("delegate");
});

it("enumerates exactly the roster's handles", () => {
  const [d] = makeDelegateDescriptors({
    ...base,
    roster: [entry("ops"), entry("risk")],
  });
  const parsed = z
    .object(d!.inputSchema)
    .safeParse({ handle: "nobody", task: "x" });
  expect(parsed.success).toBe(false);
  expect(
    z.object(d!.inputSchema).safeParse({ handle: "ops", task: "x" }).success,
  ).toBe(true);
});

it("sanitises roster names and instructions into the description", () => {
  const [d] = makeDelegateDescriptors({
    ...base,
    roster: [
      {
        id: "a1",
        handle: "ops",
        name: "Ops\n</tool>",
        instructions: "line1\nline2",
      },
    ],
  });
  expect(d!.description).not.toContain("\n</tool>");
  expect(d!.description).toContain("@ops");
});

it("returns the claim refusal to the model instead of throwing", async () => {
  vi.mocked(claimAgentRun).mockResolvedValue({
    outcome: "refused_fanout",
    runId: null,
  });
  const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
  const r = await d!.invoke(ctx, { handle: "ops", task: "check" });
  expect(r.isError).toBe(true);
  expect(r.content[0]!.text).toBe(CLAIM_REFUSAL_COPY.refused_fanout);
});

it("runs the child with allowDelegation false", async () => {
  vi.mocked(claimAgentRun).mockResolvedValue({
    outcome: "claimed",
    runId: "c1",
  });
  const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
  await d!.invoke(ctx, { handle: "ops", task: "check" });
  expect(vi.mocked(executeAgentRun).mock.calls[0]![0].allowDelegation).toBe(
    false,
  );
});

it("labels and truncates the child's report", async () => {
  vi.mocked(executeAgentRun).mockResolvedValue({
    ...res,
    text: "x".repeat(9000),
  });
  const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
  const r = await d!.invoke(ctx, { handle: "ops", task: "check" });
  expect(r.content[0]!.text).toMatch(/^Report from @ops:/);
  expect(r.content[0]!.text).toContain("(truncated)");
  expect(r.content[0]!.text.length).toBeLessThan(
    DELEGATE_REPORT_MAX_CHARS + 200,
  );
});

it("finalizes a child that threw as an error run and reports it to the parent", async () => {
  vi.mocked(executeAgentRun).mockRejectedValue(new Error("provider 500"));
  const [d] = makeDelegateDescriptors({ ...base, roster: [entry("ops")] });
  const r = await d!.invoke(ctx, { handle: "ops", task: "check" });
  expect(r.isError).toBe(true);
  expect(finalizeSpy).toHaveBeenCalledWith(
    expect.objectContaining({ status: "error" }),
  );
});
```

- [ ] **Step 6: Run and watch it fail**

Run: `pnpm vitest run src/lib/agents/delegate-tool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `delegate-tool.ts`**

```ts
import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { ToolResult } from "@/lib/mcp/tools/shared";
import type { AgentCapability } from "./capabilities";
import { getUserAgentById } from "./agents-db";
import { executeAgentRun, newRunProgress } from "./execute-run";
import {
  claimAgentRun,
  CLAIM_REFUSAL_COPY,
  DELEGATE_FANOUT_MAX,
} from "./run-claim";

export const DELEGATE_REPORT_MAX_CHARS = 4000;
const ROSTER_BLURB_CHARS = 120;

export type DelegateRosterEntry = {
  id: string;
  handle: string;
  name: string;
  instructions: string;
};

/** Neutralise owner-authored text bound for a single line of a tool
 *  DESCRIPTION: strip newlines (which could start a line the model reads as a
 *  new rule) and angle brackets (which could open or close a delimiter). The
 *  same function `persona.ts` applies to an agent name — kept identical on
 *  purpose; if one hardens, both should. */
function sanitizeInline(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "");
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * ONE tool, not one per agent.
 *
 * A tool named after a handle would make the TOOL NAMESPACE a function of
 * user-authored text, and `descriptorsFor` throws `DuplicateToolNameError` on
 * any collision — deliberately, because silent shadowing is how an extra write
 * tool once executed ungated. That turns "two awkward handles" into a run that
 * dies at construction. A single tool with a server-built enum makes the
 * collision unrepresentable, keeps the schema cost O(1), and keeps fan-out
 * enforcement in one handler.
 *
 * Returns [] for an empty roster: no teammates means no tool, no context spent,
 * and no `z.enum([])` (which is not a valid schema).
 *
 * MUST be passed as `buildAgentRuntime`'s `extra` — the SAME array reaching
 * both `buildAgentTools` and `makeGrantGate`, or the tool is offered and then
 * denied "Unknown tool." on every call.
 */
export function makeDelegateDescriptors(args: {
  svc: SupabaseClient<Database>;
  ownerClient: SupabaseClient<Database>;
  parentRunId: string;
  ceiling: AgentCapability[];
  roster: DelegateRosterEntry[];
}): ToolDescriptor[] {
  if (args.roster.length === 0) return [];

  const byHandle = new Map(args.roster.map((r) => [r.handle, r]));
  const handles = args.roster.map((r) => r.handle) as [string, ...string[]];
  const lines = args.roster.map(
    (r) =>
      `@${r.handle} — ${sanitizeInline(r.name)}: ` +
      sanitizeInline(r.instructions).slice(0, ROSTER_BLURB_CHARS),
  );

  const shape = {
    handle: z.enum(handles),
    task: z.string().trim().min(1).max(2000),
  };

  return [
    {
      name: "delegate",
      title: "Delegate",
      description:
        "Hand ONE self-contained task to one of your teammates and get their " +
        "written report back. Say everything they need in `task` — they cannot " +
        "see this conversation. They act under THEIR OWN permissions, not " +
        `yours. You may delegate at most ${DELEGATE_FANOUT_MAX} times in one ` +
        "run, and a teammate cannot delegate onward, so do the simple lookups " +
        "yourself.\nYour teammates:\n" +
        lines.join("\n"),
      inputSchema: shape,
      capability: "agent.delegate",
      scope: "none",
      invoke: async (_ctx, raw): Promise<ToolResult> => {
        const parsed = z.object(shape).safeParse(raw);
        if (!parsed.success)
          return err(parsed.error.issues[0]?.message ?? "Invalid delegation.");
        const entry = byHandle.get(parsed.data.handle);
        if (!entry)
          return err(`You have no teammate called @${parsed.data.handle}.`);

        const claim = await claimAgentRun(args.svc, {
          agentId: entry.id,
          trigger: "delegation",
          parentRunId: args.parentRunId,
        });
        if (claim.outcome !== "claimed" || !claim.runId) {
          return err(
            CLAIM_REFUSAL_COPY[
              claim.outcome as Exclude<typeof claim.outcome, "claimed">
            ],
          );
        }

        const child = await getUserAgentById(args.svc, entry.id);
        if (!child) return err(`@${entry.handle} is no longer available.`);

        const progress = newRunProgress();
        try {
          const r = await executeAgentRun({
            svc: args.svc,
            // The parent's client, REUSED. Parent and child share an owner by
            // construction (agent_run_claim enforces it), and minting a second
            // bridge secret calls generateLink, which GoTrue rate-limits.
            ownerClient: args.ownerClient,
            agent: child,
            runId: claim.runId,
            ceiling: args.ceiling,
            task: parsed.data.task,
            // THE DEPTH CAP, second layer. The DB CHECK is the guarantee; this is
            // why the model is never even offered the tool one level down.
            allowDelegation: false,
            progress,
          });
          await finalizeChildRun(args.svc, claim.runId, "ran", r, progress);
          const body =
            r.text.length > DELEGATE_REPORT_MAX_CHARS
              ? `${r.text.slice(0, DELEGATE_REPORT_MAX_CHARS)}\n… (truncated)`
              : r.text;
          return ok(`Report from @${entry.handle}:\n${body}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : "unknown";
          await finalizeChildRun(
            args.svc,
            claim.runId,
            "error",
            null,
            progress,
            message,
          );
          // A dead child must never kill the parent — same posture as a denied
          // write: hand it back as a tool result and let the loop continue.
          return err(`@${entry.handle} could not finish: ${message}`);
        }
      },
    },
  ];
}
```

`finalizeChildRun(svc, runId, status, result, progress, error?)` is a small local helper that
updates `user_agent_runs` **by `id`** with the same field set `route.ts`'s `finalizeRun` writes
(`status`, `error`, `input_tokens`, `output_tokens`, `grants`, `steps`, `tools_used`, `output`,
`documents_omitted`, `memory_notes_dropped`, `model_substituted`).

- [ ] **Step 8: Wire `allowDelegation` into `executeAgentRun`**

In `execute-run.ts`, inside the `runAi` callback where `extra` is assembled:

```ts
            extra: [
              ...AGENT_ONLY_DESCRIPTORS,
              ...makeMemoryDescriptors({ userAgentId: args.agent.id, runId: args.runId }),
              ...(args.allowDelegation
                ? makeDelegateDescriptors({
                    svc: args.svc,
                    ownerClient: args.ownerClient,
                    parentRunId: args.runId,
                    ceiling: args.ceiling,
                    roster: await listDelegateRoster(args.ownerClient, args.agent),
                  })
                : []),
            ],
```

`listDelegateRoster(client, agent)` is a new bounded read in `execute-run.ts`:
`.from("user_agents").select("id, handle, name, instructions").eq("owner_id", agent.owner_id)
.eq("org_id", agent.org_id).eq("enabled", true).neq("id", agent.id).order("handle").limit(20)` —
the same `.limit(20)` the settings page uses, over `user_agents_owner_enabled_idx`.

- [ ] **Step 9: Run the tests**

Run: `pnpm vitest run src/lib/agents/run-claim.test.ts src/lib/agents/delegate-tool.test.ts src/lib/agents/execute-run.test.ts src/lib/agents/run-loop.test.ts`
Expected: PASS.

- [ ] **Step 10: Add the RLS integration coverage**

Create `src/lib/agents/agent_run_claim.rls.integration.test.ts` (skips cleanly without
`PULSE_TEST_DB`; model it on `src/lib/agents/user_agent_runs.rls.integration.test.ts`):

```ts
it("refuses a claim for another user's agent", …);           // expect refused_not_owner
it("refuses a fourth sibling under one parent", …);          // 3 claims ok, 4th refused_fanout
it("refuses a delegation whose parent is already depth 1", …); // refused_depth
it("refuses a second mention run inside the cooldown", …);   // refused_cooldown
it("refuses a mention run at the daily cap", …);             // refused_daily_cap
```

- [ ] **Step 11: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass; the integration suite reports skipped.

- [ ] **Step 12: Commit**

```bash
git add src/lib/agents/run-claim.ts src/lib/agents/run-claim.test.ts \
        src/lib/agents/delegate-tool.ts src/lib/agents/delegate-tool.test.ts \
        src/lib/agents/execute-run.ts src/lib/agents/execute-run.test.ts \
        src/lib/agents/run-loop.ts src/lib/agents/run-loop.test.ts \
        src/lib/agents/agent_run_claim.rls.integration.test.ts
git commit -m "feat(agents): delegate tool with depth, fan-out and ownership enforced in the claim RPC"
```

---

## Task 6: Agents settings UI — handle, built-in, manual cadence

**Files:**

- Modify: `src/lib/agents/agents-db.ts:14-64,189-205`, `src/lib/agents/actions.ts:31-166`, `src/app/(app)/settings/agents/page.tsx:114-227`, `src/components/agents/AgentEditor.tsx`, `src/components/agents/AgentRoster.tsx:16-118`, `src/components/agents/AgentsSection.tsx:135-194`
- Test: `src/components/agents/AgentEditor.test.tsx`, `src/components/agents/AgentRoster.test.tsx`, `src/lib/agents/actions.test.ts`, `src/lib/agents/agents-db.test.ts`

**Interfaces:**

- Consumes: `handle`/`kind` columns (Task 1); `handleSchema`, `slugifyHandle`, `personalAgentSettingsSchema` with `handle`, `'manual'` cadence (Task 2).
- Produces: `UserAgentRow` gains `handle: string; kind: "user" | "builtin"`; `AgentRecord`/`RosterAgent` gain `handle` and `kind`; `deleteAgent` refuses `kind='builtin'`; `countAgentsForOwner` excludes built-ins.

- [ ] **Step 1: Write the failing db-layer tests**

In `src/lib/agents/agents-db.test.ts`:

```ts
it("selects handle and kind", async () => {
  const client = fakeClient();
  await getUserAgentById(client, "a1");
  expect(client.lastSelect).toContain("handle");
  expect(client.lastSelect).toContain("kind");
});

it("does not count the built-in agent against the per-user cap", async () => {
  const client = fakeClient();
  await countAgentsForOwner(client, "org", "u1");
  expect(client.lastFilters).toContainEqual(["neq", "kind", "builtin"]);
});

it("counts only root runs toward the daily cap", async () => {
  const client = fakeClient();
  await countRunsToday(client, "org", "u1", "2026-09-04");
  expect(client.lastFilters).toContainEqual(["is", "parent_run_id", null]);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/agents/agents-db.test.ts`
Expected: FAIL on all three.

- [ ] **Step 3: Update `agents-db.ts`**

Add to `UserAgentRow`:

```ts
/** The typeable name. Unique per owner, case-insensitively, and the only
 *  identifier a mention can carry — `user_agents.name` may contain spaces
 *  and `activeMentionQuery` terminates a token at the first one. */
handle: string;
/** 'builtin' is the seeded orchestrator: renameable, undeletable, and NOT
 *  counted against `max_agents_per_user`. Written only by
 *  `seed_builtin_agent`; it is absent from `authenticated`'s column grants. */
kind: "user" | "builtin";
```

Append `, handle, kind` to `AGENT_COLS`. Add `.neq("kind", "builtin")` to `countAgentsForOwner` with
the comment _"the built-in orchestrator is given, not chosen — charging it against the owner's three
slots would take one away on the day this shipped."_ Add `.is("parent_run_id", null)` to
`countRunsToday` with _"the cap counts TRIGGERS, not runs. A delegated child is bounded by the
fan-out cap instead; counting it too would let one orchestration exhaust the day."_

- [ ] **Step 4: Update the actions**

`createAgent`: add `handle: parsed.data.handle,` to the insert object. `updateAgent`: add
`handle: parsed.data.handle,` to the update object. `deleteAgent`: before the delete,

```ts
const { data: row } = await supabase
  .from("user_agents")
  .select("kind")
  .eq("id", id)
  .eq("owner_id", user.id)
  .maybeSingle();
if (row?.kind === "builtin") {
  // Rename it, switch it off, strip its grants — but it cannot be removed:
  // the seed trigger would recreate it on the next org join, and a user with
  // no orchestrator has no way to get one back.
  return fail(
    "Your built-in assistant can't be deleted. Switch it off instead.",
  );
}
```

Add the matching test in `actions.test.ts`.

- [ ] **Step 5: Widen the page's roster read**

`src/app/(app)/settings/agents/page.tsx:116-118` — append `, handle, kind` to the select string.
Map both into `AgentRecord` at `:206-227`.

- [ ] **Step 6: Write the failing editor test**

In `AgentEditor.test.tsx`:

```tsx
it("prefills the handle from the name in create mode", async () => {
  render(<AgentEditor {...createProps} />);
  await userEvent.type(screen.getByLabelText(/^name$/i), "Overdue Chaser");
  expect(screen.getByLabelText(/handle/i)).toHaveValue("overdue-chaser");
});

it("stops prefilling once the handle is edited by hand", async () => {
  render(<AgentEditor {...createProps} />);
  await userEvent.type(screen.getByLabelText(/handle/i), "ops");
  await userEvent.type(screen.getByLabelText(/^name$/i), "Overdue Chaser");
  expect(screen.getByLabelText(/handle/i)).toHaveValue("ops");
});

it("shows a field error for a reserved handle", async () => {
  render(<AgentEditor {...editProps} />);
  await userEvent.clear(screen.getByLabelText(/handle/i));
  await userEvent.type(screen.getByLabelText(/handle/i), "everyone");
  await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
  expect(await screen.findByText(/reserved/i)).toBeInTheDocument();
});

it("hides Delete for the built-in agent", () => {
  render(
    <AgentEditor
      {...editProps}
      initial={{ ...editProps.initial, kind: "builtin" }}
    />,
  );
  expect(
    screen.queryByRole("button", { name: /delete/i }),
  ).not.toBeInTheDocument();
});

it("offers the manual cadence", () => {
  render(<AgentEditor {...createProps} />);
  expect(
    screen.getByRole("option", { name: /only when i ask/i }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 7: Implement the editor changes**

- `const [handle, setHandle] = useState(initial.handle)` and
  `const handleTouched = useRef(mode === "edit")`; in the name `onChange`, when
  `!handleTouched.current` also `setHandle(slugifyHandle(next, agentId ?? "00000000"))`.
- New field block after Name (before Instructions), following the Name block's exact markup:
  `<Label htmlFor="agent-handle">Handle</Label>`, an `<Input id="agent-handle">` with a leading `@`
  adornment, `aria-describedby={HANDLE_ERROR_ID}`, `<FieldStatus>` via `useFieldStatus`, and helper
  copy: _"How you summon this agent: type `@handle` in an item update or in Ask."_
- `FieldErrors` gains `"handle"`; the `candidate` object gains `handle`; the `flat.handle?.[0]`
  mapping is added beside `flat.name?.[0]`.
- `kind` rides on `AgentRecord`; when `kind === "builtin"` hide the Delete button and its
  `AlertDialog`, and render a muted line under the name: _"Your built-in assistant. Rename it, give
  it a different handle, or switch it off — it can't be deleted."_
- Uniqueness is enforced by `user_agents_owner_handle_uniq`; catch Postgres `23505` in
  `createAgent`/`updateAgent` and return `fail("You already have an agent with that handle.")` so
  the collision reads as a field error rather than a 500.

- [ ] **Step 8: Fix `AgentRoster`'s hardcoded cadence label**

`AgentRoster.tsx:86-88` renders `"Daily at {hourLabel(runAtLocalHour)}"` regardless of cadence.
Replace with a `scheduleLabel(agent)` helper: `manual` → `"Only when you ask"`; `daily` →
`"Daily at {hour}"`; `weekdays` → `"Weekdays at {hour}"`; `weekly` →
`"{Weekday}s at {hour}"`; `monthly` → `"Day {n} at {hour}"`. Show `@{handle}` as a `<Kicker>`
beside the template id. Add a test asserting a `manual` agent does not render "Daily".

- [ ] **Step 9: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/agents/agents-db.ts src/lib/agents/agents-db.test.ts \
        src/lib/agents/actions.ts src/lib/agents/actions.test.ts \
        "src/app/(app)/settings/agents/page.tsx" src/components/agents
git commit -m "feat(agents): handle field, built-in assistant affordances, manual cadence"
```

---

## Task 7: Nested-run tree in the run history

**Files:**

- Modify: `src/lib/agents/agents-db.ts` (add `listChildRuns`), `src/lib/agents/run-status.ts:54-92`, `src/lib/agents/actions.ts` (add `getChildRuns`), `src/components/agents/AgentRunHistory.tsx:37-216`
- Test: `src/lib/agents/agents-db.test.ts`, `src/components/agents/AgentRunHistory.test.tsx`

**Interfaces:**

- Consumes: `user_agent_runs.parent_run_id/depth/trigger` + `user_agent_runs_parent_idx` (Task 1); `AGENT_COLS` widening (Task 6).
- Produces:

```ts
// run-status.ts
export type AgentRunSummary = /* … existing … */ {
  parentRunId: string | null;
  depth: number;
  trigger: "schedule" | "delegation" | "mention";
  agentName?: string;
};
export function subtreeTokens(
  root: AgentRunSummary,
  children: AgentRunSummary[],
): number;
// agents-db.ts
export async function listChildRuns(
  client: SupabaseClient<Database>,
  parentRunIds: string[],
): Promise<AgentRunSummary[]>;
// actions.ts
export async function getChildRuns(
  parentRunIds: string[],
): Promise<ActionResult<AgentRunSummary[]>>;
```

- [ ] **Step 1: Write the failing tests**

In `agents-db.test.ts`:

```ts
it("reads all children in ONE batched query over the parent index", async () => {
  const client = fakeClient();
  await listChildRuns(client, ["r1", "r2"]);
  expect(client.calls).toHaveLength(1);
  expect(client.lastFilters).toContainEqual([
    "in",
    "parent_run_id",
    ["r1", "r2"],
  ]);
});

it("returns [] without querying for an empty parent list", async () => {
  const client = fakeClient();
  expect(await listChildRuns(client, [])).toEqual([]);
  expect(client.calls).toHaveLength(0);
});
```

In a new `run-status.test.ts` case:

```ts
it("sums a run's own tokens plus its children's", () => {
  expect(subtreeTokens(run(10, 5), [run(1, 2), run(3, 4)])).toBe(25);
});
it("treats null token columns as zero", () => {
  expect(subtreeTokens(run(null, null), [run(1, null)])).toBe(1);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/agents/agents-db.test.ts src/lib/agents/run-status.test.ts`
Expected: FAIL — `listChildRuns` / `subtreeTokens` not exported.

- [ ] **Step 3: Implement the reads**

`listChildRuns` mirrors `listAgentRuns`' column list plus `parent_run_id, depth, trigger` and the
child agent's name via `user_agents!inner(name)`, with `.in("parent_run_id", parentRunIds)`,
`.order("created_at")`, `.limit(parentRunIds.length * DELEGATE_FANOUT_MAX)`. Guard the empty list
before touching the client — an `in ()` with no values is a full scan waiting to happen.

`getChildRuns` in `actions.ts` follows `getPendingProposals`' shape exactly: `requireUser()`,
`z.array(z.string().uuid()).max(RUN_HISTORY_LIMIT)`, RLS as the boundary, `console.error` on throw.

Widen `AgentRunSummary` and `listAgentRuns`' select list with the three new columns.

- [ ] **Step 4: Render the tree**

In `AgentRunHistory.tsx`, add a third `useQuery` keyed `["userAgentChildRuns", agentId, runIds]`,
`enabled: open && runIds.length > 0`, `staleTime: 30_000` — **one** batched call, exactly like the
proposals query it sits beside. Group into `childrenByRun: Map<string, AgentRunSummary[]>`.

Under each run's header line, when it has children, render an indented list
(`className="ml-4 border-l pl-3 flex flex-col gap-1"`) of child rows: the child's agent name, its
`StatusPill`, and `describeAgentRun(child)`. On the parent's header line add
`{subtreeTokens(run, children)} tokens across {children.length + 1} runs` when `children.length > 0`.
For a run whose own `trigger` is `"delegation"`, render a muted kicker `Delegated`; for `"mention"`,
`Summoned`. Add the matching component tests.

- [ ] **Step 5: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/agents-db.ts src/lib/agents/agents-db.test.ts \
        src/lib/agents/run-status.ts src/lib/agents/run-status.test.ts \
        src/lib/agents/actions.ts src/components/agents/AgentRunHistory.tsx \
        src/components/agents/AgentRunHistory.test.tsx
git commit -m "feat(agents): nested run tree with subtree token totals in run history"
```

---

## Task 8: `@handle` selects the persona in `/ask`

**Files:**

- Modify: `src/components/ai/ask/Composer.tsx`, `src/components/ai/ask/AskChat.tsx:149-190`, `src/app/(app)/ask/page.tsx` (pass the owner's agents down)
- Test: `src/components/ai/ask/Composer.test.tsx`, `src/components/ai/ask/AskChat.test.tsx`

**Interfaces:**

- Consumes: `user_agents.handle` (Task 1); `MentionTarget`, `mentionLabel`, `applyMention`, `activeMentionQuery` (Task 4).
- Produces: `Composer` gains `agents: readonly MentionTarget[]` and `onSubmit(text: string, agentId: string | null)`.

- [ ] **Step 1: Write the failing test**

```tsx
it("completes an agent handle in the composer", async () => {
  const onSubmit = vi.fn();
  render(
    <Composer
      disabled={false}
      agents={[{ kind: "agent", agentId: "a1", handle: "ops", name: "Ops" }]}
      onSubmit={onSubmit}
    />,
  );
  await userEvent.type(screen.getByRole("textbox"), "@op");
  await userEvent.click(await screen.findByRole("button", { name: /ops/i }));
  await userEvent.type(
    screen.getByRole("textbox"),
    "what is late?{Meta>}{Enter}{/Meta}",
  );
  expect(onSubmit).toHaveBeenCalledWith("@ops what is late?", "a1");
});

it("passes a null agent id when no handle leads the message", async () => {
  /* … */
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/components/ai/ask/Composer.test.tsx`
Expected: FAIL — `agents` is not a prop.

- [ ] **Step 3: Implement**

Reuse `activeMentionQuery`/`applyMention` in `Composer` exactly as `MentionTextarea` does (a
suggestion `<ul>` above the textarea, mouse-select, no keyboard nav — matching the existing
component's behaviour rather than inventing a second interaction model). On send, resolve a
**leading** `@handle` to its agent id and pass it as the second argument.

In `AskChat.onSubmit(text, agentId)`: when there is no conversation yet, pass `agentId` to
`createConversation({ firstMessage, boardId, agentId })` — the column, the `ownedAgentId()` guard
and `composePersona` all already ship. For an existing conversation, ignore the handle and surface a
one-line hint under the composer: _"Start a new chat to ask a different agent."_ — `ai_messages` has
no UPDATE policy and re-personifying a live transcript is a different feature.

`/ask`'s page passes the owner's agents; it is a bounded read the page can add to whatever it
already awaits (`.select("id, handle, name").eq("owner_id", user.id).eq("enabled", true).limit(20)`).

- [ ] **Step 4: Run the tests, then the gates**

Run: `pnpm vitest run src/components/ai/ask` then `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/ask "src/app/(app)/ask/page.tsx"
git commit -m "feat(ask): @handle selects the agent persona for a new conversation"
```

---

## Task 9: Renameable per-org assistant name

**Files:**

- Create: `src/lib/org/assistant-name.ts`, `src/lib/org/assistant-name.test.ts`
- Modify: `src/lib/ai/org-settings.ts` (surface `assistantName`), `src/app/(app)/settings/ai/page.tsx`, the org-AI settings admin form + its server action
- Test: the existing org-AI settings action test

**Interfaces:**

- Consumes: `org_ai_settings.assistant_name` (Task 1).
- Produces: `OrgAiSettings.assistantName: string`; `assistantNameSchema: z.ZodString`; `DEFAULT_ASSISTANT_NAME = "Monolith Autopilot"`.

- [ ] **Step 1: Write the failing test**

```ts
it("defaults to Monolith Autopilot when the column is unset", () => {
  expect(readOrgAiSettings(rowWithout("assistant_name")).assistantName).toBe(
    DEFAULT_ASSISTANT_NAME,
  );
});
it("rejects an empty or over-long name", () => {
  expect(assistantNameSchema.safeParse("   ").success).toBe(false);
  expect(assistantNameSchema.safeParse("x".repeat(41)).success).toBe(false);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/lib/org/assistant-name.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { z } from "zod";

/**
 * The platform bot's display name, per ORG.
 *
 * It used to be one `profiles.full_name` for the whole deployment
 * (20260727122214 renamed it once, by hand). The underlying `auth.users` row
 * stays global and its email stays `pulse-autopilot@pulse.internal` on purpose:
 * `platform_agent_user_id()` resolves the bot BY THAT EMAIL, so renaming the
 * identity would break the resolver. Only the display name is per-org.
 */
export const DEFAULT_ASSISTANT_NAME = "Monolith Autopilot";
export const assistantNameSchema = z.string().trim().min(1).max(40);
```

Add `assistantName` to `OrgAiSettings` and to `DEFAULT_ORG_AI_SETTINGS`, read it in
`readOrgAiSettings`, and add a text input to the org-AI settings admin card
(`/settings/ai`) beside the mode controls, saved by the existing settings Server Action with a
`revalidatePath`. Replace the hardcoded bot name at every render site (grep
`"Monolith Autopilot"` across `src/`) with the resolved value.

- [ ] **Step 4: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/org/assistant-name.ts src/lib/org/assistant-name.test.ts \
        src/lib/ai/org-settings.ts "src/app/(app)/settings/ai"
git commit -m "feat(ai): per-org assistant name replaces the per-deployment bot label"
```

---

## Task 10: Route wiring — `{run_id}` runs, finalize by id, delegation on

**Files:**

- Modify: `src/app/api/ai/personal-agent/route.ts`
- Test: `src/app/api/ai/personal-agent/route.test.ts`

**Interfaces:**

- Consumes: `executeAgentRun` (Task 3); `makeDelegateDescriptors` wiring (Task 5); `trigger`/`parent_run_id` columns (Task 1).
- Produces: the route accepts `{ run_id }` **or** `{ agent_id, fire_date, fire_hour }`; `finalizeRun` keys on `id`; `export const maxDuration`.

- [ ] **Step 1: Write the failing tests**

```ts
it("runs an already-claimed run without touching the fire slot", async () => {
  const res = await POST(signed({ run_id: RUN }));
  expect(await res.json()).toEqual({ status: "ran" });
  expect(claimSpy).not.toHaveBeenCalled();
});

it("rejects an unsigned {run_id} body", async () => {
  expect((await POST(unsigned({ run_id: RUN }))).status).toBe(401);
});

it("404s a run_id that does not exist", async () => {
  expect((await POST(signed({ run_id: MISSING }))).status).toBe(404);
});

it("finalizes by run id, never by the fire slot", async () => {
  await POST(
    signed({ agent_id: AGENT, fire_date: "2026-09-04", fire_hour: 7 }),
  );
  expect(updateFilters).toContainEqual(["eq", "id", expect.any(String)]);
  expect(updateFilters).not.toContainEqual(["eq", "fire_hour", 7]);
});

it("enables delegation for a root run and never for a child", async () => {
  await POST(
    signed({ agent_id: AGENT, fire_date: "2026-09-04", fire_hour: 7 }),
  );
  expect(vi.mocked(executeAgentRun).mock.calls[0]![0].allowDelegation).toBe(
    true,
  );
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm vitest run src/app/api/ai/personal-agent/route.test.ts`
Expected: FAIL — the body schema rejects `{ run_id }`.

- [ ] **Step 3: Implement**

```ts
/**
 * Up to 1 + DELEGATE_FANOUT_MAX bounded tool loops run inside ONE invocation of
 * this function, serially, each capped at AGENT_MAX_STEPS. The route declared
 * no duration at all before delegation existed and relied on the platform
 * default; with a delegating run that is no longer a safe assumption.
 */
export const maxDuration = 300;

const bodySchema = z.union([
  // `item_id` is present exactly for a mention run: it is the item the agent
  // was summoned from and the item its reply is posted to. It rides the signed
  // body rather than a `user_agent_runs` column, because no other trigger has
  // such a value and a column that is null for every scheduled and delegated
  // run invites a null-check at every read.
  z.object({
    run_id: z.string().uuid(),
    item_id: z.string().uuid().optional(),
  }),
  z.object({
    agent_id: z.string().uuid(),
    fire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fire_hour: z.number().int().min(0).max(23),
  }),
]);
```

For the `{ run_id }` branch: load the run row, 404 if missing, load its agent, skip `claimRun` and
skip the `findUserAgentRun` probe entirely (the claim already happened in `agent_run_claim`), and
set `fireDate` from the run row.

Change `finalizeRun` to take a `runId: string` and filter `.eq("id", runId)`, with the comment:

```ts
/**
 * Keyed on the run's OWN id. It used to filter on
 * (user_agent_id, fire_date, fire_hour) — which was unique only while every run
 * was scheduled. A mention and a delegated run both carry fire_hour = null, so
 * that filter would now update EVERY non-scheduled run of the agent on that day
 * with one run's outcome.
 */
```

Set `allowDelegation: run.depth === 0` on the `executeAgentRun` call — true for scheduled and
mention runs, and structurally false for anything a delegate handler ever starts.

Branch the delivery: when `run.trigger === "mention"`, **skip `sendBriefingEmail` and skip
`writeBriefingThread`** — a summoned answer is a conversational reply, not a daily briefing — and
instead call `postAgentReply` with the parsed `item_id`. `postAgentReply` lands in Task 11; until
then, declare the branch and log:

```ts
if (run.trigger === "mention") {
  // Task 11 replaces this with postAgentReply(svc, { runId, itemId, ... }).
  console.info("[personal-agent] mention run finished", {
    runId: run.id,
    itemId,
  });
} else {
  const threadId = await writeBriefingThread(/* …unchanged… */);
  await sendBriefingEmail(/* …unchanged… */);
}
```

and add a route test asserting a mention run sends no email.

- [ ] **Step 4: Run the tests, then the gates**

Run: `pnpm vitest run src/app/api/ai/personal-agent/route.test.ts` then
`pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ai/personal-agent/route.ts src/app/api/ai/personal-agent/route.test.ts
git commit -m "fix(agents): finalize a run by id, accept pre-claimed runs, enable delegation"
```

---

## Task 11: The mention trigger and the agent's reply

**Files:**

- Create: `src/lib/rate-limit/agent-mention-rate-limit.ts` + test, `src/lib/agents/mention-dispatch.ts` + test, `src/lib/agents/agent-reply.ts` + test
- Modify: `src/lib/collaboration/actions.ts:23-86`, `src/app/api/ai/personal-agent/route.ts` (call `postAgentReply`), `src/components/notifications/NotificationsList.tsx:8-11`, `src/lib/settings/notification-prefs.ts:13-32`
- Test: `src/lib/collaboration/actions.test.ts`

**Interfaces:**

- Consumes: `agent_run_claim` + `claimAgentRun` (Tasks 1, 5); tagged mention targets (Task 4); the `{run_id}` route branch (Task 10); `notification_kind.agent_reply` (Task 1).
- Produces:

```ts
export async function checkAgentMentionRateLimit(
  userId: string,
): Promise<RateLimitDecision>;
export async function dispatchAgentRun(
  runId: string,
  itemId: string,
): Promise<void>;
export async function postAgentReply(
  svc: SupabaseClient<Database>,
  args: {
    runId: string;
    itemId: string;
    agentName: string;
    agentHandle: string;
    text: string;
  },
): Promise<void>;
// addUpdate's result widens to { updateId: string; agentRun: "started" | null; reason?: string }
```

- [ ] **Step 1: The rate limiter**

Copy `src/lib/rate-limit/mcp-rate-limit.ts` wholesale and change three things: the key prefix
(`agent-mention:user:${userId}`), the limit (`AGENT_MENTION_LIMIT = 10`) and the window
(`AGENT_MENTION_WINDOW_SECONDS = 3600`). Keep the fail-**open** posture and say why in the doc
comment: _"The fail-CLOSED layer is `agent_run_claim` — the 5-minute cooldown and the org's daily
cap both live inside the RPC. This limiter exists to stop a scripted flood from reaching the RPC at
all, and a rate-limit table outage must not stop people from commenting."_
Test it exactly as `mcp-rate-limit.test.ts` tests its sibling.

- [ ] **Step 2: The dispatcher**

```ts
import "server-only";
import { after } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { signBody } from "@/lib/ai/agentic/hmac";

/**
 * Fire the already-claimed run, without making the commenter wait for it.
 *
 * The CLAIM is the durable part and it has already happened, so a dispatch that
 * never lands leaves a row that `agentRunDisplayStatus` renders "In progress"
 * and then, after STALE_CLAIM_MS, "Didn't finish" — a state the run history was
 * built to display. That is why this may be best-effort: the alternative, doing
 * the run inside the Server Action, would block the user's comment for a minute.
 */
export async function dispatchAgentRun(
  runId: string,
  itemId: string,
): Promise<void> {
  const secret = getServerEnv().AI_PGNET_HMAC_SECRET;
  const base = getServerEnv().APP_BASE_URL;
  if (!secret || !base) return;
  // `item_id` rides the SIGNED body, so the route learns which item summoned
  // the run without a column on `user_agent_runs` for a value only this one
  // trigger has. It is covered by the HMAC like every other field.
  const body = JSON.stringify({ run_id: runId, item_id: itemId });
  after(async () => {
    try {
      await fetch(`${base}/api/ai/personal-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pulse-Signature": signBody(body, secret),
        },
        body,
      });
    } catch (e) {
      console.error("[agents] mention dispatch failed:", {
        runId,
        cause: String(e),
      });
    }
  });
}
```

If `hmac.ts` exports only `verifyBody`, add the symmetric `signBody(raw, secret)` beside it and
make `verifyBody` compare against it, so the two can never disagree.

- [ ] **Step 3: The reply**

`user_agent_runs` carries no item reference, and it should not grow one: only this single trigger
has such a value, and a column that is null for every scheduled and delegated run is a column that
invites a null-check at every read. The item id therefore travels in the **HMAC-signed dispatch
body** (`item_id`, added to the route's `{ run_id }` schema in Task 10) and the route hands it to
`postAgentReply`.

`postAgentReply(svc, { runId, itemId, agentName, agentHandle, text })` then, with the **service**
client:

1. `insert into item_updates` with `author_id = platform_agent_user_id()`,
   `body_text = "${agentName} (@${agentHandle}): ${text}"`, `body = { text, mentions: [] }`,
   `org_id`/`board_id` denormalised from the item — the same shape autopilot's `notify` already uses
   (`20260720120517:258-266`);
2. `insert into notifications` with `kind: "agent_reply"`, `recipient_id` = the run's `owner_id`,
   `actor_id: null`, `item_id`, `update_id`, `payload: { agentName, agentHandle }`;
3. both best-effort with `console.error` — the run already succeeded and a bookkeeping failure must
   not turn it into an error.

Add `agent_reply` to `CONTROLLABLE_IN_APP_KINDS` and `IN_APP_KIND_LABELS`
(`{ label: "Agent replies", description: "When an agent you summoned answers on an item" }`) and a
`case "agent_reply": return "replied to your mention";` in `NotificationsList.tsx`.

- [ ] **Step 4: Wire the trigger into `addUpdate`**

After the human fan-out in `src/lib/collaboration/actions.ts`:

```ts
// ONE agent per update, deliberately. Several handles in one comment would
// turn a single keystroke into several billable runs; the orchestrator is the
// supported — and bounded — way to fan out.
const agentTarget = parsed.data.mentions.find((m) => m.kind === "agent");
let agentRun: "started" | null = null;
let reason: string | undefined;
if (agentTarget) {
  const limit = await checkAgentMentionRateLimit(user.id);
  if (!limit.allowed) {
    reason = "You have summoned agents too many times this hour.";
  } else {
    const claim = await claimAgentRun(createServiceClient(), {
      agentId: agentTarget.agentId,
      trigger: "mention",
    });
    if (claim.outcome === "claimed" && claim.runId) {
      await dispatchAgentRun(claim.runId, parsed.data.itemId);
      agentRun = "started";
    } else {
      reason =
        CLAIM_REFUSAL_COPY[claim.outcome as Exclude<ClaimOutcome, "claimed">];
    }
  }
}
return { ok: true, data: { updateId: data.id, agentRun, reason } };
```

`claimAgentRun` runs against the **service** client here, and `agent_run_claim`'s
`auth.uid()` check is therefore skipped — so the action must assert ownership itself before
claiming: `select id from user_agents where id = <target> and owner_id = <user.id>`. Do that
check **before** the claim and return `reason = "That agent isn't yours."` if it misses.

`UpdatesTab` toasts `reason` when present and shows _"@handle is working on it…"_ when
`agentRun === "started"`.

- [ ] **Step 5: Tests**

```ts
it("starts one run for the first agent target only", async () => {
  /* two agent mentions, one claim */
});
it("never blocks the update when the claim is refused", async () => {
  claim.mockResolvedValue({ outcome: "refused_cooldown", runId: null });
  const r = await addUpdate({
    itemId,
    text: "@ops look",
    mentions: [{ kind: "agent", agentId: A }],
  });
  expect(r.ok).toBe(true);
  expect(r.data.agentRun).toBeNull();
});
it("refuses to summon an agent the author does not own", async () => {
  /* … */
});
it("does not dispatch when the rate limiter denies", async () => {
  /* … */
});
```

- [ ] **Step 6: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rate-limit/agent-mention-rate-limit.ts src/lib/agents/mention-dispatch.ts \
        src/lib/agents/agent-reply.ts src/lib/collaboration/actions.ts \
        src/lib/settings/notification-prefs.ts src/components/notifications/NotificationsList.tsx \
        src/app/api/ai/personal-agent/route.ts src/lib/agents/*.test.ts \
        src/lib/rate-limit/agent-mention-rate-limit.test.ts src/lib/collaboration/actions.test.ts
git commit -m "feat(agents): an @handle in an item update summons the agent and posts its reply"
```

---

## Execution DAG (working agreement #6)

| Task                  | Consumes | Produces                                                                                                                                             |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Schema + metering   | —        | run-graph columns, `agent_run_claim`, `handle`/`kind`, `agent.delegate`, `ai_usage.run_id`, `assistant_name`, `agent_reply` enum, `runAi({ runId })` |
| 2 Vocabulary          | —        | `agent.delegate` + copy, `handleSchema`/`slugifyHandle`, `'manual'`, `handle` on the settings schema                                                 |
| 3 Executor extraction | —        | `executeAgentRun`, `RunProgress`, `newRunProgress`                                                                                                   |
| 4 Mention model       | —        | `MentionTarget` union, `mentionLabel`, `mentionTargetSchema`, tagged `addUpdate`                                                                     |
| 5 Delegate tool       | 1, 2, 3  | `claimAgentRun`, `CLAIM_REFUSAL_COPY`, `makeDelegateDescriptors`, `runAgentLoop({ task })`                                                           |
| 6 Agents UI           | 1, 2     | `UserAgentRow.handle/kind`, built-in guards, cap filters, handle field                                                                               |
| 7 Run tree            | 1, 6     | `listChildRuns`, `getChildRuns`, `subtreeTokens`, nested history                                                                                     |
| 8 Ask persona         | 1, 4     | `Composer({ agents, onSubmit(text, agentId) })`                                                                                                      |
| 9 Assistant name      | 1        | `OrgAiSettings.assistantName`                                                                                                                        |
| 10 Route wiring       | 1, 3, 5  | `{run_id}` runs, finalize by id, `maxDuration`, delegation on                                                                                        |
| 11 Mention trigger    | 1, 4, 10 | `checkAgentMentionRateLimit`, `dispatchAgentRun`, `postAgentReply`                                                                                   |

**Dependency graph:** 5←{1,2,3} · 6←{1,2} · 7←{1,6} · 8←{1,4} · 9←{1} · 10←{1,3,5} · 11←{1,4,10}

**Parallel batches**

- **Batch 1 (4 concurrent):** 1, 2, 3, 4 — disjoint files. Task 1 owns `supabase/migrations/`, `database.types.ts` and `gateway.ts`; Task 2 owns `capabilities.ts`/`capability-copy.ts`/`agent-config.ts`/`handle.ts`; Task 3 owns `execute-run.ts` + `route.ts`; Task 4 owns `src/lib/collaboration/` + the item panel.
- **Batch 2 (4 concurrent):** 5, 6, 8, 9. Task 5 must not edit `agents-db.ts` or `actions.ts` — those belong to Task 6 in this batch.
- **Batch 3 (2 concurrent):** 7, 10. Task 7 owns the `agents-db.ts`/`actions.ts` read additions; Task 10 owns `route.ts`.
- **Batch 4:** 11.

**Critical path:** **1 → 5 → 10 → 11** — four hops, the real wall-clock floor. Tasks 2, 3 and 4 are free (batch 1); 6, 8, 9 hide entirely under 5; 7 hides under 10.

**Worktree discipline:** each task in a batch of ≥2 runs in its own worktree via
`scripts/start-task.sh`, and the batch's branches are merged **one at a time** with
`scripts/finish-task.sh` (it rebases onto the latest `develop` and gates the merged state). The one
file every batch-1 task could contend on is `src/types/database.types.ts`; it is owned exclusively
by Task 1, which is why all four migrations are one task rather than four.

---

## Performance & data-fetching budget (working agreement #5)

**First paint.**

- `/settings/agents` gains **zero** server round-trips. The roster select
  (`page.tsx:116-118`) widens by `handle, kind` — same query, same
  `user_agents_owner_enabled_idx`, same `.limit(20)`. The eight-read `Promise.all` is otherwise
  untouched, and each read keeps its `.catch()` degradation.
- A board page gains **zero** round-trips. Mention candidates are the already-cached
  `listOrgMembersCached` (`"use cache"`, `cacheLife("nav")`, cap 500) plus the owner-agents read the
  page already performs at `boards/[boardId]/page.tsx:37-41`, widened by `handle`.
- `/ask` gains one bounded read (`id, handle, name`, `enabled = true`, `limit(20)`) folded into what
  the page already awaits.

**Interactions.**

- Every in-page toggle is **0 new server round-trips**: roster ↔ gallery ↔ editor ↔ library stays
  `useState`; the handle field, delegation copy, cadence select and capability switches are client
  state until Save; expanding a run stays TanStack `enabled: open`.
- Mention autocomplete filters **props in memory** — `Array.prototype.filter` on every keystroke,
  never a request. This is deliberate and is why handles must be resolvable from data the page
  already has.
- **No `<Link>` or `router.push` is introduced anywhere.** `/ask`'s existing
  `window.history.pushState(null, "", '/ask/<id>')` (`AskChat.tsx:184`) is untouched and the persona
  handle rides that same non-navigating path — a router navigation there would re-run every query in
  the page (gotcha-09).
- Interactions that change server data are Server Actions with targeted revalidation:
  `createAgent`/`updateAgent`/`deleteAgent` → `revalidatePath("/settings/agents")`; `addUpdate` →
  TanStack invalidation of `itemUpdatesKey`/`itemActivityKey`; the assistant rename →
  `revalidatePath("/settings/ai")`.

**Bounded reads over indexed columns.**

- Child runs: **one** batched `.in("parent_run_id", runIds)` on expand, over
  `user_agent_runs_parent_idx`, capped at `runIds.length * DELEGATE_FANOUT_MAX`, with an early
  return for an empty list. Never one query per row — this copies `getPendingProposals(runIds)`.
- Handle resolution: `user_agents_owner_handle_uniq (owner_id, lower(handle))`.
- Mention cooldown: `user_agent_runs_mention_idx`, a partial index containing only mention runs,
  probed with `count(*)` over a 5-minute window.
- Fan-out count: equality on `parent_run_id` under the row lock the claim RPC already holds.
- Delegate roster: `.eq("owner_id").eq("org_id").eq("enabled", true).limit(20)`.
- `ai_usage.run_id` is indexed **partially** (`where run_id is not null`), so
  `ai_usage_org_created_idx`'s existing plans are unchanged.
- No `select *` is introduced; `AGENT_COLS` and the roster select both grow by explicit name.

**The one real cost, stated rather than hidden.** A delegating run performs up to
1 + `DELEGATE_FANOUT_MAX` = 4 model loops, serially, inside one function invocation — bounded at
48 provider round-trips by `AGENT_MAX_STEPS = 12`. Task 10 therefore adds
`export const maxDuration = 300` to `/api/ai/personal-agent`, which declares none today. Verify it
against a real delegating run on the deployment before calling the slice done.

---

## How to test this (manual acceptance, after the merge)

1. Pull `develop` and run `pnpm dev`. Sign in as a normal user.
2. Go to **Settings → Agents**. You should see a new **Assistant** card at `@assistant`, labelled
   _"Only when you ask"_, with a note saying it can't be deleted.
3. Open it. Confirm: the **Handle** field shows `assistant`; **Runs** shows _Only when I ask_; the
   capability list now includes **"Ask your other agents for help"**; there is **no Delete button**.
4. Create a second agent from a template — e.g. _Overdue Chaser_. Confirm the **Handle** field
   prefills to `overdue-chaser` as you type the name, and stops prefilling once you edit it by hand.
   Try the handle `everyone` and confirm you get _"That handle is reserved."_ Save with a real one.
5. Try to give the second agent the **same** handle as the first. Expect
   _"You already have an agent with that handle."_, not an error page.
6. Open any board item → **Updates**. Type `@ove` — the agent should appear in the suggestion list
   alongside people. Pick it, finish the comment, post it.
7. Expect the comment to post **immediately** and a note that the agent is working. Within a minute
   or two a reply appears as a new update authored by the assistant, and a bell notification says
   _"replied to your mention"_.
8. Post a second `@overdue-chaser` comment straight away. Expect the update to post and a toast
   saying it ran less than five minutes ago — **the comment must never be blocked**.
9. Back in **Settings → Agents**, expand the second agent's run history. The summoned run should be
   there, marked **Summoned**.
10. Now grant **"Ask your other agents for help"** to `@assistant` (an org admin may first need to
    enable it under **Settings → AI**), then `@assistant` an item asking something the other agent
    is better placed to answer. Expand `@assistant`'s run history: the run should show one or more
    **indented child runs** underneath it, each naming the teammate, plus a token total across the
    subtree.
11. In `/ask`, start a **new** chat beginning `@overdue-chaser what is late?`. The answer should come
    back in that agent's voice. In an existing chat, typing a handle should show
    _"Start a new chat to ask a different agent."_
12. As an org **admin**, go to **Settings → AI**, rename the assistant, and confirm the new name
    shows wherever the built-in bot is credited.
13. Leave everything overnight (or set a scheduled agent to the next hour) and confirm the 07:00
    briefing email still arrives exactly as before — nothing about the scheduled path changed.
