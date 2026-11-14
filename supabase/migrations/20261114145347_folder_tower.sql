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
  agg as (
    select c.sk, c.wk,
           sum(c.planned)::int as planned,
           sum(c.completed)::int as completed,
           sum(c.imported)::int as imported
    from clamped c
    group by c.sk, c.wk
  ),
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
grant execute on function public.folder_burn(uuid) to authenticated;

-- ── folder_load: open items by board, stage and the week they are planned ────
-- Rows older than the window fold into its first week, so nothing late is
-- hidden; rows beyond the window are left out. Zero cells are not returned.
create function public.folder_load(
  p_folder_id uuid,
  p_weeks_back integer default 3,
  p_weeks_ahead integer default 3
)
returns table (
  board_id uuid,
  stage_key text,
  week_start date,
  open_due integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_back integer := least(greatest(coalesce(p_weeks_back, 3), 0), 12);
  v_ahead integer := least(greatest(coalesce(p_weeks_ahead, 3), 0), 12);
  v_this date := date_trunc('week', current_date)::date;
  v_lo date := v_this - v_back * 7;
  v_hi date := v_this + v_ahead * 7;
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  select f.board_id,
         lower(trim(f.group_name)),
         greatest(date_trunc('week', f.planned_on)::date, v_lo),
         count(*)::int
  from public._folder_item_flags(p_folder_id) f
  where not f.is_done
    and f.planned_on is not null
    and date_trunc('week', f.planned_on)::date <= v_hi
  group by 1, 2, 3
  order by 1, 2, 3
  limit 5000;
end; $$;

revoke execute on function public.folder_load(uuid, integer, integer) from public, anon;
grant execute on function public.folder_load(uuid, integer, integer) to authenticated;
