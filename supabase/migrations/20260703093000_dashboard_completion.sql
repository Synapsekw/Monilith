-- Completion widget (MVP Final item 7): % completion per board group (workstream).
-- percent mode: avg of a percent column (empty cell = 0, clamped 0..100).
-- status mode: share of items whose status optionId is in the "done" set.
-- Top-level items only (parent_id is null) — parents are the canonical activity
-- state; counting subitems too would double-weight (see design spec).
-- NOTE: the added enum value must NOT be used later in this same migration
-- (PG allows ADD VALUE in a transaction only if unused within it) — it isn't.

alter type public.widget_kind add value if not exists 'completion';

create or replace function public.dashboard_completion(
  p_board_id        uuid,
  p_mode            text,               -- 'percent' | 'status'
  p_value_column_id uuid,               -- percent column OR status column, per mode
  p_done_option_ids jsonb default '[]'::jsonb
) returns table (group_key uuid, item_count integer, completion numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
  v_done   text[];
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if p_mode not in ('percent', 'status') then
    raise exception 'invalid mode %', p_mode using errcode = '22023';
  end if;

  if p_mode = 'percent' then
    return query
    select i.group_id,
           count(*)::int,
           round(avg(least(greatest(
             coalesce((cv.value ->> 'percent')::numeric, 0), 0), 100)), 1)
    from public.items i
    left join public.cell_values cv
      on cv.item_id = i.id and cv.column_id = p_value_column_id
    where i.board_id = p_board_id and i.parent_id is null
    group by i.group_id;
  else
    v_done := array(select jsonb_array_elements_text(p_done_option_ids));
    return query
    select i.group_id,
           count(*)::int,
           round(100.0 * count(*) filter (
             where (cv.value ->> 'optionId') = any (v_done)) / count(*), 1)
    from public.items i
    left join public.cell_values cv
      on cv.item_id = i.id and cv.column_id = p_value_column_id
    where i.board_id = p_board_id and i.parent_id is null
    group by i.group_id;
  end if;
end; $$;

grant execute on function public.dashboard_completion(uuid, text, uuid, jsonb)
  to authenticated;

-- Access paths: items_board_id_idx (board filter), items_parent_id_idx
-- (top-level predicate), cell_values (item_id, column_id) — same as
-- dashboard_aggregate / dashboard_series. Output rows = #groups on the board.
