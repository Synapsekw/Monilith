-- 20260907083013_agent_structure_capabilities.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   'board.structure' and 'board.destroy' join the closed capability
--   vocabulary — both the per-agent CHECK on user_agents.capabilities and the
--   admin clamp org_ai_settings.agent_capability_ceiling.
--
-- DDL ONLY. NOT ONE ROW OF USER DATA IS READ OR WRITTEN BY THIS MIGRATION.
--
-- ===========================================================================
-- THE CEILING BACKFILL IS DELIBERATELY ABSENT.
-- ===========================================================================
-- Same ruling as 'memory.write' (20260827095748_agent_memory.sql) and
-- 'agent.delegate' (20260905045106_agent_delegate_and_usage_run_id.sql): the
-- DEV database holds real, live, user-facing data (decision-32), and a
-- data-modifying statement against it is production surgery that is reviewed
-- and run on its own, never as a side effect of shipping a feature branch.
--
-- The exact statements, recorded here so they are reviewable in the diff and
-- runnable verbatim later. THEY HAVE NOT BEEN EXECUTED:
--
--     update public.org_ai_settings
--        set agent_capability_ceiling =
--            agent_capability_ceiling || 'board.structure'
--      where not ('board.structure' = any (agent_capability_ceiling));
--
--     update public.org_ai_settings
--        set agent_capability_ceiling =
--            agent_capability_ceiling || 'board.destroy'
--      where not ('board.destroy' = any (agent_capability_ceiling));
--
-- WHAT THAT MEANS FOR THIS SHIP: every org with an org_ai_settings row carries
-- an array that predates these two strings, so the ceiling check in
-- grant-gate.ts refuses them before the grant check runs and records NO
-- proposal. The structure surface therefore ships INSTALLABLE BUT INERT, and
-- AN ADMIN MUST OPEN THE ORG CEILING before any agent can build anything.
--
-- The `alter column … set default` is deliberately NOT restated below. The
-- DEFAULT decides what a brand-new org gets, and handing structure writes to
-- every future org automatically is the same silent grant the backfill was
-- refused for. It must also stay byte-identical to
-- DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling (src/lib/ai/org-settings.ts),
-- which src/lib/ai/org-settings.test.ts pins at five strings.

alter table public.user_agents
  drop constraint if exists user_agents_capabilities_known;
alter table public.user_agents
  add constraint user_agents_capabilities_known
  check (capabilities <@ array['board.write','files.write','automation.create',
                              'time.log','memory.write','agent.delegate',
                              'board.structure','board.destroy']::text[]);

alter table public.org_ai_settings
  drop constraint if exists org_ai_settings_ceiling_known;
alter table public.org_ai_settings
  add constraint org_ai_settings_ceiling_known
  check (agent_capability_ceiling <@ array['board.write','files.write',
                                          'automation.create','time.log',
                                          'memory.write','agent.delegate',
                                          'board.structure',
                                          'board.destroy']::text[]);
