-- 20260905045101_agent_run_graph.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Spec 3 · Task 1 · migration 1 of 4):
--   1) user_agent_runs becomes a SHALLOW TREE. `parent_run_id` points at the
--      run that delegated this one, `depth` is 0 or 1 (the cap is a CHECK, not
--      a convention), and `trigger` records WHY the run exists — the hourly
--      sweep, a `delegate` tool call, or an @handle mention on an item update.
--   2) `fire_hour` loses its NOT NULL. It is the SCHEDULE slot; a delegated or
--      mentioned run has no slot, and forcing one on it would either collide
--      with a real scheduled run or invent a fake hour. `user_agent_runs_slot_shape`
--      makes the pairing exact in both directions: schedule ⇔ fire_hour.
--   3) The idempotency index becomes PARTIAL — `where trigger = 'schedule'`.
--      A redelivered fire slot must still be unable to produce a second run,
--      but a NULL fire_hour makes every non-scheduled row unique under a btree
--      anyway, so the old total index would silently stop arbitrating exactly
--      the rows that need arbitrating. Their arbitration is agent_run_claim.
--   4) agent_run_claim() — the ONE creation path for a non-scheduled run.
--      SECURITY DEFINER, because it must count rows the caller cannot see and
--      insert into a table with no authenticated INSERT policy at all; it takes
--      the agent row lock FIRST, because every limit below it is a
--      count-then-insert, which is not atomic at READ COMMITTED.
--
-- DDL ONLY. NOT ONE ROW OF USER DATA IS READ OR WRITTEN BY THIS MIGRATION.
-- The three new columns take defaults that describe every existing row exactly
-- (a root, depth 0, produced by the sweep), so the backfill is the default.
--
-- CONTRACT WITH TYPESCRIPT: the placeholder written into `error` on the claim
-- insert is byte-identical to `CLAIM_PLACEHOLDER` in src/lib/agents/run-status.ts.
-- The UI decodes "claimed but never finalised" by comparing that string with
-- `===`, so a drifted byte here does not fail a test — it silently reclassifies
-- every crashed run as an ordinary error. src/lib/agents/claim-placeholder.test.ts
-- reads THIS FILE and asserts the literal.

-- ---------------------------------------------------------------------------
-- 1) The tree columns
-- ---------------------------------------------------------------------------
alter table public.user_agent_runs
  add column if not exists parent_run_id uuid
    references public.user_agent_runs(id) on delete cascade,
  add column if not exists depth smallint not null default 0,
  add column if not exists trigger text not null default 'schedule';

-- A non-scheduled run has no fire slot. See the header, point 2.
alter table public.user_agent_runs alter column fire_hour drop not null;

alter table public.user_agent_runs
  drop constraint if exists user_agent_runs_trigger_known;
alter table public.user_agent_runs
  add constraint user_agent_runs_trigger_known
    check (trigger in ('schedule','delegation','mention'));

-- depth and parenthood are two spellings of one fact; let them disagree and
-- the fan-out/depth arithmetic in agent_run_claim is reading a lie.
alter table public.user_agent_runs
  drop constraint if exists user_agent_runs_depth_root;
alter table public.user_agent_runs
  add constraint user_agent_runs_depth_root
    check ((parent_run_id is null) = (depth = 0));

-- THE depth cap, in the schema rather than only in the RPC: one level of
-- delegation, ruled 2026-09-04. A child cannot delegate again.
alter table public.user_agent_runs
  drop constraint if exists user_agent_runs_depth_capped;
alter table public.user_agent_runs
  add constraint user_agent_runs_depth_capped
    check (depth between 0 and 1);

alter table public.user_agent_runs
  drop constraint if exists user_agent_runs_slot_shape;
alter table public.user_agent_runs
  add constraint user_agent_runs_slot_shape
    check ((trigger = 'schedule') = (fire_hour is not null));

-- The slot lock now covers SCHEDULED runs only. A delegated or mention run has
-- no fire slot to race for; its arbitration is agent_run_claim below.
drop index if exists public.user_agent_runs_slot_uniq;
create unique index user_agent_runs_slot_uniq
  on public.user_agent_runs (user_agent_id, fire_date, fire_hour)
  where trigger = 'schedule';

-- Bounded, indexed reads only (AGENTS.md working agreement #5): the run-history
-- tree fetches children BY PARENT, and the mention cooldown counts recent
-- mention rows for one agent. Both are partial — the vast majority of rows are
-- scheduled roots and belong in neither index.
create index if not exists user_agent_runs_parent_idx
  on public.user_agent_runs (parent_run_id) where parent_run_id is not null;
create index if not exists user_agent_runs_mention_idx
  on public.user_agent_runs (user_agent_id, created_at desc) where trigger = 'mention';

comment on column public.user_agent_runs.trigger is
  'schedule = the hourly sweep; delegation = a child run started by delegate; '
  'mention = an @handle in an item update. Only schedule occupies a fire slot.';
comment on column public.user_agent_runs.parent_run_id is
  'The run whose delegate tool call created this one. NULL for every root run. '
  'ON DELETE CASCADE: a deleted parent takes its children with it, because a '
  'child run is only interpretable as part of its parent''s transcript.';
comment on column public.user_agent_runs.depth is
  '0 for a root run, 1 for a delegated child. Capped at 1 by CHECK — the depth '
  'limit is schema, not policy, so no code path can widen it by accident.';

-- ---------------------------------------------------------------------------
-- 2) agent_run_claim(): the only way a non-scheduled run row comes into being
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER, and deliberately so — the opposite call from agent_remember
-- (20260827095748), which is INVOKER precisely because it must grant nothing.
-- This one MUST see what the caller cannot: the org's daily cap on
-- org_ai_settings (not readable by an ordinary member), sibling run counts, and
-- an INSERT into user_agent_runs, which has NO authenticated insert policy at
-- all. Ownership is therefore re-proved here by hand, against auth.uid().
--
-- Returns an OUTCOME rather than raising. Every refusal is a normal, expected
-- answer that the caller renders — "your agent is busy", "you have used today's
-- runs" — and a raise would surface as an opaque 500 with nothing to say.
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
  -- 'schedule' is NOT claimable here: the sweep owns that path and arbitrates
  -- it with user_agent_runs_slot_uniq. Letting it through would mint a second
  -- run for a slot the unique index is guarding.
  if p_trigger not in ('delegation','mention') then
    return query select 'refused_bad_trigger'::text, null::uuid; return;
  end if;

  -- The SAME row lock agent_remember takes, for the same reason: every count
  -- below is a count-then-insert, which is not atomic at READ COMMITTED. Two
  -- concurrent mentions would each see "0 recent" and both insert.
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
    -- depth <> 0 is THE depth cap: a child may not delegate. Same-owner is the
    -- tenancy check — a parent run can only ever summon its own owner's agents.
    if not found or v_parent.owner_id <> v_agent.owner_id or v_parent.depth <> 0 then
      return query select 'refused_depth'::text, null::uuid; return;
    end if;
    select count(*) into v_siblings
      from public.user_agent_runs r where r.parent_run_id = p_parent_run_id;
    -- DELEGATE_FANOUT_MAX = 3, ruled 2026-09-04.
    if v_siblings >= 3 then
      return query select 'refused_fanout'::text, null::uuid; return;
    end if;
    v_depth := 1;
    v_today := v_parent.fire_date;   -- a child belongs to its parent's day
  else
    if p_parent_run_id is not null then
      return query select 'refused_depth'::text, null::uuid; return;
    end if;
    -- Mention cooldown. Cheap, and the only thing standing between one noisy
    -- thread and an unbounded number of billed runs.
    select count(*) into v_recent
      from public.user_agent_runs r
     where r.user_agent_id = p_agent_id
       and r.trigger = 'mention'
       and r.created_at > now() - interval '5 minutes';
    if v_recent > 0 then
      return query select 'refused_cooldown'::text, null::uuid; return;
    end if;
    -- The org's per-user daily cap, counted over ROOT runs only: a delegated
    -- child is part of its parent's run, not a second one.
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

  -- status 'error' + the placeholder IS the claim: the row exists, consumes its
  -- budget and cannot be double-claimed, and only finalizeRun rewrites it. A
  -- process that dies mid-run therefore leaves a visible failure, never a
  -- phantom success. The literal must equal CLAIM_PLACEHOLDER byte for byte.
  insert into public.user_agent_runs
    (user_agent_id, org_id, owner_id, fire_date, fire_hour, status, error,
     parent_run_id, depth, trigger)
  values
    (v_agent.id, v_agent.org_id, v_agent.owner_id, v_today, null, 'error',
     'claimed; result not yet recorded', p_parent_run_id, v_depth, p_trigger)
  returning id into v_id;

  return query select 'claimed'::text, v_id;
end; $$;

-- GLOBAL CONSTRAINT: `create or replace` on a definer function does NOT restore
-- revoked grants, and a freshly created one is EXECUTE-to-PUBLIC by default.
-- Restate both, against this exact argument list.
revoke all on function public.agent_run_claim(uuid, text, uuid)
  from public, anon;
grant execute on function public.agent_run_claim(uuid, text, uuid)
  to authenticated, service_role;

comment on function public.agent_run_claim(uuid, text, uuid) is
  'The ONE creation path for a non-scheduled user_agent_runs row. Enforces '
  'ownership, the enabled kill switch, depth (<=1), delegation fan-out (<=3), '
  'the 5-minute mention cooldown and the org daily cap under a row lock, then '
  'inserts the claim placeholder. Returns (outcome, run_id); outcome is '
  'claimed | refused_bad_trigger | refused_not_owner | refused_disabled | '
  'refused_depth | refused_fanout | refused_cooldown | refused_daily_cap.';
