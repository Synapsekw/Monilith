-- 20261113140203_stop_personal_agents.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Disables old agents, drops the orchestrator seed trigger, unschedules two sweep crons.

-- Personal Monos, Plan 1 / unit Z. Stops the old agent system without
-- dropping its tables (dropped later, unit D).
--
-- 1. No more built-in orchestrator per membership: 26 were seeded, none ever ran.
drop trigger if exists org_members_seed_builtin_agent on public.org_members;
drop function if exists public.seed_builtin_agent_trigger();

-- 2. Nothing runs any more. Aria (the only real agent) has failed every
--    scheduled run since 2026-09-15 with an invalid refresh token.
update public.user_agents set enabled = false where enabled;
update public.board_agents set enabled = false where enabled;

-- 3. The hourly sweeps would otherwise keep POSTing to routes that Plan 1
--    deletes. Unschedule by name, tolerating a job that is already gone.
do $$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('personal-agent-sweep', 'autopilot-sweep');
end
$$;
