-- 20260802034242_agent_run_history_and_hardening.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Personal Agents · Phase 1 follow-ups):
--   1) get_my_agent_last_runs() — the ONE bounded read backing the roster's
--      per-agent last-run status on first paint.
--   2) Scopes the agent-name unique index to the org (it was global).
--   3) A check constraint on board_scope, so a malformed row cannot crash a run.
--   4) Makes the vault-cleanup trigger re-runnable.
--   5) Takes bridge_secret_id out of reach of the browser (column-scoped grants).
--
-- Each is an independent defect carried out of the Phase 1 review; they share a
-- file because they share one table and one apply.

-- ---------------------------------------------------------------------------
-- 1. Last-run-per-agent, in one round trip.
-- ---------------------------------------------------------------------------
-- The roster needs "how did this agent's most recent run end?" for every agent
-- the caller owns. Per-agent queries would be an N+1; a plain
-- select-and-reduce-in-JS would sort over (owner_id, created_at), for which
-- there is no index. `distinct on (user_agent_id) ... order by user_agent_id,
-- created_at desc` walks user_agent_runs_history_idx — the SAME index the
-- expanded history read uses — taking the first row per agent, so the work is
-- bounded by the caller's agent count (max_agents_per_user, default 3) rather
-- than their run count. Working agreement #5.
--
-- SECURITY INVOKER is stated explicitly rather than left to the default,
-- because it IS the security property here: the caller's own RLS filters
-- user_agent_runs, so this cannot return another person's runs. The body's
-- `owner_id = auth.uid()` predicate exists to pick the index, not to enforce
-- access — deleting it would change the plan, not the visibility.
create or replace function public.get_my_agent_last_runs()
returns table (
  user_agent_id uuid,
  status text,
  error text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (r.user_agent_id)
         r.user_agent_id,
         r.status,
         r.error,
         r.created_at
  from public.user_agent_runs r
  where r.owner_id = (select auth.uid())
  order by r.user_agent_id, r.created_at desc
$$;

-- Default EXECUTE is granted to PUBLIC; strip it and hand it back to signed-in
-- callers only. `anon` must stay unable to reach any function
-- (ANON_REACHABLE_FUNCTION_ALLOWLIST is empty by design — see
-- src/test/anon-conformance.ts and 20260725102610_definer_acl_lockdown.sql).
revoke all on function public.get_my_agent_last_runs() from public, anon;
grant execute on function public.get_my_agent_last_runs() to authenticated;

comment on function public.get_my_agent_last_runs() is
  'Most recent user_agent_runs row per agent for the calling user. SECURITY INVOKER: RLS is the boundary.';

-- ---------------------------------------------------------------------------
-- 2. Agent names are unique per person PER ORG, not globally.
-- ---------------------------------------------------------------------------
-- 20260801091231 indexed (owner_id, lower(name)). A person can belong to
-- several orgs (getUserOrgs() returns a list), and every other per-user limit on
-- this table is already org-scoped (countAgentsForOwner, countRunsToday), so a
-- global name index meant creating "Morning Brief" in one org silently blocked
-- creating "Morning Brief" in another — surfacing as createAgent's generic
-- "Couldn't create that agent." The replacement is strictly weaker than the old
-- index (same columns plus org_id), so no existing row can violate it.
drop index if exists public.user_agents_owner_name_uniq;

create unique index if not exists user_agents_org_owner_name_uniq
  on public.user_agents (org_id, owner_id, lower(name));

-- ---------------------------------------------------------------------------
-- 3. board_scope must actually be a board scope.
-- ---------------------------------------------------------------------------
-- The column was `jsonb not null` with no shape check. Zod (boardScopeSchema,
-- agent-config.ts) guards the app's write path, but the database is the last
-- line: a row written by hand, by a future service-role caller, or restored
-- from a backup as {"mode":"list"} with no boardIds reaches applyBoardScope
-- (briefing.ts), which calls `new Set(scope.boardIds)` on undefined and throws
-- — killing that agent's run every day as an opaque error row. Mirrors
-- boardScopeSchema exactly, including the 1..50 bound.
alter table public.user_agents
  drop constraint if exists user_agents_board_scope_shape;

alter table public.user_agents
  add constraint user_agents_board_scope_shape check (
    jsonb_typeof(board_scope) = 'object'
    and (
      board_scope->>'mode' = 'all'
      or (
        board_scope->>'mode' = 'list'
        and jsonb_typeof(board_scope->'boardIds') = 'array'
        and jsonb_array_length(board_scope->'boardIds') between 1 and 50
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. The vault-cleanup trigger is re-runnable.
-- ---------------------------------------------------------------------------
-- 20260801094908 paired a `create or replace function` with a bare
-- `create trigger`, so re-applying that file raises 42710 — unlike every
-- sibling migration in this feature, all of which are idempotent. Nothing about
-- the trigger's behaviour changes here; it is dropped and recreated identically.
drop trigger if exists user_agents_before_delete on public.user_agents;

create trigger user_agents_before_delete
  before delete on public.user_agents
  for each row execute function public.user_agents_vault_cleanup();

-- ---------------------------------------------------------------------------
-- 5. bridge_secret_id is not client-writable.
-- ---------------------------------------------------------------------------
-- user_agents_owner_all is `for all`, and `authenticated` holds a TABLE-level
-- INSERT/UPDATE grant, so the browser could PATCH its own agent's
-- bridge_secret_id through PostgREST. owner-client.ts's owner-scope invariant
-- (it re-checks auth.getUser() against agent.owner_id) means pointing the column
-- at someone else's bridged session fails closed rather than impersonating them
-- — but the row is still the input to user_agents_vault_cleanup, so setting it
-- to another user's MCP OAuth secret id and then deleting the agent would delete
-- THAT person's secret. The column is written by exactly one module
-- (owner-client.ts, through the service client), so no legitimate browser write
-- is lost.
--
-- A column-level REVOKE cannot subtract from a table-level grant, so the
-- table-level INSERT/UPDATE is dropped and re-granted column by column. The
-- lists are exactly what src/lib/agents/actions.ts writes: createAgent's insert
-- columns, and updateAgent/setAgentEnabled's patch columns (updated_at is set by
-- the action, not by a trigger, so it must stay writable). id, created_at,
-- org_id and owner_id are deliberately absent from the UPDATE list — nothing
-- re-parents an agent. DELETE is untouched, so deleteAgent still works.
-- service_role keeps its full table grant and bypasses RLS, so the run endpoint
-- and owner-client.ts are unaffected.
revoke insert, update on public.user_agents from authenticated;

grant insert (org_id, owner_id, name, template_id, instructions,
              board_scope, cadence, run_at_local_hour, enabled)
  on public.user_agents to authenticated;

grant update (name, template_id, instructions, board_scope, cadence,
              run_at_local_hour, enabled, updated_at)
  on public.user_agents to authenticated;

comment on column public.user_agents.bridge_secret_id is
  'Vault secret id for the owner-scoped session (owner-client.ts). Service-role only: absent from authenticated''s column grants.';
