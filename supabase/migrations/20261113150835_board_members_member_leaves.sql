-- 20261113150835_board_members_member_leaves.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Lets a board member LEAVE a board shared with them: delete their own
--   board_members grant. Until now only the board owner could delete grants
--   ("board_members: owner deletes"), so a member had no way to drop a board
--   from their "Shared with me" list.
--
--   The new policy is permissive and OR-combines with the owner policy. It
--   matches only the row whose user_id is the caller, so a member can never
--   remove anyone else's access, and it changes nothing about the board, its
--   content or other members. The owner path is unchanged.

create policy "board_members: member leaves" on public.board_members
  for delete to authenticated
  using (user_id = (select auth.uid()));
