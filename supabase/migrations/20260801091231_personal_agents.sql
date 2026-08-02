-- 20260801091231_personal_agents.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Personal Agents · Phase 1):
--   1) user_agents      — one row per personal agent (owner, role text, scope,
--                         cadence, local hour, enabled kill switch).
--   2) user_agent_runs  — audit + idempotency, keyed (agent, fire_date, fire_hour).
--   3) Per-user caps on org_ai_settings so personal agents cannot drain the pool.
-- RLS is owner-scoped: a user reads/writes only their own agents. Cross-org is
-- default-denied. The sweep + confined hop land in the sibling sweep migration.

create table if not exists public.user_agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  template_id text not null check (length(template_id) between 1 and 64),
  instructions text not null check (length(instructions) between 1 and 2000),
  board_scope jsonb not null default '{"mode":"all"}'::jsonb,
  cadence text not null default 'daily' check (cadence in ('daily')),
  run_at_local_hour int not null default 7 check (run_at_local_hour between 0 and 23),
  enabled boolean not null default true,
  -- Vault secret id backing the owner-scoped session (see owner-client.ts).
  bridge_secret_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One person cannot have two agents with the same name (case-insensitive).
create unique index if not exists user_agents_owner_name_uniq
  on public.user_agents (owner_id, lower(name));
-- Roster read.
create index if not exists user_agents_owner_enabled_idx
  on public.user_agents (owner_id, enabled);
-- Sweep read: only enabled agents at the matching local hour.
create index if not exists user_agents_sweep_idx
  on public.user_agents (enabled, run_at_local_hour);

create table if not exists public.user_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_agent_id uuid not null references public.user_agents(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  fire_date date not null,
  fire_hour int not null check (fire_hour between 0 and 23),
  status text not null check (status in ('ran','skipped','error')),
  error text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

-- THE idempotency key: a redelivered fire slot can never produce a second run
-- (and therefore never a second email).
create unique index if not exists user_agent_runs_slot_uniq
  on public.user_agent_runs (user_agent_id, fire_date, fire_hour);
create index if not exists user_agent_runs_history_idx
  on public.user_agent_runs (user_agent_id, created_at desc);

alter table public.user_agents enable row level security;
alter table public.user_agent_runs enable row level security;

-- Owner-scoped, default-deny. No org-admin read: an agent's instructions are
-- personal, and Phase 1 agents take no action anyone else needs to audit.
-- `with check` also pins org_id to an org the caller actually belongs to
-- (public.is_org_member, deactivation-aware) — org_id feeds per-org cap
-- bookkeeping on org_ai_settings and the sweep's per-org loop, so an
-- unvalidated org_id on insert/update would let a caller misattribute their
-- agent's cap consumption and run history to an org they don't belong to.
-- `using` stays owner_id-only (no is_org_member there): the owner must always
-- be able to read/update/delete their own row, including a stale one left
-- behind after they leave org_id's org — losing read/delete access to your
-- own row on membership change would be a worse outcome than a temporarily
-- stale org_id on an already-owner-scoped row. Matches the write-side-only
-- is_org_member placement in relation_links' "write if can edit board" policy
-- (20260621060001_relation_links.sql).
create policy user_agents_owner_all on public.user_agents
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

-- select-only, no is_org_member check needed: there is no authenticated
-- write policy on this table at all (see below), so org_id here is never
-- attacker-controlled through RLS — it is only ever set by the service-role
-- endpoint, which bypasses RLS entirely.
create policy user_agent_runs_owner_read on public.user_agent_runs
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Runs are written only by the service-role endpoint; no authenticated insert.

-- Per-user caps (admin-set entitlements, consistent with the existing model).
alter table public.org_ai_settings
  add column if not exists max_agents_per_user int not null default 3
    check (max_agents_per_user between 0 and 20),
  add column if not exists max_agent_runs_per_user_per_day int not null default 3
    check (max_agent_runs_per_user_per_day between 0 and 24);

-- A SEPARATE opt-out from the weekly org digest's `email_digest_opt_out`:
-- someone may want the personal briefing and not the org digest, or the reverse.
-- Unsubscribing from one must never silently unsubscribe from the other.
alter table public.profiles
  add column if not exists email_briefing_opt_out boolean not null default false;

comment on column public.profiles.email_briefing_opt_out is
  'Opt-out for personal agent daily briefings. Independent of email_digest_opt_out.';
