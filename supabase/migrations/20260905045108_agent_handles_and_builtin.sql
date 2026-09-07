-- 20260905045108_agent_handles_and_builtin.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Spec 3 · Task 1 · migration 3 of 4):
--   1) user_agents.handle — the typeable address. `@handle` in an item update
--      or in /ask is how a human summons one specific agent, so it has a strict
--      grammar (lowercase, 2..32, starts alphanumeric), is unique per OWNER
--      (not per org: a handle addresses YOUR agent), and excludes the words a
--      mention parser must be free to mean literally ('here', 'all', …).
--   2) user_agents.kind — 'user' or 'builtin'. The built-in orchestrator is an
--      ordinary user_agents row so every existing read, RLS policy, run and
--      capability gate applies to it unchanged; `kind` is only how the UI knows
--      not to offer "delete".
--   3) cadence 'manual' — an agent that never fires on a schedule and only runs
--      when addressed. `_personal_agent_sweep` needs NO change: its
--      `case cadence … else false end` (20260812060142:143-150) already refuses
--      an unrecognised cadence, so 'manual' can never fire.
--   4) seed_builtin_agent() + an org_members trigger, and a one-time backfill
--      so every EXISTING membership gets its assistant too.
--
-- ORDERING: this file depends on 20260905045106_agent_delegate_and_usage_run_id
-- having applied — the seed writes capabilities = '{agent.delegate}', which the
-- earlier file adds to user_agents_capabilities_known. The version stamps encode
-- that; do not reorder them.
--
-- THIS MIGRATION WRITES USER DATA, deliberately and unavoidably:
--   · every existing user_agents row gets a handle (the column is NOT NULL);
--   · every existing org membership gets its built-in assistant row.
-- Both are the *installation* of the feature, not the org-ceiling backfill the
-- owner ruled out (see 20260905045106's header). Neither reads or changes a
-- single field of anyone's existing agent beyond adding the new columns.

-- ---------------------------------------------------------------------------
-- 1) handle + kind
-- ---------------------------------------------------------------------------
alter table public.user_agents
  add column if not exists handle text,
  add column if not exists kind text not null default 'user';

-- Backfill, written as an explicit loop rather than the window-function form.
-- A set-based `row_number()` suffix can COLLIDE with a handle another row
-- already earned ("Bob" → bob, "Bob 2" → bob-2, "Bob!" → bob → bob-2), which
-- would abort the migration on the unique index below. Assigning one row at a
-- time and re-checking makes the result correct on ANY dataset, which matters
-- because this same file has to apply cleanly to a differently-shaped PROD.
do $$
declare
  r    record;
  base text;
  cand text;
  n    int;
begin
  for r in select id, owner_id, name from public.user_agents
            where handle is null order by id loop
    base := nullif(trim(both '-' from regexp_replace(lower(r.name), '[^a-z0-9]+', '-', 'g')), '');
    if base is null
       or length(base) < 2
       or base in ('here','all','everyone','channel','admin','system','monolith','support','none','me')
    then
      base := 'agent-' || left(replace(r.id::text, '-', ''), 8);
    else
      base := left(base, 30);
    end if;

    cand := base;
    n := 1;
    while exists (select 1 from public.user_agents u
                   where u.owner_id = r.owner_id and lower(u.handle) = cand) loop
      n := n + 1;
      -- left(base,28) keeps `base-99` inside the 32-char grammar.
      cand := left(base, 28) || '-' || n;
      if n > 99 then
        cand := 'agent-' || left(replace(r.id::text, '-', ''), 8);
        exit;
      end if;
    end loop;

    update public.user_agents set handle = cand where id = r.id;
  end loop;
end $$;

-- A COLUMN DEFAULT, not just NOT NULL. `handle` is added to a table that LIVE
-- code already inserts into: src/lib/agents/actions.ts:createAgent names its
-- columns explicitly and (until Task 6) does not name this one, and the
-- production deployment runs the PREVIOUS release against THIS database
-- (decision-32). NOT NULL with no default would therefore break "create agent"
-- for real users from the moment this migration lands until the whole Spec 3
-- batch is promoted. The default is the same shape the backfill above gives an
-- unsluggable name — 'agent-' + 8 hex — so it satisfies user_agents_handle_shape
-- ('a' + 13 chars of [a-z0-9-]) and is unique per owner with overwhelming
-- probability. Task 6 always writes a real handle, which wins over the default;
-- this exists so that the absence of a handle is never a hard failure.
alter table public.user_agents
  alter column handle set default 'agent-' || left(replace(gen_random_uuid()::text, '-', ''), 8);

alter table public.user_agents alter column handle set not null;

alter table public.user_agents drop constraint if exists user_agents_kind_known;
alter table public.user_agents
  add constraint user_agents_kind_known check (kind in ('user','builtin'));

-- The grammar is the addressing contract: whatever a mention parser can lift
-- out of "@bob-the-builder, please…" must be exactly what is stored.
alter table public.user_agents drop constraint if exists user_agents_handle_shape;
alter table public.user_agents
  add constraint user_agents_handle_shape check (handle ~ '^[a-z0-9][a-z0-9-]{1,31}$');

alter table public.user_agents drop constraint if exists user_agents_handle_not_reserved;
alter table public.user_agents
  add constraint user_agents_handle_not_reserved check (handle not in
    ('here','all','everyone','channel','admin','system','monolith','support','none','me'));

-- Unique per OWNER, case-insensitively: @finance means YOUR finance agent, and
-- two people in one org may each have one.
create unique index if not exists user_agents_owner_handle_uniq
  on public.user_agents (owner_id, lower(handle));
-- Exactly one built-in per (org, membership). Partial, so it costs nothing on
-- the ordinary rows and makes the seed idempotent by construction.
create unique index if not exists user_agents_owner_builtin_uniq
  on public.user_agents (org_id, owner_id) where kind = 'builtin';

-- GLOBAL CONSTRAINT: user_agents carries COLUMN-SCOPED insert/update grants for
-- `authenticated`, and they do not extend themselves to a new column. A missing
-- grant here is a hard Postgres failure on every agent save.
-- `kind` is deliberately in NEITHER list — only seed_builtin_agent writes it,
-- so no client can promote its own agent to a built-in.
grant insert (org_id, owner_id, name, template_id, instructions, board_scope,
              cadence, run_at_local_hour, enabled, provider, model_id,
              capabilities, run_on_weekday, run_on_day_of_month, handle)
  on public.user_agents to authenticated;
grant update (name, template_id, instructions, board_scope, cadence,
              run_at_local_hour, enabled, provider, model_id, capabilities,
              run_on_weekday, run_on_day_of_month, updated_at, handle)
  on public.user_agents to authenticated;

comment on column public.user_agents.handle is
  'The typeable address (@handle). Lowercase, 2..32, unique per OWNER, and '
  'never one of the reserved mention words.';
comment on column public.user_agents.kind is
  'user = created by its owner; builtin = the seeded orchestrator. A built-in '
  'row is an ordinary agent in every other respect.';

-- ---------------------------------------------------------------------------
-- 2) cadence 'manual'
-- ---------------------------------------------------------------------------
alter table public.user_agents drop constraint if exists user_agents_cadence_check;
alter table public.user_agents add constraint user_agents_cadence_check
  check (cadence in ('daily','weekdays','weekly','monthly','manual'));

alter table public.user_agents drop constraint if exists user_agents_cadence_fields;
alter table public.user_agents add constraint user_agents_cadence_fields check (
  (cadence in ('daily','weekdays','manual')
     and run_on_weekday is null and run_on_day_of_month is null)
  or (cadence = 'weekly'  and run_on_weekday is not null and run_on_day_of_month is null)
  or (cadence = 'monthly' and run_on_weekday is null and run_on_day_of_month is not null)
);

-- ---------------------------------------------------------------------------
-- 3) The built-in orchestrator, one per membership
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because it runs from a trigger on org_members, under
-- whatever role accepted the membership — and it writes `kind`, which no client
-- role is granted. Idempotent twice over: the handle loop finds a free address,
-- and `on conflict do nothing` lets user_agents_owner_builtin_uniq (and the
-- owner/name index) be the last word.
--
-- The NAME is suffixed in step with the handle. Seeding the literal 'Assistant'
-- for everyone would collide with user_agents_owner_name_uniq for a person who
-- belongs to more than one org — `on conflict do nothing` would then silently
-- leave their second org with no assistant at all. (Three of the twenty current
-- memberships are such users.)
create or replace function public.seed_builtin_agent(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_handle text := 'assistant'; v_name text := 'Assistant'; v_n int := 1;
begin
  while exists (select 1 from public.user_agents
                 where owner_id = p_user and lower(handle) = v_handle) loop
    v_n := v_n + 1;
    v_handle := 'assistant-' || v_n;
    v_name := 'Assistant ' || v_n;
    if v_n > 20 then return; end if;
  end loop;
  insert into public.user_agents
    (org_id, owner_id, name, handle, kind, template_id, instructions,
     board_scope, cadence, run_at_local_hour, enabled, capabilities)
  values
    (p_org, p_user, v_name, v_handle, 'builtin', 'builtin-orchestrator',
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

-- GLOBAL CONSTRAINT (and the repo's standing rule for definer trigger
-- functions — every one of them is {postgres, service_role} and nothing else):
-- a freshly created function is EXECUTE-to-PUBLIC, and `create or replace` does
-- not restore revoked grants. A definer function reachable by `authenticated`
-- is an escalation surface even when it can only run as a trigger.
revoke all on function public.seed_builtin_agent_trigger() from public, anon, authenticated;
grant execute on function public.seed_builtin_agent_trigger() to service_role;

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

comment on function public.seed_builtin_agent(uuid, uuid) is
  'Creates the per-membership built-in orchestrator agent (kind = builtin, '
  'cadence = manual, capabilities = {agent.delegate}). Idempotent.';
