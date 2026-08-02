-- 20260801095917_agent_briefing_notification_kind.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds 'agent_briefing' to the closed public.notification_kind enum so the
--   personal-agents daily briefing can file an in-app notification. Ships as
--   its own migration (not bundled with the feature code that inserts the
--   value) because a newly added enum value cannot be referenced in the same
--   transaction that adds it — this must land and apply before any code path
--   writes 'agent_briefing'. Precedent: 20260618140000_automations.sql:45
--   (ADD VALUE is safe here: we do not USE the new value in DML in this
--   migration).
--
--   Production has no RESEND_API_KEY configured, so the in-app notification
--   is the only delivery channel there — without this value the briefing
--   feature delivers nothing at all on prod.

alter type public.notification_kind add value if not exists 'agent_briefing';

