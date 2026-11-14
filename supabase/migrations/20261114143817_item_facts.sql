-- Shared definition of "open, done, due" for every live item (spec 4.3).

-- "Assigned to X": GIN over the userIds array of people cells.
create index cell_values_user_ids_gin_idx
  on public.cell_values
  using gin ((value -> 'userIds') jsonb_path_ops)
  where value ? 'userIds';

-- Due windows over one date column. The same-named index already exists from
-- 20260618170000_automations_5b2_schema (non-partial, same key columns, so it
-- covers this need); `if not exists` reuses it rather than dropping a live index.
create index if not exists cell_values_date_idx
  on public.cell_values (column_id, (value ->> 'date'))
  where value ? 'date';

-- Items with p_user in any people cell. Every "assigned to" filter goes
-- through this function so the index predicate is written exactly once.
create or replace function public.items_assigned_to(p_user uuid)
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $func$
  select distinct cv.item_id
  from public.cell_values cv
  where cv.value ? 'userIds'
    and (cv.value -> 'userIds') @> jsonb_build_array(p_user::text)
$func$;

revoke execute on function public.items_assigned_to(uuid) from public, anon;
grant execute on function public.items_assigned_to(uuid) to authenticated, service_role;

-- Every user id in any people cell of one item, as a jsonb array of strings.
create or replace function public.item_assignee_ids(p_item uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $func$
  select coalesce(jsonb_agg(distinct u.id), '[]'::jsonb)
  from public.cell_values cv
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(cv.value -> 'userIds') = 'array'
         then cv.value -> 'userIds' else '[]'::jsonb end
  ) as u(id)
  where cv.item_id = p_item
    and cv.value ? 'userIds'
$func$;

revoke execute on function public.item_assignee_ids(uuid) from public, anon;
grant execute on function public.item_assignee_ids(uuid) to authenticated, service_role;

create view public.item_facts
with (security_invoker = true)
as
select
  i.id          as item_id,
  i.org_id,
  i.board_id,
  i.group_id,
  i.name,
  i.updated_at,
  sc.id         as status_column_id,
  nullif(scv.value ->> 'optionId', '') as status_option_id,
  so.label      as status_label,
  so.color      as status_color,
  coalesce(
    case
      when b.work_done_option_ids is not null
        then (scv.value ->> 'optionId') = any (b.work_done_option_ids)
      else so.label ~* '(done|complete)'
    end,
    false
  )             as is_done,
  dc.id         as due_column_id,
  case
    when left(coalesce(nullif(dcv.value ->> 'end', ''), dcv.value ->> 'date'), 10)
           ~ '^\d{4}-\d{2}-\d{2}$'
      then left(coalesce(nullif(dcv.value ->> 'end', ''), dcv.value ->> 'date'), 10)::date
  end           as due_date
from public.items i
join public.boards b
  on b.id = i.board_id and b.archived_at is null
left join lateral (
  select c.id, c.settings
  from public.columns c
  where c.board_id = b.id
    and c.kind = 'status'
    and (b.work_status_column_id is null or c.id = b.work_status_column_id)
  order by c.position asc
  limit 1
) sc on true
left join lateral (
  select c.id
  from public.columns c
  where c.board_id = b.id
    and c.kind = 'date'
    and (b.work_due_column_id is null or c.id = b.work_due_column_id)
  order by c.position asc
  limit 1
) dc on true
left join public.cell_values scv
  on scv.item_id = i.id and scv.column_id = sc.id
left join public.cell_values dcv
  on dcv.item_id = i.id and dcv.column_id = dc.id
left join lateral (
  select o ->> 'label' as label, o ->> 'color' as color
  from jsonb_array_elements(
    case when jsonb_typeof(sc.settings -> 'options') = 'array'
         then sc.settings -> 'options' else '[]'::jsonb end
  ) as o
  where o ->> 'id' = scv.value ->> 'optionId'
  limit 1
) so on true
where i.archived_at is null;

revoke all on public.item_facts from public, anon;
grant select on public.item_facts to authenticated, service_role;
