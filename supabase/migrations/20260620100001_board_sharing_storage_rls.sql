-- Board-level sharing — close the cross-tenant STORAGE hole.
--
-- Security-review finding: 20260620100000_board_level_sharing.sql locked the
-- public.attachments TABLE to can_read_board, but the attachment FILE BYTES live
-- in the private `attachments` storage bucket, gated by SEPARATE storage.objects
-- policies (from 20260617110000_attachments.sql) that still authorize against the
-- ORG-id path segment only. So any org member — even one with NO grant on a
-- private board — could still list/download a private board's files via the
-- Storage API. This migration rewrites the three storage.objects attachment
-- policies to be BOARD-scoped, mirroring how the table-level policies were
-- rewritten, and drops the org-admin bypass on delete (spec: boards are private
-- even from org admins).
--
-- Object path: <org_id>/<board_id>/<item_id>/<uuid>-<name>
--   (storage.foldername(name))[1] = org_id, [2] = board_id.
-- A malformed path with no [2] segment yields NULL → can_read_board(NULL) =
-- false (safe deny). No permissive fallbacks.
--
-- Spec: docs/superpowers/specs/2026-06-20-board-level-sharing-design.md

drop policy attachments_obj_select on storage.objects;
drop policy attachments_obj_insert on storage.objects;
drop policy attachments_obj_delete on storage.objects;

-- read: anyone who can read the board the file belongs to
create policy attachments_obj_select on storage.objects
  for select to authenticated using (
    bucket_id = 'attachments'
    and public.can_read_board(((storage.foldername(name))[2])::uuid)
  );

-- insert: anyone who can edit the board (mirrors table-level attachments_insert,
-- which dropped the per-uploader self-check at table level; the original storage
-- insert policy did NOT enforce object ownership, so we keep it board-scoped only)
create policy attachments_obj_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'attachments'
    and public.can_edit_board(((storage.foldername(name))[2])::uuid)
  );

-- delete: the uploader (storage.objects.owner) or a board editor. The org-admin
-- bypass branch is intentionally REMOVED (private even from admins), mirroring the
-- table-level attachments_delete = uploaded_by = auth.uid() OR can_edit_board.
create policy attachments_obj_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'attachments'
    and (owner = (select auth.uid())
         or public.can_edit_board(((storage.foldername(name))[2])::uuid))
  );
