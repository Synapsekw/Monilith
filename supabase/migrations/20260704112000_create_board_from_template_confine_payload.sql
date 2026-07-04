-- Security hardening (finding #5): confine create_board_from_template's
-- client-supplied payload ids to the board it just created.
--
-- The RPC is SECURITY DEFINER (bypasses RLS) and inserts a fully-resolved,
-- client-authored template: groups, columns, items (with group_id from the
-- payload), and cell_values (with column_id from the payload). org_id/board_id
-- are derived server-side, but item.groupId and cell.columnId were inserted
-- unconfined — a crafted payload could point an item at a group, or a cell at a
-- column, that belongs to ANOTHER board/org (a cross-org FK write; the referenced
-- row exists, so the FK is satisfied). Retrofit the same payload-confinement
-- guards import_rows_into_board uses (20260703110000:83-95,149-170): after the
-- groups + columns for THIS board are inserted, reject any item whose group or
-- any cell whose column is not one of them (i.e. not on v_board.id).
--
-- CREATE OR REPLACE only. Body copied verbatim from the latest definition
-- (20260618130000_create_board_from_template.sql) with two existence guards
-- added between the columns insert and the items insert; everything else is
-- unchanged.
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

  -- Guard: every item's group must belong to the board just created. Definer
  -- mode bypasses the RLS insert policies that would otherwise confine the
  -- client-supplied group_id (finding #5).
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_template->'items', '[]'::jsonb)) as i
    where not exists (
      select 1 from public.groups g
      where g.id = (i->>'groupId')::uuid and g.board_id = v_board.id
    )
  ) then
    raise exception 'item group not on board' using errcode = '22023';
  end if;

  -- Guard: every cell must reference a column of the board just created.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_template->'items', '[]'::jsonb)) as i
    cross join lateral jsonb_array_elements(coalesce(i->'cells', '[]'::jsonb)) as cell
    where not exists (
      select 1 from public.columns c
      where c.id = (cell->>'columnId')::uuid and c.board_id = v_board.id
    )
  ) then
    raise exception 'cell column not on board' using errcode = '22023';
  end if;

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

revoke execute on function public.create_board_from_template(uuid, text, jsonb)
  from public, anon;
grant execute on function public.create_board_from_template(uuid, text, jsonb)
  to authenticated;
