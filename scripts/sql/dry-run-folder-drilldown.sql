-- dry-run-folder-drilldown.sql
--
-- Checks supabase/migrations/20261116112338_folder_drilldown.sql on LIVE data,
-- with nothing kept.
--
-- HOW TO RUN: send this whole file as ONE batch through the supabase-dev MCP
-- `execute_sql` (one implicit transaction). Do NOT apply the migration first:
-- its body is included below and creates the four functions inside this
-- transaction. The batch ENDS with `raise exception 'FOLDER_DRILLDOWN %',
-- <json>`, which rolls the whole transaction back: the functions and every
-- setting. There is no begin / commit / rollback in this file on purpose.
--
-- The error message IS the report:
--   { "ok": true|false, "failed": [...],
--     "acl": { <function>: { anon, public } },          -- must all be false
--     "folders": [ { folder_id, as_user, readable_boards,
--         kpis: { <kpi>: [drill_down_total, card_number] },   -- must be equal
--         scoped: { board_id, stage_key, <kpi>: [drill, card] },
--         paging: { total, page1, page2, overlap, clamped_rows },
--         attention: { total, old_path_rows, lost_before, per_board:
--                      [ { board_id, in_query, old_path } ] },
--         packed: { rollup_rows, workload_rows },
--         ms: { kpi_items, attention_page, rollup_packed } } ],
--     "permissions": { folder_id, non_member, <function>: <sqlstate> } }
-- "ok": false means an assertion in "failed" did not hold; read it before
-- applying anything.
--
-- What it asserts, on the five largest folders (by live item count), each
-- read as the org member who can read the most of its boards:
--   * DRILL-DOWN = CARD: for every one of the 13 lists, folder_kpi_items'
--     total equals the sum of that folder_rollup column; again for one board
--     and one stage (the scope a filtered page asks for);
--   * paging: two consecutive pages never share an item, a page never holds
--     more than its limit, and an absurd limit is clamped to 100;
--   * FILTER IN THE QUERY: folder_attention_page's unfiltered first 100 rows
--     are folder_attention's 100 rows, in the same order (same rule); the
--     per-board totals add up to the folder total; and for every board the
--     filtered total is at least what the old path showed for it (the old
--     path = folder_attention's top 100, then filtered). "lost_before" is the
--     number of rows the old path could not show: it must be total - 100 on a
--     folder with more than 100 attention rows, and 0 otherwise;
--   * folder_rollup_packed / folder_workload_packed hold exactly the rows of
--     folder_rollup / folder_workload, in the same order;
--   * PERMISSIONS: a signed-in user who is not a member of the folder's
--     organisation, and a caller with no user at all, get P0002 from each of
--     the four functions; an unknown list name is 22023; none of the four is
--     executable by anon or public.
--
-- Ids and counts only: no names leave the database.
--
-- The migration body below must stay a verbatim copy of the migration file;
-- src/lib/folders/folder-drilldown.sql.test.ts fails when they differ.

select set_config('statement_timeout', '120s', true);
select set_config('lock_timeout', '5s', true);

-- >>> MIGRATION BODY BEGIN
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
-- <<< MIGRATION BODY END

do $report$
declare
  c_kpis constant text[] := array[
    'total', 'done', 'in_progress', 'overdue', 'not_started', 'blocked',
    'stale', 'unassigned', 'incomplete', 'planned_by_today', 'due_this_week',
    'due_this_week_not_started', 'done_dated'];
  c_fns constant text[] := array[
    'public.folder_kpi_items(uuid,text,uuid,text,integer,integer)',
    'public.folder_attention_page(uuid,uuid,text,text,integer,integer)',
    'public.folder_rollup_packed(uuid)',
    'public.folder_workload_packed(uuid)'];
  r record;
  m record;
  b record;
  v_uid uuid;
  v_best bigint;
  n bigint;
  v_kpi text;
  v_fn text;
  v_drill bigint;
  v_card bigint;
  v_failed text[] := '{}';
  v_folders jsonb := '[]'::jsonb;
  v_acl jsonb := '{}'::jsonb;
  v_perm jsonb := '{}'::jsonb;
  v_kpis jsonb;
  v_scoped jsonb;
  v_board uuid;
  v_stage text;
  v_p1 jsonb;
  v_p2 jsonb;
  v_big jsonb;
  v_overlap bigint;
  v_att_total bigint;
  v_old_ids uuid[];
  v_new_ids uuid[];
  v_per_board jsonb;
  v_sum bigint;
  v_in bigint;
  v_old bigint;
  v_lost bigint;
  v_packed jsonb;
  v_plain jsonb;
  v_wpacked jsonb;
  v_wplain jsonb;
  t0 timestamptz;
  v_ms_kpi numeric;
  v_ms_att numeric;
  v_ms_roll numeric;
  v_first uuid;
  v_first_org uuid;
  v_outsider uuid;
  v_state text;
begin
  -- ── ACL: not executable by anon or public ──
  foreach v_fn in array c_fns loop
    v_acl := v_acl || jsonb_build_object(v_fn, jsonb_build_object(
      'anon', has_function_privilege('anon', v_fn, 'execute'),
      -- A null ACL is the default, which lets PUBLIC execute.
      'public', exists (
        select 1 from pg_proc p
        where p.oid = v_fn::regprocedure
          and (p.proacl is null or exists (
            select 1 from aclexplode(p.proacl) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE')))));
    if (v_acl -> v_fn ->> 'anon')::boolean or (v_acl -> v_fn ->> 'public')::boolean then
      v_failed := v_failed || format('%s is executable by anon or public', v_fn);
    end if;
  end loop;

  -- ── the five largest folders ──
  for r in
    select fb.folder_id, fo.org_id, count(i.id) as items
    from public.folder_boards fb
    join public.folders fo on fo.id = fb.folder_id
    join public.boards bo on bo.id = fb.board_id and bo.archived_at is null
    join public.items i on i.board_id = bo.id and i.archived_at is null
    group by fb.folder_id, fo.org_id
    order by count(i.id) desc, fb.folder_id
    limit 5
  loop
    if v_first is null then
      v_first := r.folder_id;
      v_first_org := r.org_id;
    end if;

    -- The member who can read the most boards of this folder.
    v_uid := null;
    v_best := 0;
    for m in
      select om.user_id from public.org_members om
      where om.org_id = r.org_id and om.deactivated_at is null
      order by om.user_id
    loop
      perform set_config('request.jwt.claims',
        json_build_object('sub', m.user_id::text, 'role', 'authenticated')::text, true);
      select count(*) into n from public._folder_readable_boards(r.folder_id);
      if n > v_best and public.can_see_folder(r.folder_id) then
        v_best := n;
        v_uid := m.user_id;
      end if;
    end loop;
    if v_uid is null then
      v_failed := v_failed || format('folder %s: no member can read it', r.folder_id);
      continue;
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

    -- ── drill-down total = card number, all 13 lists, whole folder ──
    v_kpis := '{}'::jsonb;
    t0 := clock_timestamp();
    foreach v_kpi in array c_kpis loop
      v_drill := (public.folder_kpi_items(r.folder_id, v_kpi, null, null, 1, 0) ->> 'total')::bigint;
      select coalesce(sum((to_jsonb(x) ->> v_kpi)::bigint), 0) into v_card
        from public.folder_rollup(r.folder_id) x;
      v_kpis := v_kpis || jsonb_build_object(v_kpi, jsonb_build_array(v_drill, v_card));
      if v_drill is distinct from v_card then
        v_failed := v_failed || format('folder %s %s: drill-down %s, card %s',
          r.folder_id, v_kpi, v_drill, v_card);
      end if;
    end loop;
    v_ms_kpi := round(extract(epoch from clock_timestamp() - t0) * 1000 / (2 * cardinality(c_kpis)));

    -- ── again for one board and one stage: the largest group of the folder ──
    select x.board_id, lower(trim(x.group_name)) into v_board, v_stage
      from public.folder_rollup(r.folder_id) x
      where x.group_id is not null
      order by x.total desc, x.board_id, x.group_id
      limit 1;
    v_scoped := jsonb_build_object('board_id', v_board, 'stage_key', v_stage);
    if v_board is not null then
      foreach v_kpi in array c_kpis loop
        v_drill := (public.folder_kpi_items(r.folder_id, v_kpi, v_board, v_stage, 1, 0) ->> 'total')::bigint;
        select coalesce(sum((to_jsonb(x) ->> v_kpi)::bigint), 0) into v_card
          from public.folder_rollup(r.folder_id) x
          where x.board_id = v_board and lower(trim(x.group_name)) = v_stage;
        v_scoped := v_scoped || jsonb_build_object(v_kpi, jsonb_build_array(v_drill, v_card));
        if v_drill is distinct from v_card then
          v_failed := v_failed || format('folder %s board %s stage scope %s: drill-down %s, card %s',
            r.folder_id, v_board, v_kpi, v_drill, v_card);
        end if;
      end loop;
    end if;

    -- ── paging: bounded, clamped, no overlap ──
    v_p1 := public.folder_kpi_items(r.folder_id, 'total', null, null, 100, 0);
    v_p2 := public.folder_kpi_items(r.folder_id, 'total', null, null, 100, 100);
    v_big := public.folder_kpi_items(r.folder_id, 'total', null, null, 1000000, 0);
    select count(*) into v_overlap
      from jsonb_array_elements(v_p1 -> 'rows') a
      join jsonb_array_elements(v_p2 -> 'rows') c on c ->> 'item_id' = a ->> 'item_id';
    if v_overlap <> 0 then
      v_failed := v_failed || format('folder %s: %s items on two pages', r.folder_id, v_overlap);
    end if;
    if jsonb_array_length(v_p1 -> 'rows') <> least(100, (v_p1 ->> 'total')::bigint)
       or jsonb_array_length(v_p2 -> 'rows') <> least(100, greatest(0, (v_p1 ->> 'total')::bigint - 100))
       or jsonb_array_length(v_big -> 'rows') > 100 then
      v_failed := v_failed || format('folder %s: page sizes %s / %s / %s for total %s',
        r.folder_id, jsonb_array_length(v_p1 -> 'rows'), jsonb_array_length(v_p2 -> 'rows'),
        jsonb_array_length(v_big -> 'rows'), v_p1 ->> 'total');
    end if;

    -- ── attention: the filter is in the query ──
    t0 := clock_timestamp();
    v_p1 := public.folder_attention_page(r.folder_id, null, null, null, 100, 0);
    v_ms_att := round(extract(epoch from clock_timestamp() - t0) * 1000);
    v_att_total := (v_p1 ->> 'total')::bigint;
    select coalesce(array_agg(a.item_id order by a.ord), '{}') into v_old_ids
      from public.folder_attention(r.folder_id, 100) with ordinality as a(
        item_id, item_name, board_id, board_name, group_id, group_name,
        reason, age_days, severity, ord);
    select coalesce(array_agg((e.v ->> 'item_id')::uuid order by e.ord), '{}') into v_new_ids
      from jsonb_array_elements(v_p1 -> 'rows') with ordinality as e(v, ord);
    if v_old_ids is distinct from v_new_ids then
      v_failed := v_failed || format(
        'folder %s: folder_attention_page unfiltered first 100 differ from folder_attention', r.folder_id);
    end if;
    v_per_board := '[]'::jsonb;
    v_sum := 0;
    v_lost := 0;
    for b in select x as board_id from public._folder_readable_boards(r.folder_id) x order by 1 loop
      v_in := (public.folder_attention_page(r.folder_id, b.board_id, null, null, 1, 0) ->> 'total')::bigint;
      select count(*) into v_old
        from public.folder_attention(r.folder_id, 100) a where a.board_id = b.board_id;
      v_sum := v_sum + v_in;
      v_lost := v_lost + (v_in - v_old);
      if v_in < v_old then
        v_failed := v_failed || format('folder %s board %s: in query %s < old path %s',
          r.folder_id, b.board_id, v_in, v_old);
      end if;
      if v_in > 0 or v_old > 0 then
        v_per_board := v_per_board || jsonb_build_object(
          'board_id', b.board_id, 'in_query', v_in, 'old_path', v_old);
      end if;
    end loop;
    if v_sum is distinct from v_att_total then
      v_failed := v_failed || format('folder %s: per-board attention totals %s, folder total %s',
        r.folder_id, v_sum, v_att_total);
    end if;
    if v_lost is distinct from greatest(0, v_att_total - 100) then
      v_failed := v_failed || format('folder %s: rows the old path lost %s, expected %s',
        r.folder_id, v_lost, greatest(0, v_att_total - 100));
    end if;

    -- ── packed = the set-returning functions, same rows, same order ──
    t0 := clock_timestamp();
    v_packed := public.folder_rollup_packed(r.folder_id);
    v_ms_roll := round(extract(epoch from clock_timestamp() - t0) * 1000);
    select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_plain
      from (
        select o.* from public.folder_rollup(r.folder_id) with ordinality as o(
          board_id, board_name, board_position, group_id, group_name, group_color,
          group_position, total, done, in_progress, overdue, not_started, blocked,
          stale, unassigned, incomplete, planned_by_today, due_this_week,
          due_this_week_not_started, oldest_overdue, min_due, max_due, done_dated,
          ord)
      ) x;
    if (v_packed -> 'rows') is distinct from v_plain
       or (v_packed ->> 'total')::bigint <> jsonb_array_length(v_plain) then
      v_failed := v_failed || format('folder %s: folder_rollup_packed differs from folder_rollup', r.folder_id);
    end if;
    v_wpacked := public.folder_workload_packed(r.folder_id);
    select coalesce(jsonb_agg(to_jsonb(x) - 'ord' order by x.ord), '[]'::jsonb) into v_wplain
      from (
        select o.* from public.folder_workload(r.folder_id) with ordinality as o(
          user_id, board_id, board_name, stage_key, stage_name, open_items,
          overdue_items, ord)
      ) x;
    if (v_wpacked -> 'rows') is distinct from v_wplain
       or (v_wpacked ->> 'total')::bigint <> jsonb_array_length(v_wplain) then
      v_failed := v_failed || format('folder %s: folder_workload_packed differs from folder_workload', r.folder_id);
    end if;

    v_folders := v_folders || jsonb_build_object(
      'folder_id', r.folder_id,
      'as_user', v_uid,
      'readable_boards', v_best,
      'kpis', v_kpis,
      'scoped', v_scoped,
      'paging', jsonb_build_object(
        'total', (v_big ->> 'total')::bigint,
        'page1', least(100, (v_big ->> 'total')::bigint),
        'page2', jsonb_array_length(v_p2 -> 'rows'),
        'overlap', v_overlap,
        'clamped_rows', jsonb_array_length(v_big -> 'rows')),
      'attention', jsonb_build_object(
        'total', v_att_total,
        'old_path_rows', cardinality(v_old_ids),
        'lost_before', v_lost,
        'per_board', v_per_board),
      'packed', jsonb_build_object(
        'rollup_rows', jsonb_array_length(v_plain),
        'workload_rows', jsonb_array_length(v_wplain)),
      'ms', jsonb_build_object(
        'kpi_items', v_ms_kpi, 'attention_page', v_ms_att, 'rollup_packed', v_ms_roll));
  end loop;

  if jsonb_array_length(v_folders) = 0 then
    v_failed := v_failed || 'nothing was measured (no folder with items)'::text;
  end if;

  -- ── permissions on the largest folder ──
  if v_first is not null then
    select u.id into v_outsider
      from auth.users u
      where not exists (
        select 1 from public.org_members om
        where om.user_id = u.id and om.org_id = v_first_org)
      order by u.id
      limit 1;
    v_perm := jsonb_build_object('folder_id', v_first, 'non_member', v_outsider);
    if v_outsider is null then
      v_failed := v_failed || 'no user outside the organisation to test with'::text;
    end if;
    -- pass 1: a signed-in non-member; pass 2: nobody signed in.
    for n in 1..2 loop
      if n = 1 and v_outsider is null then continue; end if;
      perform set_config('request.jwt.claims',
        case when n = 1
             then json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text
             else '' end, true);
      foreach v_fn in array array[
        'folder_kpi_items', 'folder_attention_page',
        'folder_rollup_packed', 'folder_workload_packed'] loop
        v_state := 'returned rows';
        begin
          if v_fn = 'folder_kpi_items' then
            perform public.folder_kpi_items(v_first, 'total');
          elsif v_fn = 'folder_attention_page' then
            perform public.folder_attention_page(v_first);
          elsif v_fn = 'folder_rollup_packed' then
            perform public.folder_rollup_packed(v_first);
          else
            perform public.folder_workload_packed(v_first);
          end if;
        exception when others then
          v_state := sqlstate;
        end;
        v_perm := v_perm || jsonb_build_object(
          v_fn || case when n = 1 then ':non_member' else ':no_user' end, v_state);
        if v_state <> 'P0002' then
          v_failed := v_failed || format('%s as %s: %s, expected P0002',
            v_fn, case when n = 1 then 'a non-member' else 'no user' end, v_state);
        end if;
      end loop;
    end loop;

    -- An unknown list name is refused (as a member).
    select o.as_user into v_uid
      from (select (f ->> 'as_user')::uuid as as_user, f ->> 'folder_id' as fid
              from jsonb_array_elements(v_folders) f) o
      where o.fid = v_first::text;
    if v_uid is not null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
      v_state := 'returned rows';
      begin
        perform public.folder_kpi_items(v_first, 'everything');
      exception when others then
        v_state := sqlstate;
      end;
      v_perm := v_perm || jsonb_build_object('unknown_kpi', v_state);
      if v_state <> '22023' then
        v_failed := v_failed || format('unknown kpi: %s, expected 22023', v_state);
      end if;
    end if;
  end if;

  raise exception 'FOLDER_DRILLDOWN %', jsonb_build_object(
    'ok', cardinality(v_failed) = 0,
    'failed', to_jsonb(v_failed),
    'acl', v_acl,
    'folders', v_folders,
    'permissions', v_perm)::text;
end;
$report$;
