-- dry-run-one-overdue-rule.sql
--
-- Old vs new numbers for supabase/migrations/20261115173751_one_overdue_rule.sql
-- on LIVE data, with nothing kept.
--
-- HOW TO RUN: send this whole file as ONE batch through the supabase-dev MCP
-- `execute_sql` (one implicit transaction). Do NOT apply the migration first:
-- the migration body is included below, between the two measurement halves,
-- so the "old" numbers are read before the functions are replaced. The batch
-- ENDS with `raise exception 'ONE_OVERDUE_RULE %', <json>`, which rolls the
-- whole transaction back: the functions, the temp table and every setting.
-- There is no begin / commit / rollback in this file on purpose.
--
-- The error message IS the report:
--   { "ok": true|false, "failed": [...],
--     "folders": [ { folder_id, as_user, boards, readable_boards,
--                    old: { total, done, overdue, incomplete, planned_by_today, gap, ms },
--                    new: { ... same keys ... },
--                    facts: { total, done, overdue },          -- item_facts, top-level items
--                    open_overdue_with_subitems: { count_items, item_facts } } ],
--     "orgs":    [ { org_id, old: { health: {...}, digest: {...} },
--                             new: { health: {...}, digest: {...} },
--                    facts: { total, done, overdue } } ] }
-- "ok": false means an assertion in "failed" did not hold; read it before
-- applying anything.
--
-- What it asserts (after the migration body):
--   * per folder: _folder_item_flags total / done / overdue equal the same
--     counts taken straight from public.item_facts for the folder's readable
--     boards, top-level items only, with the same "today";
--   * per folder: count_items (open, due before today) equals item_facts for
--     the same boards INCLUDING subitems (count_items lists subitems);
--   * per org: the health flags summed over the org's boards equal item_facts
--     for the org, top-level items only.
--
-- The five largest folders (by live item count) and the five largest orgs
-- are measured. Each folder is read as the org member who can read the most
-- of its boards (the folder RPCs only count boards the caller can read).
-- Ids only: no names leave the database.
--
-- The migration body below must stay a verbatim copy of the migration file;
-- src/lib/boards/one-overdue-rule.sql.test.ts fails when they differ.

select set_config('statement_timeout', '120s', true);
select set_config('lock_timeout', '5s', true);

create temp table _oor (
  phase text not null,
  kind text not null,
  id uuid not null,
  as_user uuid,
  payload jsonb not null
) on commit drop;

-- Measures one phase ('old' or 'new') into _oor. Created in pg_temp, so it
-- disappears with the session and is never visible to anyone else.
create function pg_temp._oor_measure(p_phase text) returns void
language plpgsql as $measure$
declare
  r record;
  m record;
  v_uid uuid;
  v_best bigint;
  n bigint;
  t0 timestamptz;
  v jsonb;
  v_gap jsonb;
  v_ms numeric;
begin
  -- ── folders ──
  for r in
    select fb.folder_id, fo.org_id, count(i.id) as items
    from public.folder_boards fb
    join public.folders fo on fo.id = fb.folder_id
    join public.boards b on b.id = fb.board_id and b.archived_at is null
    join public.items i on i.board_id = b.id and i.archived_at is null
    group by fb.folder_id, fo.org_id
    order by count(i.id) desc, fb.folder_id
    limit 5
  loop
    if p_phase = 'old' then
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
        if n > v_best then v_best := n; v_uid := m.user_id; end if;
      end loop;
    else
      select o.as_user, (o.payload ->> 'readable_boards')::bigint into v_uid, v_best
      from _oor o where o.phase = 'old' and o.kind = 'folder' and o.id = r.folder_id;
    end if;

    perform set_config('request.jwt.claims',
      case when v_uid is null then ''
           else json_build_object('sub', v_uid::text, 'role', 'authenticated')::text end,
      true);

    t0 := clock_timestamp();
    select jsonb_build_object(
      'total', count(*),
      'done', count(*) filter (where f.is_done),
      'overdue', count(*) filter (where f.is_overdue),
      'incomplete', count(*) filter (where f.is_incomplete)
    ) into v
    from public._folder_item_flags(r.folder_id) f;
    v_ms := round(extract(epoch from clock_timestamp() - t0) * 1000);

    -- The rollup refuses a caller who cannot see the folder: report null then.
    begin
      if p_phase = 'old' then
        select jsonb_build_object(
          'planned_by_today', coalesce(sum(x.planned_by_today), 0),
          'gap', coalesce(sum(x.done), 0) - coalesce(sum(x.planned_by_today), 0)
        ) into v_gap from public.folder_rollup(r.folder_id) x;
      else
        select jsonb_build_object(
          'planned_by_today', coalesce(sum(x.planned_by_today), 0),
          'gap', coalesce(sum(x.done_dated), 0) - coalesce(sum(x.planned_by_today), 0)
        ) into v_gap from public.folder_rollup(r.folder_id) x;
      end if;
    exception when others then
      v_gap := jsonb_build_object('planned_by_today', null, 'gap', null,
                                  'rollup_error', sqlstate);
    end;

    insert into _oor values (
      p_phase, 'folder', r.folder_id, v_uid,
      v || v_gap || jsonb_build_object(
        'ms', v_ms,
        'readable_boards', v_best,
        'boards', (select count(*) from public.folder_boards x where x.folder_id = r.folder_id)));
  end loop;

  -- ── orgs: nobody signed in, as the digest cron runs ──
  perform set_config('request.jwt.claims', '', true);
  for r in
    select i.org_id, count(*) as items
    from public.items i
    where i.archived_at is null
    group by i.org_id
    order by count(*) desc, i.org_id
    limit 5
  loop
    select jsonb_build_object(
      'total', count(*),
      'done', count(*) filter (where f.is_done),
      'overdue', count(*) filter (where f.is_overdue),
      'incomplete', count(*) filter (where f.is_incomplete)
    ) into v
    from public.boards b
    cross join lateral public._board_health_flags(b.id) f
    where b.org_id = r.org_id;

    select jsonb_build_object(
      'boards', count(*),
      'total', coalesce(sum(d.total_items), 0),
      'done', coalesce(sum(d.done_items), 0),
      'overdue_this_week', coalesce(sum(d.overdue_items), 0),
      'incomplete_this_week', coalesce(sum(d.incomplete_items), 0)
    ) into v_gap
    from public._org_health_digest(r.org_id, now() - interval '7 days') d;

    insert into _oor values (
      p_phase, 'org', r.org_id, null,
      jsonb_build_object('health', v, 'digest', v_gap));
  end loop;
end;
$measure$;

-- ════ 1. BEFORE: the functions as they are live ════════════════════════════
select pg_temp._oor_measure('old');

-- ════ 2. MIGRATION BODY ════════════════════════════════════════════════════
-- >>> MIGRATION BODY BEGIN
-- 20261115173751_one_overdue_rule.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   ONE rule for "done", "due" and "overdue" on every surface: the Work
--   tracking rule that public.item_facts already implements (configured done
--   options and due column, else the guesses twinned in
--   src/lib/boards/work-guess.ts). Until now the health widget, the weekly
--   digest and every folder RPC used an older rule (first status column,
--   label ~* '(done|complete)', ANY date cell in the past), so the same board
--   showed different numbers on different pages.
--
--   * _work_time_zone / _work_today (new, internal): "today" is a calendar
--     date in the viewer's zone, then the organisation's, then UTC: the same
--     order as effectiveTimeZone() in src/lib/datetime/timezone.ts (Today,
--     My Work). Bare current_date (the database's zone) is gone from every
--     function below.
--   * _work_item_flags (new, internal): the per-item flags, read FROM
--     public.item_facts. The done / due rule text lives only in that view.
--   * _board_health_flags and _folder_item_flags are re-based on it. Same
--     signatures and return columns. Folder flags are now computed in ONE
--     pass over the folder's boards (before: one _board_health_flags call per
--     board plus six correlated subqueries per item).
--   * Folder due_on and planned_on are now the SAME date: the item's due
--     date. The folder page had two lateness notions (earliest date for
--     Overdue, latest date for the heat map, Due this week, Gap and the
--     planned line); it now has one.
--   * folder_rollup gains ONE column at the end, done_dated (done items that
--     have a due date), so "Gap to plan" can compare like with like:
--     done_dated - planned_by_today. A return-type change, hence drop +
--     create in this one transaction; the deployed client parses rows with a
--     plain z.object, which ignores an extra column.
--   * folder_burn.completed (and imported_done) count dated items only, the
--     same population as its planned line. Signature unchanged.
--   * folder_attention, folder_burn, folder_load: current_date -> today in
--     the viewer's / organisation's zone. Signatures unchanged.
--
--   SUBITEMS: item_facts has a row for every item, subitems included. Every
--   count here stays TOP-LEVEL ONLY (items.parent_id is null), as before, so
--   a parent and its subitems are never counted twice. Today, My Work and
--   query_items list subitems as items in their own right; that difference
--   is deliberate.
--
--   Also changed as a consequence of reading item_facts:
--   * archived items, groups and boards no longer count in
--     _board_health_flags (the health widget and the digest counted them);
--   * "incomplete" means: open and (no owner on a board with a people column,
--     or no due date on a board with a due column). The date half used to
--     look at the first date column by position.
--
--   NOT changed: folder_gallery, folder_workload, folder_burn_packed,
--   _board_health_counts, dashboard_health_summary, _org_health_digest (they
--   only read the flags above), goals / portfolios / dashboard widgets (their
--   own stored done mappings).

-- ── 1. "Today": viewer zone, then organisation zone, then UTC ───────────────
-- An unknown zone name is skipped, never raised: a bad profile or org setting
-- must not take a page down.
create function public._work_time_zone(p_org_id uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_member text;
  v_org text;
  v_tz text;
begin
  select nullif(p.timezone, '') into v_member
    from public.profiles p where p.id = (select auth.uid());
  select nullif(o.timezone, '') into v_org
    from public.organizations o where o.id = p_org_id;
  foreach v_tz in array array[v_member, v_org] loop
    if v_tz is not null then
      begin
        perform now() at time zone v_tz;
        return v_tz;
      exception when others then
        null;
      end;
    end if;
  end loop;
  return 'UTC';
end; $$;

revoke execute on function public._work_time_zone(uuid)
  from public, anon, authenticated;

create function public._work_today(p_org_id uuid)
returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone public._work_time_zone(p_org_id))::date
$$;

revoke execute on function public._work_today(uuid)
  from public, anon, authenticated;

-- ── 2. Per-item flags, read from item_facts ─────────────────────────────────
-- done and due_date come straight from public.item_facts: this function adds
-- no rule of its own for either. overdue = open and due before p_today.
-- TOP-LEVEL ITEMS ONLY (parent_id is null): the health widget, the digest and
-- the folder page count work items, and a parent with five subitems is one
-- item, not six. item_facts already leaves out archived items, groups and
-- boards.
create function public._work_item_flags(p_board_ids uuid[], p_today date)
returns table (
  board_id uuid,
  group_id uuid,
  item_id uuid,
  item_name text,
  item_created_at timestamptz,
  item_updated_at timestamptz,
  status_column_id uuid,
  status_label text,
  has_status boolean,
  is_done boolean,
  due_date date,
  is_overdue boolean,
  has_people_col boolean,
  has_owner boolean,
  owner_ids text[],
  is_incomplete boolean
)
language sql stable security definer set search_path = '' as $$
  with pc as materialized (
    select b.id as board_id,
           (select c.id from public.columns c
             where c.board_id = b.id and c.kind = 'people'
             order by c.position asc, c.id asc limit 1) as people_col
    from (select distinct u.id from unnest(p_board_ids) as u(id)) b
  ),
  base as (
    select
      f.board_id,
      f.group_id,
      f.item_id,
      f.name,
      i.created_at,
      f.updated_at,
      f.status_column_id,
      f.status_label,
      f.is_done,
      f.due_date,
      f.due_column_id,
      (pc.people_col is not null) as has_people_col,
      case when jsonb_typeof(pcv.value -> 'userIds') = 'array'
           then pcv.value -> 'userIds' else '[]'::jsonb end as owners
    from public.item_facts f
    join public.items i on i.id = f.item_id and i.parent_id is null
    join pc on pc.board_id = f.board_id
    left join public.cell_values pcv
      on pcv.item_id = f.item_id and pcv.column_id = pc.people_col
    where f.board_id = any (p_board_ids)
  )
  select
    b.board_id,
    b.group_id,
    b.item_id,
    b.name,
    b.created_at,
    b.updated_at,
    b.status_column_id,
    b.status_label,
    (b.status_label is not null),
    b.is_done,
    b.due_date,
    (not b.is_done and b.due_date is not null and b.due_date < p_today),
    b.has_people_col,
    (jsonb_array_length(b.owners) > 0),
    array(select jsonb_array_elements_text(b.owners)),
    (not b.is_done and (
      (b.has_people_col and jsonb_array_length(b.owners) = 0)
      or (b.due_column_id is not null and b.due_date is null)
    ))
  from base b
$$;

revoke execute on function public._work_item_flags(uuid[], date)
  from public, anon, authenticated;

-- ── 3. Board health flags (health widget, weekly digest) ────────────────────
-- Same signature and columns as 20260727094245. overdue_since stays text (the
-- digest compares it as ISO text): it is the due date, the day the item was
-- due. Top-level items only (see _work_item_flags).
create or replace function public._board_health_flags(p_board_id uuid)
returns table (
  item_id uuid,
  item_name text,
  item_created_at timestamptz,
  is_done boolean,
  is_overdue boolean,
  is_incomplete boolean,
  overdue_since text
)
language sql stable security definer set search_path = '' as $$
  select
    f.item_id,
    f.item_name,
    f.item_created_at,
    f.is_done,
    f.is_overdue,
    f.is_incomplete,
    case when f.is_overdue then f.due_date::text end
  from public._work_item_flags(
    array[p_board_id],
    public._work_today(
      (select b.org_id from public.boards b where b.id = p_board_id))
  ) f
$$;

revoke execute on function public._board_health_flags(uuid)
  from public, anon, authenticated;

-- ── 4. Folder item flags: one pass, one date ────────────────────────────────
-- Same signature and columns as 20260915142403. due_on and planned_on are the
-- same value now (the item's due date); both columns stay so no caller
-- changes. done_on is the status cell's last update, as a date in the same
-- zone "today" is read in. Top-level items only (see _work_item_flags).
create or replace function public._folder_item_flags(p_folder_id uuid)
returns table (
  board_id uuid,
  board_name text,
  board_position integer,
  group_id uuid,
  group_name text,
  group_color text,
  group_position double precision,
  item_id uuid,
  item_name text,
  is_done boolean,
  is_overdue boolean,
  is_incomplete boolean,
  is_blocked boolean,
  has_status boolean,
  has_people_col boolean,
  has_owner boolean,
  due_on date,
  planned_on date,
  done_on date,
  overdue_since date,
  last_touched timestamptz,
  owner_ids text[]
)
language sql stable security definer set search_path = '' as $$
  with fb as materialized (
    select b.id, b.name, fbd.position
    from public.folder_boards fbd
    join public.boards b on b.id = fbd.board_id
    where fbd.folder_id = p_folder_id
      and b.id in (select public._folder_readable_boards(p_folder_id))
  ),
  z as materialized (
    select public._work_time_zone(fo.org_id) as tz
    from public.folders fo
    where fo.id = p_folder_id
  )
  select
    fb.id,
    fb.name,
    fb.position,
    g.id,
    g.name,
    g.color,
    g.position,
    f.item_id,
    f.item_name,
    f.is_done,
    f.is_overdue,
    f.is_incomplete,
    (not f.is_done and coalesce(f.status_label ~* '(blocked|stuck)', false)) as is_blocked,
    f.has_status,
    f.has_people_col,
    f.has_owner,
    f.due_date as due_on,
    f.due_date as planned_on,
    case when f.is_done then
      (select (cv.updated_at at time zone z.tz)::date from public.cell_values cv
        where cv.item_id = f.item_id and cv.column_id = f.status_column_id)
    end as done_on,
    case when f.is_overdue then f.due_date end as overdue_since,
    greatest(
      f.item_updated_at,
      coalesce((select max(cv.updated_at) from public.cell_values cv where cv.item_id = f.item_id), f.item_updated_at)
    ) as last_touched,
    f.owner_ids
  from z
  cross join lateral public._work_item_flags(
    array(select fb.id from fb),
    (now() at time zone z.tz)::date
  ) f
  join fb on fb.id = f.board_id
  join public.groups g on g.id = f.group_id
$$;

revoke execute on function public._folder_item_flags(uuid) from public, anon, authenticated;

-- ── 5. folder_rollup: + done_dated, today in the right zone ─────────────────
-- done_dated = done items that have a due date. "Gap to plan" is
-- done_dated - planned_by_today: both sides count dated items (before, the
-- done side counted every done item, the planned side only dated ones).
drop function if exists public.folder_rollup(uuid);

create function public.folder_rollup(p_folder_id uuid)
returns table (
  board_id uuid,
  board_name text,
  board_position integer,
  group_id uuid,
  group_name text,
  group_color text,
  group_position double precision,
  total integer,
  done integer,
  in_progress integer,
  overdue integer,
  not_started integer,
  blocked integer,
  stale integer,
  unassigned integer,
  incomplete integer,
  planned_by_today integer,
  due_this_week integer,
  due_this_week_not_started integer,
  oldest_overdue date,
  min_due date,
  max_due date,
  done_dated integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_week date;
begin
  perform public._assert_folder_member(p_folder_id);
  select public._work_today(fo.org_id) into v_today
    from public.folders fo where fo.id = p_folder_id;
  v_week := date_trunc('week', v_today)::date;
  return query
  with fb as (
    select b.id, b.name, fbd.position
    from public.folder_boards fbd
    join public.boards b on b.id = fbd.board_id
    where fbd.folder_id = p_folder_id
      and b.id in (select public._folder_readable_boards(p_folder_id))
  ),
  flags as (
    select * from public._folder_item_flags(p_folder_id)
  )
  select
    fb.id,
    fb.name,
    fb.position,
    g.id,
    g.name,
    g.color,
    g.position,
    count(f.item_id)::int,
    count(f.item_id) filter (where f.is_done)::int,
    count(f.item_id) filter (where not f.is_done and not f.is_overdue and f.has_status)::int,
    count(f.item_id) filter (where f.is_overdue)::int,
    count(f.item_id) filter (where not f.is_done and not f.is_overdue and not f.has_status)::int,
    count(f.item_id) filter (where f.is_blocked)::int,
    count(f.item_id) filter (where not f.is_done and f.last_touched < now() - interval '14 days')::int,
    count(f.item_id) filter (where not f.is_done and f.has_people_col and not f.has_owner)::int,
    count(f.item_id) filter (where f.is_incomplete)::int,
    count(f.item_id) filter (where f.planned_on <= v_today)::int,
    count(f.item_id) filter (where not f.is_done
      and f.planned_on >= v_week
      and f.planned_on <  v_week + 7)::int,
    count(f.item_id) filter (where not f.is_done and not f.has_status
      and f.planned_on >= v_week
      and f.planned_on <  v_week + 7)::int,
    min(f.overdue_since) filter (where f.is_overdue),
    min(f.planned_on),
    max(f.planned_on),
    count(f.item_id) filter (where f.is_done and f.planned_on is not null)::int
  from fb
  left join public.groups g on g.board_id = fb.id and g.archived_at is null
  left join flags f on f.group_id = g.id
  group by fb.id, fb.name, fb.position, g.id, g.name, g.color, g.position
  order by fb.position asc, fb.name asc, fb.id asc,
           g.position asc nulls last, g.name asc, g.id asc;
end; $$;

revoke execute on function public.folder_rollup(uuid) from public, anon;
grant execute on function public.folder_rollup(uuid) to authenticated, service_role;

-- ── 6. folder_attention: age in days from today in the right zone ───────────
create or replace function public.folder_attention(p_folder_id uuid, p_limit integer default 20)
returns table (
  item_id uuid,
  item_name text,
  board_id uuid,
  board_name text,
  group_id uuid,
  group_name text,
  reason text,
  age_days integer,
  severity integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_today date;
begin
  perform public._assert_folder_member(p_folder_id);
  select public._work_today(fo.org_id) into v_today
    from public.folders fo where fo.id = p_folder_id;
  return query
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
  )
  select r.item_id, r.item_name, r.board_id, r.board_name, r.group_id, r.group_name,
         r.reason, r.age_days, r.severity
  from reasons r
  order by r.severity desc, r.age_days desc, r.item_name asc, r.item_id asc
  limit v_limit;
end; $$;

revoke execute on function public.folder_attention(uuid, integer) from public, anon;
grant execute on function public.folder_attention(uuid, integer) to authenticated, service_role;

-- ── 7. folder_burn: completed counts dated items; today in the right zone ───
-- DO NOT DROP folder_burn: folder_burn_packed (the RPC the page calls) is a
-- thin wrapper that selects from it. An earlier session note said to drop it
-- after promotion; that would break the burn chart.
--
-- completed / imported_done now count only done items that HAVE a due date:
-- the same population the planned line counts, so completed - planned is the
-- Gap to plan (folder_rollup: done_dated - planned_by_today).
create or replace function public.folder_burn(p_folder_id uuid)
returns table (
  stage_key text,
  week_start date,
  planned integer,
  completed integer,
  imported_done integer,
  overdue_open integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  v_today date;
  v_week date;
begin
  perform public._assert_folder_member(p_folder_id);
  select public._work_time_zone(fo.org_id) into v_tz
    from public.folders fo where fo.id = p_folder_id;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  v_week := date_trunc('week', v_today)::date;
  return query
  with flags as (
    select f.*, (i.created_at at time zone coalesce(v_tz, 'UTC'))::date as created_on
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
    where f.is_done and f.done_on is not null and f.planned_on is not null
  ),
  bounds as (
    select min(e.wk) as min_wk, max(e.wk) as max_wk from ev e
  ),
  span as (
    select
      b.min_wk,
      least(
        greatest(b.max_wk, v_week),
        v_week + 52 * 7
      ) as hi
    from bounds b
  ),
  win as (
    select s.hi,
           least(greatest(s.min_wk, s.hi - 103 * 7), s.hi) as lo
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
    where wks.wk <= v_week
      and wks.wk >= v_week - 12 * 7
      and f.due_on is not null
      and f.due_on < least(wks.wk + 7, v_today)
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

comment on function public.folder_burn(uuid) is
  'Do not drop: folder_burn_packed (the RPC the folder page calls) selects from this function. completed and imported_done count done items that have a due date, the same population as planned.';

-- ── 8. folder_load: week window from today in the right zone ────────────────
create or replace function public.folder_load(
  p_folder_id uuid,
  p_weeks_back integer default 3,
  p_weeks_ahead integer default 3
)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_back integer := least(greatest(coalesce(p_weeks_back, 3), 0), 12);
  v_ahead integer := least(greatest(coalesce(p_weeks_ahead, 3), 0), 12);
  v_this date;
  v_lo date;
  v_hi date;
  v jsonb;
begin
  perform public._assert_folder_member(p_folder_id);
  select date_trunc('week', public._work_today(fo.org_id))::date into v_this
    from public.folders fo where fo.id = p_folder_id;
  v_lo := v_this - v_back * 7;
  v_hi := v_this + v_ahead * 7;
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
-- <<< MIGRATION BODY END

-- ════ 3. AFTER: the same measurements, then the assertions ═════════════════
select pg_temp._oor_measure('new');

do $report$
declare
  r record;
  v_today date;
  v_facts jsonb;
  v_ci bigint;
  v_fs bigint;
  v_failed text[] := '{}';
  v_folders jsonb := '[]'::jsonb;
  v_orgs jsonb := '[]'::jsonb;
  v_new jsonb;
begin
  -- ── folders ──
  for r in
    select o.id as folder_id, o.as_user, o.payload as old, fo.org_id
    from _oor o
    join public.folders fo on fo.id = o.id
    where o.phase = 'old' and o.kind = 'folder'
    order by (o.payload ->> 'total')::bigint desc, o.id
  loop
    select n.payload into strict v_new
    from _oor n where n.phase = 'new' and n.kind = 'folder' and n.id = r.folder_id;

    perform set_config('request.jwt.claims',
      case when r.as_user is null then ''
           else json_build_object('sub', r.as_user::text, 'role', 'authenticated')::text end,
      true);
    v_today := public._work_today(r.org_id);

    -- item_facts, top-level items, the boards this caller can read.
    select jsonb_build_object(
      'total', count(*),
      'done', count(*) filter (where f.is_done),
      'overdue', count(*) filter (where not f.is_done and f.due_date < v_today)
    ) into v_facts
    from public.item_facts f
    join public.items i on i.id = f.item_id and i.parent_id is null
    where f.board_id in (select public._folder_readable_boards(r.folder_id));

    -- count_items lists subitems too: compare it with item_facts on that basis.
    select coalesce(sum(c.item_count), 0) into v_ci
    from public.count_items(
      r.org_id, 'board',
      p_folder_id => r.folder_id,
      p_state => 'open',
      p_due_to => v_today - 1) c
    where c.key in (
      select x::text from public._folder_readable_boards(r.folder_id) x);

    select count(*) into v_fs
    from public.item_facts f
    where f.board_id in (select public._folder_readable_boards(r.folder_id))
      and not f.is_done and f.due_date < v_today;

    if (v_new ->> 'total') is distinct from (v_facts ->> 'total') then
      v_failed := v_failed || format('folder %s total: flags %s, item_facts %s',
        r.folder_id, v_new ->> 'total', v_facts ->> 'total');
    end if;
    if (v_new ->> 'done') is distinct from (v_facts ->> 'done') then
      v_failed := v_failed || format('folder %s done: flags %s, item_facts %s',
        r.folder_id, v_new ->> 'done', v_facts ->> 'done');
    end if;
    if (v_new ->> 'overdue') is distinct from (v_facts ->> 'overdue') then
      v_failed := v_failed || format('folder %s overdue: flags %s, item_facts %s',
        r.folder_id, v_new ->> 'overdue', v_facts ->> 'overdue');
    end if;
    if v_ci is distinct from v_fs then
      v_failed := v_failed || format(
        'folder %s open overdue with subitems: count_items %s, item_facts %s',
        r.folder_id, v_ci, v_fs);
    end if;

    v_folders := v_folders || jsonb_build_object(
      'folder_id', r.folder_id,
      'as_user', r.as_user,
      'today', v_today,
      'boards', r.old -> 'boards',
      'readable_boards', r.old -> 'readable_boards',
      'old', r.old - 'boards' - 'readable_boards',
      'new', v_new - 'boards' - 'readable_boards',
      'facts', v_facts,
      'open_overdue_with_subitems',
        jsonb_build_object('count_items', v_ci, 'item_facts', v_fs));
  end loop;

  -- ── orgs ──
  perform set_config('request.jwt.claims', '', true);
  for r in
    select o.id as org_id, o.payload as old
    from _oor o
    where o.phase = 'old' and o.kind = 'org'
    order by (o.payload -> 'health' ->> 'total')::bigint desc, o.id
  loop
    select n.payload into strict v_new
    from _oor n where n.phase = 'new' and n.kind = 'org' and n.id = r.org_id;
    v_today := public._work_today(r.org_id);

    select jsonb_build_object(
      'total', count(*),
      'done', count(*) filter (where f.is_done),
      'overdue', count(*) filter (where not f.is_done and f.due_date < v_today)
    ) into v_facts
    from public.item_facts f
    join public.items i on i.id = f.item_id and i.parent_id is null
    where f.org_id = r.org_id;

    if (v_new -> 'health' ->> 'total') is distinct from (v_facts ->> 'total')
       or (v_new -> 'health' ->> 'done') is distinct from (v_facts ->> 'done')
       or (v_new -> 'health' ->> 'overdue') is distinct from (v_facts ->> 'overdue') then
      v_failed := v_failed || format('org %s health %s, item_facts %s',
        r.org_id, v_new -> 'health', v_facts);
    end if;

    v_orgs := v_orgs || jsonb_build_object(
      'org_id', r.org_id,
      'today', v_today,
      'old', r.old,
      'new', v_new,
      'facts', v_facts);
  end loop;

  if jsonb_array_length(v_folders) = 0 and jsonb_array_length(v_orgs) = 0 then
    v_failed := v_failed || 'nothing was measured (no folders and no orgs with items)'::text;
  end if;

  raise exception 'ONE_OVERDUE_RULE %', jsonb_build_object(
    'ok', cardinality(v_failed) = 0,
    'failed', to_jsonb(v_failed),
    'folders', v_folders,
    'orgs', v_orgs)::text;
end;
$report$;
