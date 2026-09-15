-- 20260915082905_shared_folders_read_gate_and_org_fk.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Closes two gaps in 20260915074830_shared_folders left open by task review:
--
--   1. `folder_boards: read if member` (and the UPDATE/DELETE `using` clauses)
--      gated on org membership alone. can_read_board is strictly NARROWER than
--      org membership (boards are private-by-default:
--      20260620100000_board_level_sharing.sql:671-680; can_read_board defined in
--      20260621000000_board_access_require_membership_and_returning.sql:50-64),
--      so any org member could enumerate board_id/folder_id/position for boards
--      they cannot read — exactly the existence oracle the INSERT policy (via
--      folder_accepts_board) already avoids. Fix: SELECT, and the UPDATE/DELETE
--      `using` clauses, now also require can_read_board(folder_boards.board_id).
--      Policies are dropped and recreated (not ALTERed) so the complete
--      predicate reads in one place, matching house style
--      (20260826123843_board_folder_boards_folder_ownership.sql).
--
--   2. dashboards.folder_id / ai_conversations.folder_id were plain
--      single-column FKs to folders(id). FK validation bypasses RLS, so an
--      org-A member could point their dashboard/thread at an org-B folder UUID
--      (and a 23503-vs-success distinction is itself an existence oracle for
--      folder ids across orgs). Fix, following the identical house pattern in
--      20260804144223_board_thread_org_coupling.sql (ai_conversations_board_org_fkey):
--      folders gets a `unique (id, org_id)` so the pair is addressable, then
--      each single-column FK is replaced by a composite FK to
--      folders(id, org_id). The column-list `on delete set null (folder_id)`
--      is load-bearing exactly as it is there: org_id on dashboards/
--      ai_conversations is NOT NULL, and a plain `on delete set null` on a
--      composite FK nulls EVERY referencing column — including org_id — which
--      would violate that NOT NULL the moment a folder is deleted.
--
--   LIVE-DATA SAFETY: folders is brand-new in this same migration set (no
--   committed migration has shipped an INSERT into it yet), so
--   dashboards.folder_id and ai_conversations.folder_id are all-NULL on DEV —
--   there is nothing to backfill or validate against existing rows.

-- --- Fix 1: folder_boards read/update/delete must also require board access ---

drop policy "folder_boards: read if member" on public.folder_boards;
create policy "folder_boards: read if member" on public.folder_boards
  for select to authenticated
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_boards.folder_id
        and f.org_id in (select public.auth_user_orgs())
    )
    and public.can_read_board(folder_boards.board_id)
  );

drop policy "folder_boards: update if member" on public.folder_boards;
create policy "folder_boards: update if member" on public.folder_boards
  for update to authenticated
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_boards.folder_id and public.is_org_member(f.org_id)
    )
    and public.can_read_board(folder_boards.board_id)
  )
  with check (public.folder_accepts_board(folder_id, board_id));

drop policy "folder_boards: delete if member" on public.folder_boards;
create policy "folder_boards: delete if member" on public.folder_boards
  for delete to authenticated
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_boards.folder_id and public.is_org_member(f.org_id)
    )
    and public.can_read_board(folder_boards.board_id)
  );

-- --- Fix 2: dashboards.folder_id / ai_conversations.folder_id must stay in-org ---

-- folders.id is already unique (PK); this makes the PAIR addressable by an FK.
alter table public.folders
  add constraint folders_id_org_key unique (id, org_id);

alter table public.dashboards
  drop constraint dashboards_folder_id_fkey;
alter table public.dashboards
  add constraint dashboards_folder_org_fkey
    foreign key (folder_id, org_id)
    references public.folders (id, org_id)
    on delete set null (folder_id);

alter table public.ai_conversations
  drop constraint ai_conversations_folder_id_fkey;
alter table public.ai_conversations
  add constraint ai_conversations_folder_org_fkey
    foreign key (folder_id, org_id)
    references public.folders (id, org_id)
    on delete set null (folder_id);
