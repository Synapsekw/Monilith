-- 20260804144223_board_thread_org_coupling.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Couples ai_conversations.board_id to ai_conversations.org_id, so a thread
--   can only be docked to a board that lives in the SAME org the thread is
--   stamped with.
--
--   This is NOT a tenant escape being closed — RLS already bounds who can read
--   a docked thread (ai_conversations_select_board_shared requires
--   can_read_board(board_id), which requires active membership of the BOARD's
--   org). What drifts is ATTRIBUTION: createConversation resolves board_id from
--   the board (whichever of the caller's orgs that is) and org_id from the
--   pulse_active_org cookie, and nothing reconciled the two. A multi-org user
--   with the cookie on org B, opening a board in org A, produced a thread
--   stamped B sitting in A's dock. No attack required.
--
-- WHY A COMPOSITE FK AND NOT A CHECK OR A TRIGGER
--   A CHECK cannot subquery, and CHECK(board_in_org(...)) is a footgun: a CHECK
--   is required to be IMMUTABLE and is never re-evaluated when the referenced
--   row changes. A trigger would work but is hand-written PL/pgSQL with its own
--   search_path hardening, its own ACL, and its own `if new.board_id is null
--   then return new` line that a future edit can lose. The referential-integrity
--   machinery gives the same guarantee declaratively, for every role including
--   service_role (which bypasses RLS but never a constraint).
--
-- WHY board_id IS NULL STAYS LEGAL
--   A composite FK defaults to MATCH SIMPLE: if ANY referencing column is null
--   the constraint is satisfied with no lookup. org_id is NOT NULL and board_id
--   is nullable, so every /ask thread and every scheduled briefing (board_id is
--   null by construction) passes trivially. That legality is a property of the
--   constraint class, not of a line somebody must remember not to delete.
--
-- WHY THE COLUMN-LIST DELETE ACTION IS LOAD-BEARING
--   20260804093518_board_thread_board_fk_set_null.sql softened this FK from
--   CASCADE because purgeBoard is an OWNER-ONLY hard delete and other members'
--   PRIVATE docked threads hang off the board. A delete action WITHOUT the
--   column list nulls every referencing column on a COMPOSITE key — including
--   the NOT NULL org_id — so every purge of a board with docked threads would
--   fail. The PostgreSQL 15+ column list below expresses the existing intent
--   exactly: the board pointer degrades, the org attribution survives. DEV runs
--   PostgreSQL 17.6 / server_version_num 170006 (verified 2026-08-04).
--
-- LIVE-DATA SAFETY
--   The production deployment runs this database. Audited 2026-08-04 both at
--   spec time and again immediately before this file was written: 12
--   conversations, 8 boardless, 4 docked, 0 orphaned board refs, 0 drifted
--   rows. No remediation statement ships here — there is nothing to repair, and
--   a no-op UPDATE against a live table is not free. The constraint is
--   therefore added VALIDATED in one step.

-- boards.id is already unique (PK); this makes the PAIR addressable by an FK.
alter table public.boards
  add constraint boards_id_org_key unique (id, org_id);

-- Replace, do not add alongside: the composite FK strictly subsumes the
-- single-column one (org_id is NOT NULL, so MATCH SIMPLE never short-circuits
-- on it), and two FKs to the same table would make PostgREST embeds ambiguous.
alter table public.ai_conversations
  drop constraint ai_conversations_board_id_fkey;

alter table public.ai_conversations
  add constraint ai_conversations_board_org_fkey
    foreign key (board_id, org_id)
    references public.boards (id, org_id)
    on delete set null (board_id);
