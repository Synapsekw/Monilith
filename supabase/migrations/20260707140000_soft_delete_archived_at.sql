-- Soft-delete / Undo: archive instead of destroy for boards / groups / items.
--
-- archived_at null = live; non-null = archived at that instant. archived_by =
-- who archived it (audit + Trash "by"). Archived rows are filtered at the APP +
-- aggregation-RPC layer, NOT in RLS — restore/undo/Trash must still be able to
-- read them, and they are still the org's own data (visibility, not security).
-- See docs/superpowers/specs/2026-07-06-soft-delete-undo-design.md §2.3.

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.boards
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id);
alter table public.groups
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id);
alter table public.items
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id);

-- ── Partial indexes ──────────────────────────────────────────────────────────
-- Hot "live rows" reads stay index-served (parallels the all-rows hot-path index).
create index if not exists items_board_position_live_idx
  on public.items (board_id, position) where archived_at is null;
create index if not exists groups_board_live_idx
  on public.groups (board_id) where archived_at is null;
create index if not exists boards_created_by_live_idx
  on public.boards (created_by) where archived_at is null;

-- Cold Trash reads.
create index if not exists items_board_archived_idx
  on public.items (board_id) where archived_at is not null;
create index if not exists groups_board_archived_idx
  on public.groups (board_id) where archived_at is not null;

-- ── Cascade archive / restore RPCs (SECURITY INVOKER — respect RLS) ───────────
-- Archive an item + its live subitems with one shared timestamp; returns count.
create or replace function public.archive_item(p_item_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_ts timestamptz := now(); v_uid uuid := (select auth.uid()); v_n int;
begin
  update public.items set archived_at = v_ts, archived_by = v_uid
   where (id = p_item_id or parent_id = p_item_id) and archived_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

-- Restore an item: clear only the set archived in the SAME batch (matching ts).
create or replace function public.restore_item(p_item_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_ts timestamptz; v_n int;
begin
  select archived_at into v_ts from public.items where id = p_item_id;
  if v_ts is null then return 0; end if;
  update public.items set archived_at = null, archived_by = null
   where (id = p_item_id or parent_id = p_item_id) and archived_at = v_ts;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

-- Archive a group + its live items (+ their subitems) with one shared timestamp.
create or replace function public.archive_group(p_group_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_ts timestamptz := now(); v_uid uuid := (select auth.uid()); v_n int; v_g int;
begin
  update public.groups set archived_at = v_ts, archived_by = v_uid
   where id = p_group_id and archived_at is null;
  get diagnostics v_g = row_count;
  update public.items set archived_at = v_ts, archived_by = v_uid
   where group_id = p_group_id and archived_at is null;
  get diagnostics v_n = row_count;
  return v_g + v_n;
end; $$;

-- Restore a group: clear the group + only the items archived in the SAME batch.
create or replace function public.restore_group(p_group_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_ts timestamptz; v_n int;
begin
  select archived_at into v_ts from public.groups where id = p_group_id;
  if v_ts is null then return 0; end if;
  update public.groups set archived_at = null, archived_by = null where id = p_group_id;
  update public.items set archived_at = null, archived_by = null
   where group_id = p_group_id and archived_at = v_ts;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

revoke execute on function public.archive_item(uuid), public.restore_item(uuid),
  public.archive_group(uuid), public.restore_group(uuid) from public, anon;
grant execute on function public.archive_item(uuid), public.restore_item(uuid),
  public.archive_group(uuid), public.restore_group(uuid) to authenticated;

-- ── Aggregation RPCs: exclude archived items (they bypass RLS, must self-filter)
-- Each body below is the LATEST committed definition copied verbatim, gaining
-- exactly one `archived_at is null` predicate on every public.items scan.

-- dashboard_aggregate — from 20260704110000_dashboard_rpc_board_read_guards.sql
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
      and i.archived_at is null
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

-- dashboard_list_rows — from 20260704110000_dashboard_rpc_board_read_guards.sql
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
    || 'where i.board_id = %L and i.archived_at is null and (%s) '
    || 'order by i.created_at desc limit %L',
    p_board_id, v_where, v_limit
  );
end; $$;

revoke execute on function public.dashboard_list_rows(uuid, jsonb, int)
  from public, anon;
grant execute on function public.dashboard_list_rows(uuid, jsonb, int)
  to authenticated;

-- dashboard_series — from 20260704110000_dashboard_rpc_board_read_guards.sql
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
      || 'from public.items i %s %s %s where i.board_id = %L and i.archived_at is null group by 1, 2), '
      || 'keep as (select distinct pk from g where pk is not null order by pk desc limit %s) '
      || 'select g.pk, g.sk, g.val from g where g.pk in (select pk from keep)',
      v_pk_expr, v_sk_expr, v_measure, v_pjoin, v_sjoin, v_vjoin, p_board_id, v_limit);
  else
    -- keep top-N primary keys by total; fold the rest into '__other__'
    v_sql := format(
      'with g as (select %s as pk, %s as sk, %s as val '
      || 'from public.items i %s %s %s where i.board_id = %L and i.archived_at is null group by 1, 2), '
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

-- dashboard_completion — from 20260704110000_dashboard_rpc_board_read_guards.sql
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
    where i.board_id = p_board_id and i.parent_id is null and i.archived_at is null
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
    where i.board_id = p_board_id and i.parent_id is null and i.archived_at is null
    group by i.group_id;
  end if;
end; $$;

revoke execute on function public.dashboard_completion(uuid, text, uuid, jsonb)
  from public, anon;
grant execute on function public.dashboard_completion(uuid, text, uuid, jsonb)
  to authenticated;

-- _board_health_flags — from 20260703120000_health_summary.sql. This is the only
-- items scan behind dashboard_health_summary / _board_health_counts; patch it.
create or replace function public._board_health_flags(p_board_id uuid)
returns table (
  item_id uuid,
  item_name text,
  item_created_at timestamptz,
  is_done boolean,
  is_overdue boolean,
  is_incomplete boolean
)
language sql stable security definer set search_path = '' as $$
  with cols as (
    select
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'status'
        order by c.position asc limit 1) as status_col,
      (select c.settings from public.columns c
        where c.board_id = p_board_id and c.kind = 'status'
        order by c.position asc limit 1) as status_settings,
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'people'
        order by c.position asc limit 1) as people_col,
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'date'
        order by c.position asc limit 1) as date_col
  ),
  base as (
    select
      i.id,
      i.name,
      i.created_at,
      exists (
        select 1
        from public.cell_values cv,
             jsonb_array_elements(
               coalesce(cols.status_settings -> 'options', '[]'::jsonb)) opt
        where cv.item_id = i.id
          and cv.column_id = cols.status_col
          and opt ->> 'id' = cv.value ->> 'optionId'
          and opt ->> 'label' ~* '(done|complete)'
      ) as is_done,
      exists (
        select 1
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and coalesce(cv.value ->> 'end', cv.value ->> 'date')
              < current_date::text
      ) as has_past_due,
      (cols.people_col is not null) as has_people_col,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.people_col
          and jsonb_array_length(coalesce(cv.value -> 'userIds', '[]'::jsonb)) > 0
      ) as has_owner,
      (cols.date_col is not null) as has_date_col,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.date_col
          and cv.value ->> 'date' is not null
      ) as has_date
    from public.items i
    cross join cols
    where i.board_id = p_board_id and i.parent_id is null and i.archived_at is null
  )
  select
    id,
    name,
    created_at,
    is_done,
    (has_past_due and not is_done) as is_overdue,
    (not is_done and (
      (has_people_col and not has_owner) or (has_date_col and not has_date)
    )) as is_incomplete
  from base
$$;

revoke execute on function public._board_health_flags(uuid)
  from public, anon, authenticated;

-- portfolio_rollup — from 20260621071929_portfolios.sql
create or replace function public.portfolio_rollup(
  p_portfolio_id uuid,
  p_today        date
) returns table (
  board_id       uuid,
  name           text,
  total_items    bigint,
  done_items     bigint,
  timeline_start date,
  timeline_end   date,
  overdue_items  bigint
)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.portfolios where id = p_portfolio_id;
  if v_org_id is null then
    raise exception 'portfolio not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  return query
  with pb as (
    select pb.board_id, pb.done_column_id,
           coalesce(pb.done_option_ids, '[]'::jsonb) as done_option_ids
    from public.portfolio_boards pb
    where pb.portfolio_id = p_portfolio_id
      and public.can_read_board(pb.board_id)
  ),
  it as (
    select pb.board_id, i.id as item_id, pb.done_column_id, pb.done_option_ids,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id
          and cv.column_id = pb.done_column_id
          and pb.done_option_ids ? (cv.value ->> 'optionId')
      ) as is_done,
      (
        select max(coalesce((cv.value ->> 'end'), (cv.value ->> 'date'))::date)
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and (cv.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
      ) as item_end,
      (
        select min((cv.value ->> 'date')::date)
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and (cv.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
      ) as item_start
    from pb
    join public.items i on i.board_id = pb.board_id and i.parent_id is null
      and i.archived_at is null
  )
  select
    b.id as board_id,
    b.name,
    count(it.item_id) as total_items,
    count(it.item_id) filter (where it.is_done) as done_items,
    min(it.item_start) as timeline_start,
    max(it.item_end) as timeline_end,
    count(it.item_id) filter (
      where not it.is_done and it.item_end is not null and it.item_end < p_today
    ) as overdue_items
  from pb
  join public.boards b on b.id = pb.board_id
  left join it on it.board_id = pb.board_id
  group by b.id, b.name;
end; $$;
grant execute on function public.portfolio_rollup(uuid, date) to authenticated;

-- workload_rollup — from 20260622160000_workload.sql
create or replace function public.workload_rollup(p_from date, p_to date)
returns table (
  item_id       uuid,
  board_id      uuid,
  item_name     text,
  user_id       uuid,
  start_date    date,
  end_date      date,
  estimate_secs bigint
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with date_col as (
    -- first date column per readable, in-org board
    select distinct on (c.board_id) c.board_id, c.id as column_id
    from public.columns c
    join public.boards b on b.id = c.board_id
    where c.kind = 'date'
      and public.is_org_member(b.org_id)
      and public.can_read_board(c.board_id)
    order by c.board_id, c.position, c.id
  ),
  dated as (
    select
      i.id as item_id,
      i.board_id,
      i.name as item_name,
      (dv.value ->> 'date')::date as start_date,
      coalesce((dv.value ->> 'end')::date, (dv.value ->> 'date')::date) as end_date,
      -- estimate from the item's time_tracking cell, if any
      (
        select (cv.value ->> 'estimateSeconds')::bigint
        from public.cell_values cv
        join public.columns tc on tc.id = cv.column_id and tc.kind = 'time_tracking'
        where cv.item_id = i.id
        limit 1
      ) as estimate_secs,
      -- assignee userIds from the item's people cell, if any
      (
        select pv.value -> 'userIds'
        from public.cell_values pv
        join public.columns pc on pc.id = pv.column_id and pc.kind = 'people'
        where pv.item_id = i.id
        limit 1
      ) as user_ids
    from date_col dc
    join public.items i on i.board_id = dc.board_id and i.parent_id is null
      and i.archived_at is null
    join public.cell_values dv on dv.item_id = i.id and dv.column_id = dc.column_id
    where (dv.value ->> 'date') is not null
      -- overlap test against the horizon
      and (dv.value ->> 'date')::date <= p_to
      and coalesce((dv.value ->> 'end')::date, (dv.value ->> 'date')::date) >= p_from
  )
  select d.item_id, d.board_id, d.item_name,
         (u.uid)::uuid as user_id,
         d.start_date, d.end_date, d.estimate_secs
  from dated d
  left join lateral (
    select value::text as uid
    from jsonb_array_elements_text(coalesce(d.user_ids, '[]'::jsonb)) as value
  ) u on true
  limit 5000;
end; $$;
grant execute on function public.workload_rollup(date, date) to authenticated;

-- goals_rollup — from 20260621160000_goals.sql
create or replace function public.goals_rollup()
returns table (goal_id uuid, board_id uuid, total_items bigint, done_items bigint)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with gl as (
    select gl.goal_id, gl.board_id, gl.done_column_id,
           coalesce(gl.done_option_ids, '[]'::jsonb) as done_option_ids
    from public.goal_links gl
    join public.goals g on g.id = gl.goal_id and g.progress_mode = 'auto_boards'
    where public.is_org_member(gl.org_id)
      and public.can_read_board(gl.board_id)
  ),
  it as (
    select gl.goal_id, gl.board_id, i.id as item_id,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id
          and cv.column_id = gl.done_column_id
          and gl.done_option_ids ? (cv.value ->> 'optionId')
      ) as is_done
    from gl
    join public.items i on i.board_id = gl.board_id and i.parent_id is null
      and i.archived_at is null
  )
  select gl.goal_id, gl.board_id,
    count(it.item_id) as total_items,
    count(it.item_id) filter (where it.is_done) as done_items
  from gl
  left join it on it.goal_id = gl.goal_id and it.board_id = gl.board_id
  group by gl.goal_id, gl.board_id;
end; $$;
grant execute on function public.goals_rollup() to authenticated;

-- workload_actuals_rollup (20260623123519_time_allocations.sql) scans
-- time_entries / time_allocations, NOT public.items — no archived-item predicate
-- applies (per spec, time entries stay hard-delete in v1). Left unchanged.

-- create_item — from 20260620100000_board_level_sharing.sql: seed position from
-- live rows only so a new item ignores archived siblings.
create or replace function public.create_item(p_group_id uuid, p_name text)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org_id   uuid;
  v_board_id uuid;
  v_pos      double precision;
  v_item     public.items;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id, board_id into v_org_id, v_board_id
  from public.groups
  where id = p_group_id;

  if v_org_id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not public.can_edit_board(v_board_id) then
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;

  select coalesce(max(position), 0) + 1 into v_pos
  from public.items
  where group_id = p_group_id and archived_at is null;

  insert into public.items (org_id, board_id, group_id, name, position)
  values (v_org_id, v_board_id, p_group_id, p_name, v_pos)
  returning * into v_item;

  return v_item;
end;
$$;
grant execute on function public.create_item(uuid, text) to authenticated;
