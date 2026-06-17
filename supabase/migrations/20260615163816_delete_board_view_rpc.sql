-- Enforce the "a board keeps >=1 view" invariant transactionally. Locks the
-- board's view rows (FOR UPDATE) so concurrent deletes serialize and a board
-- can never reach zero views. Mirrors create_board_view (SECURITY DEFINER).
create or replace function public.delete_board_view(p_view_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_board_id uuid;
  v_org_id   uuid;
  v_count    int;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select board_id, org_id into v_board_id, v_org_id
  from public.board_views where id = p_view_id;
  if v_board_id is null then
    raise exception 'view not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  -- Lock all of this board's view rows so two concurrent deletes can't both
  -- observe count > 1 and delete the last two.
  select count(*) into v_count
  from public.board_views where board_id = v_board_id for update;
  if v_count <= 1 then
    raise exception 'a board must keep at least one view' using errcode = 'P0001';
  end if;
  delete from public.board_views where id = p_view_id;
end; $$;

grant execute on function public.delete_board_view(uuid) to authenticated;
