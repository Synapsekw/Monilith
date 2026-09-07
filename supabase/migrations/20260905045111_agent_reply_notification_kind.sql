-- 20260905045111_agent_reply_notification_kind.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Spec 3 · Task 1 · migration 4 of 4):
--   Adds 'agent_reply' to the closed public.notification_kind enum so an agent
--   summoned by an @handle on an item update can notify the person who
--   summoned it when its answer lands.
--
--   ALONE IN ITS OWN FILE, and that is the whole point: a newly added enum
--   value cannot be referenced in the transaction that adds it, so this must
--   land and apply BEFORE any code path writes 'agent_reply' (Task 11).
--   Precedent: 20260801095917_agent_briefing_notification_kind.sql, which
--   carries the same single statement for the same reason.
--
--   `if not exists` makes it idempotent; ADD VALUE is safe here because this
--   migration does not USE the new value in any DML.

alter type public.notification_kind add value if not exists 'agent_reply';
