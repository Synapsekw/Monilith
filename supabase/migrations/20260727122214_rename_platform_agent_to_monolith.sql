-- 20260727122214_rename_platform_agent_to_monolith.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (product rename Pulse → Monolith, DB half):
--   The scheduled board agent posts board updates and notifications as a seeded
--   platform bot principal created by 20260720120517_board_agents.sql. Its
--   `profiles.full_name` ("Pulse Autopilot") is the author name rendered on every
--   update it has ever written, so the UI copy and the stamped authorship have to
--   be renamed in lockstep — renaming one without the other makes the screen
--   disagree with the data.
--
--   Renames the display name to "Monolith Autopilot" in BOTH places it is held:
--     1) public.profiles.full_name       — what the UI actually reads/renders.
--     2) auth.users.raw_user_meta_data   — the source handle_new_user mirrors into
--                                          profiles, so a re-mirror cannot resurrect
--                                          the stale name.
--
-- What it deliberately does NOT change: the email `pulse-autopilot@pulse.internal`.
-- That address is the LOOKUP KEY — public.platform_agent_user_id() resolves the bot
-- with `select id from auth.users where email = 'pulse-autopilot@pulse.internal'`,
-- and board_agent_apply() authors comments/notifications as whatever that helper
-- returns. Renaming the address would orphan the identity (helper returns null →
-- null author_id → the confined applier fails). It is an internal, non-routable,
-- never-user-visible address; only the display name is user-facing.
--
-- Idempotent and safe to re-run: both statements are UPDATEs matched on the fixed
-- lookup email, so a re-apply is a no-op, and on a fresh project where the bot row
-- has not been seeded (or the seed is skipped) they update zero rows rather than
-- failing — matching the defensive style of the original migration.

-- 1) The profile row the UI reads (author name on every agent-written update).
update public.profiles
   set full_name = 'Monolith Autopilot'
 where email = 'pulse-autopilot@pulse.internal'
   and full_name is distinct from 'Monolith Autopilot';

-- 2) The auth metadata handle_new_user mirrors into profiles on insert. Kept in
--    sync so a re-seed / re-mirror can never reintroduce the old name.
update auth.users
   set raw_user_meta_data =
         jsonb_set(
           coalesce(raw_user_meta_data, '{}'::jsonb),
           '{full_name}',
           '"Monolith Autopilot"'::jsonb,
           true
         )
 where email = 'pulse-autopilot@pulse.internal'
   and raw_user_meta_data->>'full_name' is distinct from 'Monolith Autopilot';
