-- Security hardening: dashboard read RPCs must honor board-level sharing.
--
-- All five dashboard aggregation RPCs are SECURITY DEFINER and guarded only by
-- is_org_member(org_id) — written before 20260620100000_board_level_sharing
-- introduced per-board visibility (or copied from that pattern). Any org member
-- could therefore aggregate/read rows of a PRIVATE board they hold no
-- board_members grant on (dashboard_list_rows even returns raw item names).
-- Reference implementations that already gate on can_read_board:
-- portfolio_rollup, goals_rollup, workload_rollup, duplicate_board_structure,
-- import_rows_into_board.
--
-- Each function below is its LATEST committed definition copied verbatim
-- (source noted per function), gaining exactly one guard after the
-- is_org_member check:
--   if not public.can_read_board(p_board_id) then
--     raise exception 'not authorized' using errcode = '42501';
--   end if;
-- can_read_board (latest: 20260621000000) = active org member AND (board
-- creator OR board_members grant) — the same predicate every board-scoped
-- table's SELECT policy enforces.

-- ── dashboard_aggregate ──────────────────────────────────────────────────────
-- Body from 20260617130000_dashboards.sql + the can_read_board guard.
create or replace function public.dashboard_aggregate(
  p_board_id        uuid,
  p_group_column_id uuid  default null,
  p_value_column_id uuid  default null,
  p_agg             text  default 'count'
) returns table (group_key text, metric numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not public.can_read_board(p_board_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_agg not in ('count', 'sum', 'avg') then
    raise exception 'invalid agg %', p_agg using errcode = '22023';
  end if;

  return query
  with rows as (
    select
      (gcv.value ->> 'optionId') as gkey,
      (vcv.value ->> 'n')::numeric as nval
    from public.items i
    left join public.cell_values gcv
      on gcv.item_id = i.id and gcv.column_id = p_group_column_id
    left join public.cell_values vcv
      on vcv.item_id = i.id and vcv.column_id = p_value_column_id
    where i.board_id = p_board_id
  )
  select
    (case when p_group_column_id is null then null else gkey end) as group_key,
    (case p_agg
       when 'count' then count(*)::numeric
       when 'sum'   then coalesce(sum(nval), 0)
       when 'avg'   then coalesce(avg(nval), 0)
     end) as metric
  from rows
  group by (case when p_group_column_id is null then null else gkey end);
end; $$;

revoke execute on function public.dashboard_aggregate(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.dashboard_aggregate(uuid, uuid, uuid, text)
  to authenticated;

-- ── dashboard_list_rows ──────────────────────────────────────────────────────
-- Body from 20260618120000_dashboard_list_rows.sql + the can_read_board guard.
-- (The _dashboard_list_predicate helper's latest version lives in
-- 20260703100000_dashboard_list_currency_amount.sql and is unchanged here.)
create or replace function public.dashboard_list_rows(
  p_board_id uuid,
  p_filter   jsonb default '{}'::jsonb,
  p_limit    int   default 25
) returns table (item_id uuid, name text, created_at timestamptz)
language plpgsql
security definer
set search_path = '' as $$
declare
  v_org_id     uuid;
  v_combinator text;
  v_cond       jsonb;
  v_pred       text;
  v_preds      text[] := '{}';
  v_where      text;
  v_limit      int := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not public.can_read_board(p_board_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_combinator := lower(coalesce(p_filter->>'combinator', 'and'));
  if v_combinator not in ('and', 'or') then
    v_combinator := 'and';
  end if;

  for v_cond in
    select value
    from jsonb_array_elements(coalesce(p_filter->'conditions', '[]'::jsonb))
  loop
    v_pred := public._dashboard_list_predicate(
      (v_cond->>'columnId')::uuid,
      v_cond->>'operator',
      v_cond->>'value'
    );
    if v_pred is not null then
      v_preds := array_append(v_preds, v_pred);
    end if;
  end loop;

  if array_length(v_preds, 1) is null then
    v_where := 'true';
  else
    v_where := array_to_string(v_preds, ' ' || v_combinator || ' ');
  end if;

  return query execute format(
    'select i.id, i.name, i.created_at from public.items i '
    || 'where i.board_id = %L and (%s) '
    || 'order by i.created_at desc limit %L',
    p_board_id, v_where, v_limit
  );
end; $$;

revoke execute on function public.dashboard_list_rows(uuid, jsonb, int)
  from public, anon;
grant execute on function public.dashboard_list_rows(uuid, jsonb, int)
  to authenticated;

-- ── dashboard_series ─────────────────────────────────────────────────────────
-- Body from 20260623130255_dashboard_series.sql + the can_read_board guard.
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
  if not public.can_read_board(p_board_id) then
    raise exception 'not authorized' using errcode = '42501';
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

revoke execute on function public.dashboard_series(uuid, jsonb, jsonb, jsonb, int)
  from public, anon;
grant execute on function public.dashboard_series(uuid, jsonb, jsonb, jsonb, int)
  to authenticated;

-- ── dashboard_completion ─────────────────────────────────────────────────────
-- Body from 20260703093000_dashboard_completion.sql + the can_read_board guard.
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
  if not public.can_read_board(p_board_id) then
    raise exception 'not authorized' using errcode = '42501';
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

revoke execute on function public.dashboard_completion(uuid, text, uuid, jsonb)
  from public, anon;
grant execute on function public.dashboard_completion(uuid, text, uuid, jsonb)
  to authenticated;

-- ── dashboard_health_summary ─────────────────────────────────────────────────
-- Body from 20260703120000_health_summary.sql + the can_read_board guard.
-- (_board_health_flags/_board_health_counts stay internal and unchanged; they
-- are only reachable through this now-guarded entrypoint or the service role.)
create or replace function public.dashboard_health_summary(p_board_id uuid)
returns table (
  total_items integer,
  done_items integer,
  overdue_items integer,
  incomplete_items integer,
  new_items integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not public.can_read_board(p_board_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select * from public._board_health_counts(p_board_id, now() - interval '7 days');
end; $$;

revoke execute on function public.dashboard_health_summary(uuid)
  from public, anon;
grant execute on function public.dashboard_health_summary(uuid)
  to authenticated;
