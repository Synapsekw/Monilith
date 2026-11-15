-- 20261114145347_folder_tower.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- Command Center "Tower": per-week overdue and imported-done counts on
-- folder_burn, and a bounded board x week load grid.
--
-- _folder_item_flags and folder_rollup are NOT changed.
--
-- folder_burn gains two columns, so it is dropped and recreated in this one
-- transaction. The deployed client parses rows with a plain z.object, which
-- strips unknown keys, so the code live today keeps working.
--
--   imported_done  completions whose done date is the item's creation date:
--                  an item that arrived already done (an import). The forecast
--                  pace leaves these out.
--   overdue_open   items overdue as of the end of that week (or as of yesterday
--                  for the current week): earliest date passed, not done by
--                  then, and the item already existed. Zero for future weeks
--                  and for weeks more than 12 back.
--
-- PostgREST caps every response at max_rows = 1000. folder_burn's dense
-- stage x week grid passes that easily (DAAS on 2026-11-14: 56 x 73 = 4,088
-- rows), and paging it re-runs the whole function once per page. So:
--   folder_burn_packed  ONE execution, ONE jsonb value, only non-zero rows:
--     { "lo": "YYYY-MM-DD", "hi": "YYYY-MM-DD", "stages": [stage_key, ...],
--       "rows": [[stage_index, week_offset, planned, completed,
--                 imported_done, overdue_open], ...] }
--     week_offset is whole weeks after lo; the dense grid is every stage x
--     every week from lo to hi. lo/hi are null and both arrays empty when the
--     folder has no events. folder_burn itself stays (same dense rows and
--     columns) for the client deployed today.
--   folder_load  returns jsonb too, for the same reason (its 5,000-row bound
--     is above max_rows):
--     { "weeks": ["YYYY-MM-DD", ...],
--       "rows": [[board_id, stage_key, week_start, open_due], ...] }

drop function if exists public.folder_burn(uuid);

create function public.folder_burn(p_folder_id uuid)
returns table (
  stage_key text,
  week_start date,
  planned integer,
  completed integer,
  imported_done integer,
  overdue_open integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with flags as (
    select f.*, i.created_at::date as created_on
    from public._folder_item_flags(p_folder_id) f
    join public.items i on i.id = f.item_id
  ),
  ev as (
    select lower(trim(f.group_name)) as sk,
           date_trunc('week', f.planned_on)::date as wk,
           1 as planned, 0 as completed, 0 as imported
    from flags f
    where f.planned_on is not null
    union all
    select lower(trim(f.group_name)),
           date_trunc('week', f.done_on)::date,
           0, 1,
           case when f.done_on = f.created_on then 1 else 0 end
    from flags f
    where f.is_done and f.done_on is not null
  ),
  bounds as (
    select min(e.wk) as min_wk, max(e.wk) as max_wk from ev e
  ),
  span as (
    select
      b.min_wk,
      least(
        greatest(b.max_wk, date_trunc('week', current_date)::date),
        (date_trunc('week', current_date) + interval '52 weeks')::date
      ) as hi
    from bounds b
  ),
  win as (
    select s.hi,
           least(greatest(s.min_wk, (s.hi - interval '103 weeks')::date), s.hi) as lo
    from span s
  ),
  clamped as (
    select e.sk, least(greatest(e.wk, w.lo), w.hi) as wk,
           e.planned, e.completed, e.imported
    from ev e cross join win w
  ),
  stages as (
    select distinct c.sk from clamped c
  ),
  weeks as (
    select generate_series(w.lo, w.hi, interval '1 week')::date as wk
    from win w
    where w.lo is not null
  ),
  -- imported_done is a HEURISTIC: a completion counts as imported when the
  -- status cell's last update (done_on) falls on the item's creation day.
  agg as (
    select c.sk, c.wk,
           sum(c.planned)::int as planned,
           sum(c.completed)::int as completed,
           sum(c.imported)::int as imported
    from clamped c
    group by c.sk, c.wk
  ),
  -- KNOWN LIMIT: overdue_open is computed only for weeks inside the burn
  -- window (this week and up to 12 back), so a folder whose events are all in
  -- the future reports 0. The Overdue KPI value itself comes from folder_rollup;
  -- only the trend line uses this column.
  ovd as (
    select lower(trim(f.group_name)) as sk, wks.wk, count(*)::int as n
    from flags f
    cross join weeks wks
    where wks.wk <= date_trunc('week', current_date)::date
      and wks.wk >= (date_trunc('week', current_date) - interval '12 weeks')::date
      and f.due_on is not null
      and f.due_on < least(wks.wk + 7, current_date)
      and f.created_on < wks.wk + 7
      and not (f.is_done and f.done_on is not null and f.done_on < wks.wk + 7)
    group by 1, 2
  )
  select st.sk,
         wks.wk,
         coalesce(a.planned, 0),
         coalesce(a.completed, 0),
         coalesce(a.imported, 0),
         coalesce(o.n, 0)
  from stages st
  cross join weeks wks
  left join agg a on a.sk = st.sk and a.wk = wks.wk
  left join ovd o on o.sk = st.sk and o.wk = wks.wk
  order by st.sk asc, wks.wk asc;
end; $$;

revoke execute on function public.folder_burn(uuid) from public, anon;
grant execute on function public.folder_burn(uuid) to authenticated, service_role;

-- ── folder_burn_packed: folder_burn in one jsonb value, zero rows dropped ────
-- Gating is folder_burn's own (_assert_folder_member raises P0002), so the two
-- can never disagree about who may read a folder. Stages are indexed in
-- stage_key order; rows are ordered by (stage_index, week_offset).
create function public.folder_burn_packed(p_folder_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  with b as (
    select * from public.folder_burn(p_folder_id)
  ),
  st as (
    select s.stage_key,
           (row_number() over (order by s.stage_key) - 1)::int as i
    from (select distinct b.stage_key from b) s
  ),
  w as (
    select min(b.week_start) as lo, max(b.week_start) as hi from b
  )
  select jsonb_build_object(
    'lo', w.lo,
    'hi', w.hi,
    'stages', coalesce(
      (select jsonb_agg(st.stage_key order by st.i) from st), '[]'::jsonb),
    'rows', coalesce(
      (select jsonb_agg(
                jsonb_build_array(st.i, (b.week_start - w.lo) / 7,
                                  b.planned, b.completed,
                                  b.imported_done, b.overdue_open)
                order by st.i, b.week_start)
         from b join st on st.stage_key = b.stage_key
        where b.planned <> 0 or b.completed <> 0
           or b.imported_done <> 0 or b.overdue_open <> 0),
      '[]'::jsonb))
  into v
  from w;
  return v;
end; $$;

revoke execute on function public.folder_burn_packed(uuid) from public, anon;
grant execute on function public.folder_burn_packed(uuid) to authenticated, service_role;

-- ── folder_load: open items by board, stage and the week they are planned ────
-- Rows older than the window fold into its first week, so nothing late is
-- hidden; rows beyond the window are left out. Zero cells are not returned.
-- Returned as ONE jsonb value (see the header): the 5,000-row bound is above
-- PostgREST's max_rows. Rows keep board-position order and the bound.
create function public.folder_load(
  p_folder_id uuid,
  p_weeks_back integer default 3,
  p_weeks_ahead integer default 3
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_back integer := least(greatest(coalesce(p_weeks_back, 3), 0), 12);
  v_ahead integer := least(greatest(coalesce(p_weeks_ahead, 3), 0), 12);
  v_this date := date_trunc('week', current_date)::date;
  v_lo date := v_this - v_back * 7;
  v_hi date := v_this + v_ahead * 7;
  v jsonb;
begin
  perform public._assert_folder_member(p_folder_id);
  select jsonb_build_object(
    'weeks', (select jsonb_agg(g.d::date order by g.d)
                from generate_series(v_lo, v_hi, interval '1 week') g(d)),
    'rows', coalesce(
      (select jsonb_agg(jsonb_build_array(x.board_id, x.sk, x.wk, x.n)
                        order by x.bp, x.board_id, x.sk, x.wk)
         from (
           select y.*
           from (
             select f.board_id,
                    f.board_position as bp,
                    lower(trim(f.group_name)) as sk,
                    greatest(date_trunc('week', f.planned_on)::date, v_lo) as wk,
                    count(*)::int as n
             from public._folder_item_flags(p_folder_id) f
             where not f.is_done
               and f.planned_on is not null
               and date_trunc('week', f.planned_on)::date <= v_hi
             group by f.board_id, f.board_position, 3, 4
           ) y
           order by y.bp, y.board_id, y.sk, y.wk
           limit 5000
         ) x),
      '[]'::jsonb))
  into v;
  return v;
end; $$;

revoke execute on function public.folder_load(uuid, integer, integer) from public, anon;
grant execute on function public.folder_load(uuid, integer, integer) to authenticated, service_role;
