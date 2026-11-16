-- 20261116112338_folder_drilldown.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Four NEW functions for the folder page. Nothing existing is dropped,
--   replaced or renamed, so code deployed before this migration keeps
--   working, and the new code falls back to the old functions while these
--   are absent.
--
--   * folder_kpi_items (new): the items behind one KPI number (Overdue, Done,
--     Due this week, Blocked, Stale and the other folder_rollup counts), one
--     bounded page at a time, plus the total match count. It reads
--     public._folder_item_flags, the same per-item flags folder_rollup counts,
--     and each predicate is the SAME text as folder_rollup's filter for that
--     column (src/lib/folders/folder-drilldown.sql.test.ts fails when they
--     differ), so total = the card's number for the same board / stage scope.
--   * folder_attention_page (new): folder_attention with the board, stage and
--     reason filters INSIDE the query, so the limit applies to matching rows,
--     plus the total match count. folder_attention itself returns the folder's
--     top rows and the page then kept the ones in the selected board / stage:
--     on a folder with more than 100 attention items, matching rows past the
--     first 100 were lost. Same classification, severity and age as
--     folder_attention.
--   * folder_rollup_packed, folder_workload_packed (new): the rows of
--     folder_rollup / folder_workload as ONE jsonb value. PostgREST caps a
--     set-returning function at max_rows = 1000 rows, silently; folder_rollup
--     returns one row per board and group, folder_workload one per person,
--     board and stage, so both can pass 1,000 on a large folder. A single
--     jsonb value is not subject to that cap (the folder_burn_packed
--     pattern). Each keeps an explicit bound of 5,000 rows and returns the
--     full row count next to the rows, so the page can say when it is cut.
--
--   NOT changed: folder_gallery returns one row per folder of a workspace, so
--   it passes 1,000 rows only with more than 1,000 folders in one workspace;
--   the page states it when that many rows come back.
--
--   Every function here is security definer with an empty search_path, checks
--   public._assert_folder_member (one P0002 for "no such folder" and "not
--   yours"), counts only the boards the caller can read (through
--   _folder_item_flags) and is not executable by public or anon.
--
--   Stage keys are lower(trim(group name)), as in folder_workload,
--   folder_burn and folder_load.

-- ── 1. The items behind one KPI number ──────────────────────────────────────
-- p_kpi is one of folder_rollup's count columns (or 'total'). Returns
--   { "total": <all matching items>, "rows": [ up to p_limit items ] }.
-- p_limit is clamped to 1..100, p_offset to >= 0. The order ends in item_id,
-- so pages never overlap.
create function public.folder_kpi_items(
  p_folder_id uuid,
  p_kpi text,
  p_board_id uuid default null,
  p_stage_key text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today date;
  v_week date;
  v jsonb;
begin
  perform public._assert_folder_member(p_folder_id);
  if p_kpi is null or p_kpi not in (
    'total', 'done', 'in_progress', 'overdue', 'not_started', 'blocked',
    'stale', 'unassigned', 'incomplete', 'planned_by_today', 'due_this_week',
    'due_this_week_not_started', 'done_dated'
  ) then
    raise exception 'unknown kpi' using errcode = '22023';
  end if;
  select public._work_today(fo.org_id) into v_today
    from public.folders fo where fo.id = p_folder_id;
  v_week := date_trunc('week', v_today)::date;
  with hit as materialized (
    select f.item_id, f.item_name, f.board_id, f.board_name, f.board_position,
           f.group_id, f.group_name, f.due_on, f.done_on, f.last_touched,
           f.is_done, f.is_overdue
    from public._folder_item_flags(p_folder_id) f
    where (p_board_id is null or f.board_id = p_board_id)
      and (p_stage_key is null or lower(trim(f.group_name)) = p_stage_key)
      -- Each branch is folder_rollup's filter for that column, word for word.
      and case p_kpi
        when 'total' then true
        when 'done' then (f.is_done)
        when 'in_progress' then (not f.is_done and not f.is_overdue and f.has_status)
        when 'overdue' then (f.is_overdue)
        when 'not_started' then (not f.is_done and not f.is_overdue and not f.has_status)
        when 'blocked' then (f.is_blocked)
        when 'stale' then (not f.is_done and f.last_touched < now() - interval '14 days')
        when 'unassigned' then (not f.is_done and f.has_people_col and not f.has_owner)
        when 'incomplete' then (f.is_incomplete)
        when 'planned_by_today' then (f.planned_on <= v_today)
        when 'due_this_week' then (not f.is_done
          and f.planned_on >= v_week
          and f.planned_on <  v_week + 7)
        when 'due_this_week_not_started' then (not f.is_done and not f.has_status
          and f.planned_on >= v_week
          and f.planned_on <  v_week + 7)
        when 'done_dated' then (f.is_done and f.planned_on is not null)
      end
  ),
  ranked as (
    select h.*,
           row_number() over (
             order by
               case when p_kpi in ('overdue', 'due_this_week',
                                   'due_this_week_not_started', 'planned_by_today')
                    then h.due_on end asc nulls last,
               case when p_kpi in ('done', 'done_dated')
                    then h.done_on end desc nulls last,
               case when p_kpi = 'stale' then h.last_touched end asc nulls last,
               h.board_position asc, h.board_name asc, h.board_id asc,
               h.item_name asc, h.item_id asc
           ) as ord
    from hit h
  )
  select jsonb_build_object(
    'total', (select count(*) from hit),
    'rows', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'item_id', r.item_id,
                  'item_name', r.item_name,
                  'board_id', r.board_id,
                  'board_name', r.board_name,
                  'group_id', r.group_id,
                  'group_name', r.group_name,
                  'due_on', r.due_on,
                  'done_on', r.done_on,
                  'last_touched', r.last_touched,
                  'is_done', r.is_done,
                  'is_overdue', r.is_overdue)
                order by r.ord)
         from ranked r
        where r.ord > v_offset and r.ord <= v_offset + v_limit),
      '[]'::jsonb))
  into v;
  return v;
end; $$;

revoke execute on function public.folder_kpi_items(uuid, text, uuid, text, integer, integer)
  from public, anon;
grant execute on function public.folder_kpi_items(uuid, text, uuid, text, integer, integer)
  to authenticated, service_role;

-- ── 2. Attention, filtered in the query ─────────────────────────────────────
-- The reasons CTE is folder_attention's, word for word; the three filters are
-- applied BEFORE the limit. Returns
--   { "total": <all matching items>, "rows": [ up to p_limit items ] }.
-- p_limit is clamped to 1..100, p_offset to >= 0.
create function public.folder_attention_page(
  p_folder_id uuid,
  p_board_id uuid default null,
  p_stage_key text default null,
  p_reason text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today date;
  v jsonb;
begin
  perform public._assert_folder_member(p_folder_id);
  select public._work_today(fo.org_id) into v_today
    from public.folders fo where fo.id = p_folder_id;
  with flags as (
    select * from public._folder_item_flags(p_folder_id)
  ),
  reasons as (
    select
      f.item_id,
      f.item_name,
      f.board_id,
      f.board_name,
      f.group_id,
      f.group_name,
      case
        when f.is_overdue then 'overdue'
        when f.is_blocked then 'blocked'
        when f.has_people_col and not f.has_owner then 'unassigned'
        else 'stale'
      end as reason,
      case
        when f.is_overdue then 4
        when f.is_blocked then 3
        when f.has_people_col and not f.has_owner then 2
        else 1
      end as severity,
      case
        when f.is_overdue and f.overdue_since is not null then (v_today - f.overdue_since)
        else greatest(0, floor(extract(epoch from (now() - f.last_touched)) / 86400))::int
      end as age_days
    from flags f
    where not f.is_done
      and (
        f.is_overdue
        or f.is_blocked
        or (f.has_people_col and not f.has_owner)
        or f.last_touched < now() - interval '14 days'
      )
  ),
  hit as materialized (
    select r.*
    from reasons r
    where (p_board_id is null or r.board_id = p_board_id)
      and (p_stage_key is null or lower(trim(r.group_name)) = p_stage_key)
      and (p_reason is null or r.reason = p_reason)
  ),
  ranked as (
    select h.*,
           row_number() over (
             order by h.severity desc, h.age_days desc, h.item_name asc, h.item_id asc
           ) as ord
    from hit h
  )
  select jsonb_build_object(
    'total', (select count(*) from hit),
    'rows', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'item_id', r.item_id,
                  'item_name', r.item_name,
                  'board_id', r.board_id,
                  'board_name', r.board_name,
                  'group_id', r.group_id,
                  'group_name', r.group_name,
                  'reason', r.reason,
                  'age_days', r.age_days,
                  'severity', r.severity)
                order by r.ord)
         from ranked r
        where r.ord > v_offset and r.ord <= v_offset + v_limit),
      '[]'::jsonb))
  into v;
  return v;
end; $$;

revoke execute on function public.folder_attention_page(uuid, uuid, text, text, integer, integer)
  from public, anon;
grant execute on function public.folder_attention_page(uuid, uuid, text, text, integer, integer)
  to authenticated, service_role;

-- ── 3. folder_rollup as one jsonb value (no 1,000-row cap) ──────────────────
-- { "total": <rows folder_rollup returned>, "rows": [ first 5,000, in
--   folder_rollup's own order, each with folder_rollup's column names ] }.
-- folder_rollup does the permission check and the counting; the check is
-- repeated here so this function never depends on that.
create function public.folder_rollup_packed(p_folder_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform public._assert_folder_member(p_folder_id);
  with r as materialized (
    select o.board_id, o.board_name, o.board_position, o.group_id,
           o.group_name, o.group_color, o.group_position, o.total, o.done,
           o.in_progress, o.overdue, o.not_started, o.blocked, o.stale,
           o.unassigned, o.incomplete, o.planned_by_today, o.due_this_week,
           o.due_this_week_not_started, o.oldest_overdue, o.min_due,
           o.max_due, o.done_dated, o.ord
    from public.folder_rollup(p_folder_id) with ordinality as o(
      board_id, board_name, board_position, group_id, group_name, group_color,
      group_position, total, done, in_progress, overdue, not_started, blocked,
      stale, unassigned, incomplete, planned_by_today, due_this_week,
      due_this_week_not_started, oldest_overdue, min_due, max_due, done_dated,
      ord)
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(r) - 'ord' order by r.ord)
         from r where r.ord <= 5000),
      '[]'::jsonb))
  into v;
  return v;
end; $$;

revoke execute on function public.folder_rollup_packed(uuid) from public, anon;
grant execute on function public.folder_rollup_packed(uuid) to authenticated, service_role;

-- ── 4. folder_workload as one jsonb value (no 1,000-row cap) ────────────────
-- Same shape and bound as folder_rollup_packed, over folder_workload's rows.
create function public.folder_workload_packed(p_folder_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform public._assert_folder_member(p_folder_id);
  with r as materialized (
    select o.user_id, o.board_id, o.board_name, o.stage_key, o.stage_name,
           o.open_items, o.overdue_items, o.ord
    from public.folder_workload(p_folder_id) with ordinality as o(
      user_id, board_id, board_name, stage_key, stage_name, open_items,
      overdue_items, ord)
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(r) - 'ord' order by r.ord)
         from r where r.ord <= 5000),
      '[]'::jsonb))
  into v;
  return v;
end; $$;

revoke execute on function public.folder_workload_packed(uuid) from public, anon;
grant execute on function public.folder_workload_packed(uuid) to authenticated, service_role;
