-- Fix: remove unused v_group variable from create_board to clear PL/pgSQL lint warning.
create or replace function public.create_board(p_workspace_id uuid, p_name text)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_board  public.boards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Derive org_id from the workspace and enforce membership.
  select org_id into v_org_id
  from public.workspaces
  where id = p_workspace_id;

  if v_org_id is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.boards (org_id, workspace_id, name, position, created_by)
  values (v_org_id, p_workspace_id, p_name, 0, v_uid)
  returning * into v_board;

  insert into public.groups (org_id, board_id, name, color, position)
  values (v_org_id, v_board.id, 'Group 1', '#0073ea', 0);

  insert into public.columns (org_id, board_id, kind, name, settings, position)
  values
    (v_org_id, v_board.id, 'status', 'Status', '{"options": []}'::jsonb, 0),
    (v_org_id, v_board.id, 'people', 'Owner',  '{}'::jsonb,              1),
    (v_org_id, v_board.id, 'date',   'Date',   '{}'::jsonb,              2);

  return v_board;
end;
$$;
