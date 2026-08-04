-- 20260804031458_board_threads.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Scopes an ai_conversation to a board and, optionally, to one of the owner's
--   personal agents, and lets the owner share a thread with that board's members.
--
--   The RLS change is ADDITIVE and SELECT-only. `visibility` defaults 'private'
--   and `board_id` defaults null, so every row that exists at migration time
--   fails both conjuncts of the new policy — it is structurally incapable of
--   matching pre-existing private /ask history. INSERT/UPDATE/DELETE are
--   untouched: a shared thread is READABLE by board members, never writable.

alter table public.ai_conversations
  add column board_id uuid references public.boards (id) on delete cascade,
  add column agent_id uuid references public.user_agents (id) on delete set null,
  add column run_id uuid references public.user_agent_runs (id) on delete set null,
  add column visibility text not null default 'private'
    check (visibility in ('private', 'board'));

-- Partial: the existing /ask rows (board_id null) stay out of this index entirely.
create index ai_conversations_board_updated_idx
  on public.ai_conversations (board_id, updated_at desc)
  where board_id is not null;

-- The idempotency key for briefing threads: one thread per agent run, enforced
-- by the database, so a redelivered fire slot cannot mint a second thread.
create unique index ai_conversations_run_id_key
  on public.ai_conversations (run_id)
  where run_id is not null;

-- Covering index for the agent_id FK (advisor: unindexed foreign keys).
create index ai_conversations_agent_idx
  on public.ai_conversations (agent_id)
  where agent_id is not null;

-- can_read_board() already requires ACTIVE ORG MEMBERSHIP and creator-or-member,
-- and is security definer over boards/board_members only, so there is no
-- recursion and no separate cross-tenant check to forget.
create policy "ai_conversations_select_board_shared" on public.ai_conversations
  for select using (
    board_id is not null
    and visibility = 'board'
    and public.can_read_board(board_id)
  );

create policy "ai_messages_select_board_shared" on public.ai_messages
  for select using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id
      and c.board_id is not null
      and c.visibility = 'board'
      and public.can_read_board(c.board_id)
  ));
