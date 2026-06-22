-- Structure-only duplication for boards and dashboards.
-- Boards: copies groups + columns + views, NOT items/cell_values.
-- Dashboards: copies all widgets (config + layout).
-- Both are security-definer + org-scoped: the caller must be a member of the
-- source's organization (mirrors public.create_board).

create or replace function public.duplicate_board_structure(p_board_id uuid)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_src public.boards;
  v_new public.boards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_src from public.boards where id = p_board_id;
  if v_src.id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_src.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.boards
    (org_id, workspace_id, name, position, created_by, name_column_width)
  values
    (v_src.org_id, v_src.workspace_id,
     left(v_src.name || ' (copy)', 100),
     v_src.position, v_uid, v_src.name_column_width)
  returning * into v_new;

  insert into public.groups (org_id, board_id, name, color, position)
  select v_src.org_id, v_new.id, name, color, position
  from public.groups where board_id = p_board_id;

  insert into public.columns (org_id, board_id, kind, name, settings, position, width)
  select v_src.org_id, v_new.id, kind, name, settings, position, width
  from public.columns where board_id = p_board_id;

  insert into public.board_views (org_id, board_id, kind, name, config, position)
  select v_src.org_id, v_new.id, kind, name, config, position
  from public.board_views where board_id = p_board_id;

  return v_new;
end;
$$;

grant execute on function public.duplicate_board_structure(uuid) to authenticated;

create or replace function public.duplicate_dashboard(p_dashboard_id uuid)
returns public.dashboards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_src public.dashboards;
  v_new public.dashboards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_src from public.dashboards where id = p_dashboard_id;
  if v_src.id is null then
    raise exception 'dashboard not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_src.org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.dashboards (org_id, workspace_id, name, created_by)
  values (v_src.org_id, v_src.workspace_id,
          left(v_src.name || ' (copy)', 100), v_uid)
  returning * into v_new;

  insert into public.dashboard_widgets
    (org_id, dashboard_id, source_board_id, kind, title, config, layout, position)
  select v_src.org_id, v_new.id, source_board_id, kind, title, config, layout, position
  from public.dashboard_widgets where dashboard_id = p_dashboard_id;

  return v_new;
end;
$$;

grant execute on function public.duplicate_dashboard(uuid) to authenticated;
