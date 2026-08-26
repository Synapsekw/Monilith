-- 20260826123843_board_folder_boards_folder_ownership.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Closes the folder-existence oracle left open by
--   20260826102555_sidebar_board_folders: the insert/update WITH CHECK on
--   board_folder_boards gated user_id and can_read_board(board_id) but said
--   NOTHING about folder_id. So user B could file THEIR OWN board into user A's
--   folder id and it succeeded (measured live on DEV, in a rolled-back
--   transaction).
--
--   The blast radius was bounded — the row is keyed to the attacker's own
--   user_id, is invisible to the folder's owner, and groupBoardsByFolder drops
--   placements whose folder is not in the caller's folder list — so there was no
--   disclosure and no cross-user write. What it WAS is an existence oracle for
--   folder ids: a probe distinguishes "this uuid is a real folder" (insert
--   succeeds) from "it is not" (FK violation). That is exactly the class of leak
--   the original migration deliberately closed for board_id, so leaving it open
--   for folder_id made the gate asymmetric with its own stated design.
--
--   Fix: the target folder must also be YOURS. Policies are dropped and
--   recreated rather than ALTERed so the complete final predicate reads in one
--   place. `folder_id` / `board_id` are unqualified (house style, matching the
--   original) and unambiguous: public.board_folders has neither column.

drop policy "board_folder_boards: insert own" on public.board_folder_boards;
create policy "board_folder_boards: insert own" on public.board_folder_boards
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_read_board(board_id)
    and exists (
      select 1 from public.board_folders f
      where f.id = folder_id
        and f.user_id = (select auth.uid())
    )
  );

drop policy "board_folder_boards: update own" on public.board_folder_boards;
create policy "board_folder_boards: update own" on public.board_folder_boards
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.can_read_board(board_id)
    and exists (
      select 1 from public.board_folders f
      where f.id = folder_id
        and f.user_id = (select auth.uid())
    )
  );
