-- 20260804093518_board_thread_board_fk_set_null.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Softens ai_conversations.board_id's foreign key from ON DELETE CASCADE to
--   ON DELETE SET NULL.
--
--   20260804031458_board_threads.sql chose CASCADE. That makes purging a board
--   destroy other people's conversations: purgeBoard (src/lib/boards/actions/
--   board.ts) is an OWNER-ONLY hard delete of an archived board, and every
--   member's docked threads hang off that board — including visibility='private'
--   threads holding conversation the board owner has never been able to read.
--   CASCADE deletes those conversations and all their messages, silently and
--   unrecoverably, performed by somebody other than their owner.
--
--   SET NULL degrades the thread to a plain /ask thread instead. It also fails
--   CLOSED: the shared-read policy's first conjunct is `board_id is not null`,
--   so a previously-shared thread stops matching and becomes private again the
--   moment the board goes. This is the same graceful degradation the original
--   migration already chose for agent_id and run_id.
--
--   No data change and no table rewrite: replacing a foreign key only
--   revalidates the existing rows, which already satisfy it.

alter table public.ai_conversations
  drop constraint ai_conversations_board_id_fkey;

alter table public.ai_conversations
  add constraint ai_conversations_board_id_fkey
    foreign key (board_id) references public.boards (id) on delete set null;
