-- My Work in one round-trip. Fuses getMyWorkItems' four serial phases
-- (people-columns -> jsonb containment scan -> items/boards/columns batch ->
-- date+status cells batch) into one statement, cutting 4+ sequential
-- round-trips to 1 per visit. Identity comes from auth.uid() INSIDE the
-- function -- never a parameter -- so a caller cannot read another user's
-- assignments.
--
-- SECURITY INVOKER (stated explicitly, matching search_items): every table
-- touched (columns, cell_values, items, boards, groups) is filtered by the
-- CALLER's RLS policies, so the candidate set is inherently the caller's
-- readable boards -- the function adds no privilege.
--
-- Status option resolution stays in TypeScript behind the Zod optionSchema
-- boundary; this returns the first status column's raw settings jsonb per row.
-- "First" date/status column per board = lowest position, matching the previous
-- Map-building loops. Caps mirror the TS constants (MY_WORK_COLUMN_LIMIT=2000,
-- MY_WORK_ITEM_LIMIT=500).

create or replace function public.get_my_work_items(p_limit int default 500)
returns table (
  item_id uuid, item_name text, board_id uuid, board_name text,
  group_name text, due_date text, status_option_id text, status_settings jsonb
)
language sql
security invoker
stable
set search_path = ''
as $func$
  with people_cols as (
    select c.id from public.columns c where c.kind = 'people' limit 2000
  ),
  assigned as (
    select distinct cv.item_id, cv.board_id
    from public.cell_values cv
    where cv.column_id in (select pc.id from people_cols pc)
      and cv.value @> jsonb_build_object(
        'userIds', jsonb_build_array((select auth.uid())::text)
      )
    limit least(greatest(coalesce(p_limit, 500), 1), 500)
  ),
  first_date_col as (
    select distinct on (c.board_id) c.board_id, c.id
    from public.columns c
    where c.kind = 'date' and c.board_id in (select a.board_id from assigned a)
    order by c.board_id, c.position asc
  ),
  first_status_col as (
    select distinct on (c.board_id) c.board_id, c.id, c.settings
    from public.columns c
    where c.kind = 'status' and c.board_id in (select a.board_id from assigned a)
    order by c.board_id, c.position asc
  )
  select
    i.id as item_id,
    i.name as item_name,
    i.board_id,
    b.name as board_name,
    g.name as group_name,
    nullif(dcv.value ->> 'date', '') as due_date,
    nullif(scv.value ->> 'optionId', '') as status_option_id,
    fsc.settings as status_settings
  from assigned a
  join public.items i on i.id = a.item_id and i.archived_at is null
  left join public.boards b on b.id = i.board_id and b.archived_at is null
  left join public.groups g on g.id = i.group_id
  left join first_date_col fdc on fdc.board_id = i.board_id
  left join public.cell_values dcv on dcv.item_id = i.id and dcv.column_id = fdc.id
  left join first_status_col fsc on fsc.board_id = i.board_id
  left join public.cell_values scv on scv.item_id = i.id and scv.column_id = fsc.id
  order by i.id
$func$;

revoke execute on function public.get_my_work_items(int) from public;
grant execute on function public.get_my_work_items(int) to authenticated, service_role;
