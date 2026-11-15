-- item_facts: a done list without its status column is stale (review I1).
-- boards.work_status_column_id is cleared by its FK (on delete set null) when
-- the configured status column is deleted, but work_done_option_ids is a plain
-- array that nothing clears. The previous view treated any non-null list as
-- explicit, so after the column was deleted it compared the guessed column's
-- options with the dead ids and every item on the board read as open.
-- The explicit list now applies only while the status column is still set;
-- otherwise the label guess applies, exactly as for a board with no settings
-- (spec section 6). Same columns, order and types; security_invoker kept;
-- grants unchanged (create or replace keeps them; restated for clarity).

create or replace view public.item_facts
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
      when b.work_status_column_id is not null
       and b.work_done_option_ids is not null
        then (scv.value ->> 'optionId') = any (b.work_done_option_ids)
      else so.label ~* '(done|complete)'
    end,
    false
  )             as is_done,
  dc.id         as due_column_id,
  case
    when left(coalesce(nullif(dcv.value ->> 'end', ''), dcv.value ->> 'date'), 10)
           ~ '^\d{4}-\d{2}-\d{2}$'
     and pg_input_is_valid(
           left(coalesce(nullif(dcv.value ->> 'end', ''), dcv.value ->> 'date'), 10),
           'date')
      then left(coalesce(nullif(dcv.value ->> 'end', ''), dcv.value ->> 'date'), 10)::date
  end           as due_date
from public.items i
join public.boards b
  on b.id = i.board_id and b.archived_at is null
join public.groups g
  on g.id = i.group_id and g.archived_at is null
left join lateral (
  select c.id, c.settings
  from public.columns c
  where c.board_id = b.id
    and c.kind = 'status'
    and (b.work_status_column_id is null or c.id = b.work_status_column_id)
  order by c.position asc, c.id asc
  limit 1
) sc on true
left join lateral (
  select c.id
  from public.columns c
  where c.board_id = b.id
    and c.kind = 'date'
    and (b.work_due_column_id is null or c.id = b.work_due_column_id)
  order by c.position asc, c.id asc
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
