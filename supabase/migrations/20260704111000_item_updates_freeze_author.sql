-- Security hardening (finding #3): make item_updates attribution + scoping
-- immutable so an editor cannot re-attribute or move another user's comment.
--
-- The board-level-sharing UPDATE policy (20260620100000:242-246) is:
--   using      (author_id = auth.uid() OR can_edit_board(board_id))
--   with check (author_id = auth.uid() OR can_edit_board(board_id))
-- WITH CHECK sees only the NEW row, never OLD, so it cannot pin author_id to
-- its prior value: any board editor satisfies the can_edit_board() disjunct
-- regardless of what author_id (or org_id/board_id/item_id) the NEW row carries.
-- A raw UPDATE could therefore rewrite author_id (re-attribute a comment to
-- someone else) or move the row to another board/item.
--
-- UI contract this must match (verified in src/):
--   * src/components/boards/item-panel/UpdatesTab.tsx exposes only "Write an
--     update" (add) and "Delete" — there is NO edit affordance rendered.
--   * src/lib/collaboration/actions.ts editUpdate() writes ONLY
--     {body, body_text, edited_at}; it never touches author_id/org_id/board_id/
--     item_id. It is imported solely by src/lib/collaboration/use-update-mutations.ts
--     and the returned `editUpdate` is never wired into any component.
-- So in the real product author_id is already immutable by construction; the
-- gap is purely the raw REST/RLS surface. Freeze it at the DB the same way
-- items freezes created_by/created_at (20260625120000
-- items_protect_creation_metadata): a BEFORE UPDATE trigger that forces the
-- identity/scoping columns back to their OLD values. Body edits (body,
-- body_text, edited_at) stay editable, preserving the author-or-editor UPDATE
-- policy for legitimate content edits while making re-attribution impossible.

create or replace function public.item_updates_protect_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.author_id := old.author_id;
  new.org_id    := old.org_id;
  new.board_id  := old.board_id;
  new.item_id   := old.item_id;
  return new;
end;
$$;

-- Trigger fires regardless of the caller's EXECUTE privilege; strip the direct
-- REST entrypoint the definer-lockdown advisor flags (matches 20260621130000).
revoke execute on function public.item_updates_protect_attribution()
  from public, anon, authenticated;

create trigger item_updates_protect_attribution
  before update on public.item_updates
  for each row execute function public.item_updates_protect_attribution();
