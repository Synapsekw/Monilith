-- create_board_from_template: atomically create a board + Main Table view and
-- bulk-insert a fully-resolved template payload (groups/columns/items/cells).
-- The caller (createBoardFromTemplate server action) mints all uuids and shapes
-- cell values; this function only enforces membership, derives org_id, and
-- inserts. Mirrors create_board's auth/membership guards.
create or replace function public.create_board_from_template(
  p_workspace_id uuid,
  p_name text,
  p_template jsonb
) returns public.boards
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_board  public.boards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id into v_org_id from public.workspaces where id = p_workspace_id;
  if v_org_id is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.boards (org_id, workspace_id, name, position, created_by)
  values (v_org_id, p_workspace_id, p_name, 0, v_uid)
  returning * into v_board;

  insert into public.groups (id, org_id, board_id, name, color, position)
  select (g->>'id')::uuid, v_org_id, v_board.id, g->>'name', g->>'color',
         (g->>'position')::double precision
  from jsonb_array_elements(coalesce(p_template->'groups', '[]'::jsonb)) as g;

  insert into public.columns (id, org_id, board_id, kind, name, settings, position)
  select (c->>'id')::uuid, v_org_id, v_board.id, (c->>'kind')::public.column_kind,
         c->>'name', coalesce(c->'settings', '{}'::jsonb),
         (c->>'position')::double precision
  from jsonb_array_elements(coalesce(p_template->'columns', '[]'::jsonb)) as c;

  insert into public.items (id, org_id, board_id, group_id, name, position)
  select (i->>'id')::uuid, v_org_id, v_board.id, (i->>'groupId')::uuid,
         i->>'name', (i->>'position')::double precision
  from jsonb_array_elements(coalesce(p_template->'items', '[]'::jsonb)) as i;

  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org_id, v_board.id, (i->>'id')::uuid, (cell->>'columnId')::uuid,
         cell->'value'
  from jsonb_array_elements(coalesce(p_template->'items', '[]'::jsonb)) as i
  cross join lateral jsonb_array_elements(coalesce(i->'cells', '[]'::jsonb)) as cell;

  insert into public.board_views (org_id, board_id, kind, name, config, position)
  values (v_org_id, v_board.id, 'table', 'Main Table', '{}'::jsonb, 0);

  return v_board;
end; $$;

grant execute on function public.create_board_from_template(uuid, text, jsonb)
  to authenticated;
