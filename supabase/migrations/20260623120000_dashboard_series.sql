-- Generalized series aggregation for Chart widgets: a primary axis (category
-- column OR date-bucket), an optional series split, a measure (count/sum/avg),
-- bounded to top-K categories (folding the long tail into '__other__') or the
-- last-N date buckets. Dropdown/people dimensions are array-unnested, so an item
-- with N assignees/options counts once per value (documented "workload" semantic).
-- Returns RAW keys; labels/colors are resolved server-side (getWidgetSeries),
-- mirroring how dashboard_aggregate's columnMeta is resolved in the action.

create or replace function public.dashboard_series(
  p_board_id uuid,
  p_primary  jsonb,
  p_series   jsonb default null,
  p_measure  jsonb default '{"agg":"count"}'::jsonb,
  p_limit    int   default 12
) returns table (primary_key text, series_key text, value numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id  uuid;
  v_pkind   text := p_primary ->> 'kind';
  v_pcol    uuid := nullif(p_primary ->> 'columnId', '')::uuid;
  v_bucket  text := coalesce(p_primary ->> 'bucket', 'month');
  v_skind   text := p_series ->> 'kind';
  v_scol    uuid := nullif(p_series ->> 'columnId', '')::uuid;
  v_agg     text := coalesce(p_measure ->> 'agg', 'count');
  v_vcol    uuid := nullif(p_measure ->> 'valueColumnId', '')::uuid;
  v_limit   int  := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_is_date boolean := (v_pkind = 'date');
  v_pk_expr text;
  v_sk_expr text := 'null::text';
  v_measure text;
  v_pjoin   text := '';
  v_sjoin   text := '';
  v_vjoin   text := '';
  v_sql     text;
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if v_agg not in ('count', 'sum', 'avg') then
    raise exception 'invalid agg %', v_agg using errcode = '22023';
  end if;
  if v_bucket not in ('day', 'week', 'month') then v_bucket := 'month'; end if;

  -- primary key expression + join
  if v_pkind = 'status' then
    v_pjoin := format('left join public.cell_values pcv on pcv.item_id = i.id and pcv.column_id = %L', v_pcol);
    v_pk_expr := 'pcv.value ->> ''optionId''';
  elsif v_pkind = 'dropdown' then
    v_pjoin := format('left join public.cell_values pcv on pcv.item_id = i.id and pcv.column_id = %L '
      || 'left join lateral jsonb_array_elements_text(pcv.value -> ''optionIds'') as pu(v) on true', v_pcol);
    v_pk_expr := 'pu.v';
  elsif v_pkind = 'people' then
    v_pjoin := format('left join public.cell_values pcv on pcv.item_id = i.id and pcv.column_id = %L '
      || 'left join lateral jsonb_array_elements_text(pcv.value -> ''userIds'') as pu(v) on true', v_pcol);
    v_pk_expr := 'pu.v';
  elsif v_pkind = 'date' then
    if v_pcol is null then
      v_pk_expr := format('to_char(date_trunc(%L, i.created_at), ''YYYY-MM-DD'')', v_bucket);
    else
      v_pjoin := format('left join public.cell_values pcv on pcv.item_id = i.id and pcv.column_id = %L', v_pcol);
      v_pk_expr := format('to_char(date_trunc(%L, (pcv.value ->> ''date'')::date), ''YYYY-MM-DD'')', v_bucket);
    end if;
  else
    raise exception 'invalid primary kind %', v_pkind using errcode = '22023';
  end if;

  -- optional series split (category kinds only)
  if v_skind = 'status' then
    v_sjoin := format('left join public.cell_values scv on scv.item_id = i.id and scv.column_id = %L', v_scol);
    v_sk_expr := 'scv.value ->> ''optionId''';
  elsif v_skind = 'dropdown' then
    v_sjoin := format('left join public.cell_values scv on scv.item_id = i.id and scv.column_id = %L '
      || 'left join lateral jsonb_array_elements_text(scv.value -> ''optionIds'') as su(v) on true', v_scol);
    v_sk_expr := 'su.v';
  elsif v_skind = 'people' then
    v_sjoin := format('left join public.cell_values scv on scv.item_id = i.id and scv.column_id = %L '
      || 'left join lateral jsonb_array_elements_text(scv.value -> ''userIds'') as su(v) on true', v_scol);
    v_sk_expr := 'su.v';
  end if;

  -- measure
  if v_agg = 'count' then
    v_measure := 'count(*)::numeric';
  else
    v_vjoin := format('left join public.cell_values vcv on vcv.item_id = i.id and vcv.column_id = %L', v_vcol);
    v_measure := case v_agg
      when 'sum' then 'coalesce(sum((vcv.value ->> ''n'')::numeric), 0)'
      else 'coalesce(avg((vcv.value ->> ''n'')::numeric), 0)'
    end;
  end if;

  if v_is_date then
    -- keep the most recent N buckets (ISO date strings sort lexically)
    v_sql := format(
      'with g as (select %s as pk, %s as sk, %s as val '
      || 'from public.items i %s %s %s where i.board_id = %L group by 1, 2), '
      || 'keep as (select distinct pk from g where pk is not null order by pk desc limit %s) '
      || 'select g.pk, g.sk, g.val from g where g.pk in (select pk from keep)',
      v_pk_expr, v_sk_expr, v_measure, v_pjoin, v_sjoin, v_vjoin, p_board_id, v_limit);
  else
    -- keep top-N primary keys by total; fold the rest into '__other__'
    v_sql := format(
      'with g as (select %s as pk, %s as sk, %s as val '
      || 'from public.items i %s %s %s where i.board_id = %L group by 1, 2), '
      || 'totals as (select pk, sum(val) as t from g group by pk), '
      || 'ranked as (select pk, row_number() over (order by t desc nulls last) as rn from totals), '
      || 'folded as (select case when r.rn <= %s then g.pk else ''__other__'' end as pk, g.sk, g.val '
      || 'from g join ranked r on r.pk is not distinct from g.pk) '
      || 'select pk, sk, sum(val)::numeric as val from folded group by pk, sk',
      v_pk_expr, v_sk_expr, v_measure, v_pjoin, v_sjoin, v_vjoin, p_board_id, v_limit);
  end if;

  return query execute v_sql;
end; $$;

grant execute on function public.dashboard_series(uuid, jsonb, jsonb, jsonb, int) to authenticated;

-- Date-bucketing over a date column reads (column_id, value->>'date'); that index
-- already exists (cell_values_date_idx). items(board_id) is indexed (items_board_id_idx).
-- created_at bucketing benefits from a board_id+created_at composite:
create index if not exists items_board_created_idx
  on public.items (board_id, created_at);
