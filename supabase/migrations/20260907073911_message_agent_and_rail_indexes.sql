-- 20260907073911_message_agent_and_rail_indexes.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds ai_messages.agent_id (nullable FK to user_agents) and two partial
--   indexes on ai_conversations so the rail can read chats and briefings
--   as separate, index-only queries.

-- Who a turn belongs to: on a user turn, the agent it was addressed to; on an
-- assistant turn, the agent that answered. NULL is the plain Monolith
-- assistant, which is what every pre-existing row is.
--
-- `on delete set null`, never cascade: deleting an agent must not delete the
-- owner's transcript. No new policy — `ai_messages` is insert-only and its
-- existing policies gate on conversation ownership, not per column.
alter table public.ai_messages
  add column agent_id uuid references public.user_agents (id) on delete set null;

-- The rail reads chats and briefings SEPARATELY so a week of daily reports can
-- no longer push chats past the shared cap. Each read is `user_id = $1` +
-- `order by updated_at desc limit 50` with the run_id predicate constant, so a
-- partial index serves each one index-only.
create index ai_conversations_chats_idx
  on public.ai_conversations (user_id, updated_at desc)
  where run_id is null;

create index ai_conversations_briefings_idx
  on public.ai_conversations (user_id, updated_at desc)
  where run_id is not null;
