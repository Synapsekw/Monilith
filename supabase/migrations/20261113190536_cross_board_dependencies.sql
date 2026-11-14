-- Cross-board item dependencies + folder Timeline RPCs.
-- Spec: docs/superpowers/specs/2026-11-13-cross-board-dependencies-folder-timeline-design.md
-- board_id now means the SUCCESSOR's board; predecessor_board_id is the predecessor's board.
-- Backfill derives both columns from the items, so any pre-existing row whose board_id did not
-- match its successor's board is repaired (DEV had 0 rows at authoring time; check PROD on sync).
-- A trigger binds org_id / board_id / predecessor_board_id to the real items on every write, so a
-- direct table insert can never point a link at a board or org the columns do not describe.

alter table public.item_dependencies
  add column predecessor_board_id uuid references public.boards (id) on delete cascade;

update public.item_dependencies d
   set predecessor_board_id = i.board_id
  from public.items i
 where i.id = d.predecessor_id;

update public.item_dependencies d
   set board_id = i.board_id
  from public.items i
 where i.id = d.successor_id
   and d.board_id <> i.board_id;

alter table public.item_dependencies
  alter column predecessor_board_id set not null;

create index item_dependencies_predecessor_board_id_idx
  on public.item_dependencies (predecessor_board_id);

-- Bind the denormalized board/org columns to the real items (never trust caller-supplied values).
create or replace function public._item_dependencies_bind_boards()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_succ_board uuid;
  v_succ_org   uuid;
  v_pred_board uuid;
  v_pred_org   uuid;
begin
  select board_id, org_id into v_succ_board, v_succ_org
  from public.items where id = new.successor_id;
  select board_id, org_id into v_pred_board, v_pred_org
  from public.items where id = new.predecessor_id;
  if v_succ_board is null or v_pred_board is null or v_pred_org <> v_succ_org then
    raise exception 'dependency items not found' using errcode = 'P0002';
  end if;
  new.org_id               := v_succ_org;
  new.board_id             := v_succ_board;
  new.predecessor_board_id := v_pred_board;
  return new;
end; $$;
revoke execute on function public._item_dependencies_bind_boards() from public, anon, authenticated;

create trigger item_dependencies_bind_boards
  before insert or update on public.item_dependencies
  for each row execute function public._item_dependencies_bind_boards();

-- RLS: visible only when both boards are readable; delete from either editable side.
drop policy "item_dependencies: read if can read" on public.item_dependencies;
create policy "item_dependencies: read if can read" on public.item_dependencies
  for select to authenticated
  using (
    board_id in (select public.readable_board_ids())
    and predecessor_board_id in (select public.readable_board_ids())
  );

drop policy "item_dependencies: insert if can edit" on public.item_dependencies;
create policy "item_dependencies: insert if can edit" on public.item_dependencies
  for insert to authenticated with check (
    public.is_org_member(org_id)
    and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
    and predecessor_board_id in (select public.readable_board_ids())
    and public.board_in_org(predecessor_board_id, org_id)
  );

drop policy "item_dependencies: delete if can edit" on public.item_dependencies;
create policy "item_dependencies: delete if can edit" on public.item_dependencies
  for delete to authenticated
  using (public.can_edit_board(board_id) or public.can_edit_board(predecessor_board_id));

-- RPC: cross-board allowed within one org.
create or replace function public.create_item_dependency(
  p_predecessor uuid, p_successor uuid
) returns public.item_dependencies
language plpgsql security definer set search_path = '' as $$
declare
  v_uid         uuid := (select auth.uid());
  v_pred_board  uuid;
  v_pred_org    uuid;
  v_succ_board  uuid;
  v_succ_org    uuid;
  v_row         public.item_dependencies;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_predecessor = p_successor then
    raise exception 'an item cannot depend on itself' using errcode = 'P0001';
  end if;

  select board_id, org_id into v_succ_board, v_succ_org
  from public.items where id = p_successor and archived_at is null;
  -- One error for missing / other-org / unreadable, so the call is not an existence oracle.
  if v_succ_board is null or not public.is_org_member(v_succ_org)
     or not public.can_read_board(v_succ_board) then
    raise exception 'successor not found' using errcode = 'P0002';
  end if;
  if not public.can_edit_board(v_succ_board) then
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;

  select board_id, org_id into v_pred_board, v_pred_org
  from public.items where id = p_predecessor and archived_at is null;
  if v_pred_board is null or v_pred_org <> v_succ_org
     or not public.can_read_board(v_pred_board) then
    raise exception 'predecessor not found' using errcode = 'P0002';
  end if;

  -- Serialize link creation per org so two opposite concurrent inserts cannot both pass the
  -- cycle check.
  perform pg_advisory_xact_lock(hashtextextended('item_dependencies:' || v_succ_org::text, 0));

  if exists (
    with recursive reach (node) as (
      select successor_id from public.item_dependencies where predecessor_id = p_successor
      union
      select d.successor_id
      from public.item_dependencies d
      join reach r on d.predecessor_id = r.node
    )
    select 1 from reach where node = p_predecessor
  ) then
    raise exception 'this would create a dependency cycle' using errcode = 'P0001';
  end if;

  insert into public.item_dependencies
    (org_id, board_id, predecessor_board_id, predecessor_id, successor_id, type)
  values (v_succ_org, v_succ_board, v_pred_board, p_predecessor, p_successor, 'FS')
  returning * into v_row;
  return v_row;
end; $$;
revoke execute on function public.create_item_dependency(uuid, uuid) from public, anon;
grant execute on function public.create_item_dependency(uuid, uuid) to authenticated;

-- Private JSON builders. Callers pre-filter ids; the builders also drop anything on a board the
-- caller cannot read (defense in depth) and anything archived.
create or replace function public._timeline_boards_json(p_board_ids uuid[])
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'can_edit', public.can_edit_board(b.id),
    'date_columns', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.position, c.id)
      from public.columns c where c.board_id = b.id and c.kind = 'date'), '[]'::jsonb),
    'timeline_config', (
      select v.config from public.board_views v
      where v.board_id = b.id and v.kind = 'timeline'
      order by v.position, v.id limit 1),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color, 'position', g.position)
                       order by g.position, g.id)
      from public.groups g where g.board_id = b.id and g.archived_at is null), '[]'::jsonb)
  ) order by b.id), '[]'::jsonb)
  from public.boards b
  where b.id = any(p_board_ids) and b.archived_at is null
    and b.id in (select public.readable_board_ids())
$$;
revoke execute on function public._timeline_boards_json(uuid[]) from public, anon, authenticated;

create or replace function public._timeline_items_json(p_item_ids uuid[])
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'board_id', i.board_id,
    'group_id', i.group_id,
    'parent_id', i.parent_id,
    'name', i.name,
    'position', i.position,
    'created_at', i.created_at,
    'updated_at', i.updated_at,
    'dates', coalesce((
      select jsonb_object_agg(cv.column_id, cv.value)
      from public.cell_values cv
      join public.columns c on c.id = cv.column_id and c.kind = 'date'
      where cv.item_id = i.id), '{}'::jsonb)
  ) order by i.board_id, i.position, i.id), '[]'::jsonb)
  from public.items i
  join public.boards b on b.id = i.board_id and b.archived_at is null
  join public.groups g on g.id = i.group_id and g.archived_at is null
  where i.id = any(p_item_ids) and i.archived_at is null
    and i.board_id in (select public.readable_board_ids())
$$;
revoke execute on function public._timeline_items_json(uuid[]) from public, anon, authenticated;

-- Folder Timeline: every readable board in the folder, capped items, links touching them
-- (both ends readable), plus the out-of-folder (or over-cap) ends as external items.
create or replace function public.folder_timeline(p_folder_id uuid, p_limit integer default 5000)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit          integer := least(greatest(coalesce(p_limit, 5000), 1), 5000);
  v_board_order    uuid[];
  v_item_ids       uuid[];
  v_total          integer;
  v_deps           jsonb;
  v_ext_item_ids   uuid[];
  v_ext_board_ids  uuid[];
begin
  perform public._assert_folder_member(p_folder_id);

  select coalesce(array_agg(b.id order by fbd.position, b.name, b.id), '{}')
    into v_board_order
  from public.folder_boards fbd
  join public.boards b on b.id = fbd.board_id
  where fbd.folder_id = p_folder_id
    and b.id in (select public._folder_readable_boards(p_folder_id));

  select count(*) into v_total
  from public.items i
  join public.groups g on g.id = i.group_id and g.archived_at is null
  where i.board_id = any(v_board_order) and i.archived_at is null;

  select coalesce(array_agg(x.id), '{}') into v_item_ids
  from (
    select i.id
    from public.items i
    join public.groups g on g.id = i.group_id and g.archived_at is null
    where i.board_id = any(v_board_order) and i.archived_at is null
    order by array_position(v_board_order, i.board_id), g.position, i.position, i.id
    limit v_limit
  ) x;

  -- Links touching the loaded items whose BOTH ends are live (item, group and board not
  -- archived) and readable; the external ids are derived only from those surviving rows.
  with live as (
    select d.id, d.predecessor_id, d.successor_id
    from public.item_dependencies d
    join public.items  pi on pi.id = d.predecessor_id and pi.archived_at is null
    join public.groups pg on pg.id = pi.group_id      and pg.archived_at is null
    join public.boards pb on pb.id = pi.board_id      and pb.archived_at is null
    join public.items  si on si.id = d.successor_id   and si.archived_at is null
    join public.groups sg on sg.id = si.group_id      and sg.archived_at is null
    join public.boards sb on sb.id = si.board_id      and sb.archived_at is null
    where (d.predecessor_id = any(v_item_ids) or d.successor_id = any(v_item_ids))
      and pi.board_id in (select public.readable_board_ids())
      and si.board_id in (select public.readable_board_ids())
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'predecessor_id', l.predecessor_id, 'successor_id', l.successor_id)
           order by l.id), '[]'::jsonb),
         coalesce(array_agg(distinct case when l.predecessor_id = any(v_item_ids)
                                          then l.successor_id else l.predecessor_id end)
                  filter (where not (l.predecessor_id = any(v_item_ids) and l.successor_id = any(v_item_ids))),
                  '{}')
    into v_deps, v_ext_item_ids
  from live l;

  select coalesce(array_agg(distinct i.board_id), '{}') into v_ext_board_ids
  from public.items i
  where i.id = any(v_ext_item_ids);

  return jsonb_build_object(
    'board_order',       to_jsonb(v_board_order),
    'boards',            public._timeline_boards_json(v_board_order || v_ext_board_ids),
    'items',             public._timeline_items_json(v_item_ids || v_ext_item_ids),
    'external_item_ids', to_jsonb(v_ext_item_ids),
    'dependencies',      v_deps,
    'total_items',       v_total,
    'truncated',         v_total > v_limit
  );
end; $$;
revoke execute on function public.folder_timeline(uuid, integer) from public, anon;
grant execute on function public.folder_timeline(uuid, integer) to authenticated;

-- Board context: the foreign ends of this board's cross-board links (both ends readable).
create or replace function public.board_dependency_context(p_board_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ext_item_ids  uuid[];
  v_ext_board_ids uuid[];
begin
  if not public.can_read_board(p_board_id) then
    raise exception 'board not found' using errcode = 'P0002';
  end if;

  -- Foreign ends of this board's cross-board links; both ends must be live and readable.
  select coalesce(array_agg(distinct case when si.board_id = p_board_id
                                          then pi.id else si.id end), '{}')
    into v_ext_item_ids
  from public.item_dependencies d
  join public.items  pi on pi.id = d.predecessor_id and pi.archived_at is null
  join public.groups pg on pg.id = pi.group_id      and pg.archived_at is null
  join public.boards pb on pb.id = pi.board_id      and pb.archived_at is null
  join public.items  si on si.id = d.successor_id   and si.archived_at is null
  join public.groups sg on sg.id = si.group_id      and sg.archived_at is null
  join public.boards sb on sb.id = si.board_id      and sb.archived_at is null
  where (d.board_id = p_board_id or d.predecessor_board_id = p_board_id)
    and pi.board_id <> si.board_id
    and pi.board_id in (select public.readable_board_ids())
    and si.board_id in (select public.readable_board_ids());

  select coalesce(array_agg(distinct i.board_id), '{}') into v_ext_board_ids
  from public.items i
  where i.id = any(v_ext_item_ids);

  return jsonb_build_object(
    'boards', public._timeline_boards_json(v_ext_board_ids),
    'items',  public._timeline_items_json(v_ext_item_ids)
  );
end; $$;
revoke execute on function public.board_dependency_context(uuid) from public, anon;
grant execute on function public.board_dependency_context(uuid) to authenticated;
