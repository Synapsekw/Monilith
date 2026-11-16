-- dry-run-focus-today-v2.sql
--
-- Old vs new Today list for supabase/migrations/20261116112326_focus_today_v2.sql
-- on LIVE data, with nothing kept.
--
-- HOW TO RUN: send this whole file as ONE batch through the supabase-dev MCP
-- `execute_sql` (one implicit transaction). Do NOT apply the migration first:
-- its body is included below. The batch ENDS with
-- `raise exception 'FOCUS_TODAY_V2 %', <json>`, which rolls the whole
-- transaction back: the function and every setting. There is no
-- begin / commit / rollback in this file on purpose.
--
-- The error message IS the report:
--   { "ok": true|false, "failed": [...],
--     "anon_can_execute": false, "authenticated_can_execute": true,
--     "users": [ { org_id, user_id, today,
--                  old: { n, by_tier, due_today_on_page, ms },
--                  new: { n, by_tier, tier_totals, due_today_on_page,
--                         editable_rows, ms } } ] }
-- "ok": false means an assertion in "failed" did not hold; read it before
-- applying anything. Ids and counts only: no names leave the database.
--
-- Who is measured: the five (org, member) pairs with the most open assigned
-- items, each read as that member (request.jwt.claims), limit 50, "today"
-- from public._work_today(org).
--
-- What it asserts, per member:
--   * new rows come in tier order; every tier 0 row is due today; every
--     tier 1 row is due before today and tier 1 runs most recent first;
--   * when the old list was not cut by the limit, old and new hold exactly
--     the same items (v2 reorders and relabels, it never adds or drops);
--   * the new overdue total equals the old one whenever the old list reports
--     it (the overdue set did not change, only its order);
--   * tier_totals add up to at least the rows returned, and to exactly the
--     rows returned when the list was not cut;
--   * can_edit equals public.can_edit_board(board_id) on every row, and
--     has_status / has_due match public.item_facts;
-- and once: anon cannot execute the new function, authenticated can.
--
-- The migration body below must stay a verbatim copy of the migration file;
-- src/lib/focus/focus-today-v2.sql.test.ts fails when they differ.

select set_config('statement_timeout', '120s', true);
select set_config('lock_timeout', '5s', true);

-- ── migration body (verbatim) ──────────────────────────────────────────────
create or replace function public.get_focus_today_v2(
  p_org_id uuid,
  p_today date,
  p_folder_id uuid default null,
  p_stall_days int default 5,
  p_limit int default 20
)
returns table (
  item_id uuid,
  item_name text,
  board_id uuid,
  board_name text,
  group_name text,
  status_label text,
  due_date date,
  tier int,
  days_overdue int,
  waiting_count int,
  waiting jsonb,
  unread_count int,
  days_quiet int,
  tier_totals jsonb,
  can_edit boolean,
  has_status boolean,
  has_due boolean
)
language plpgsql
stable
security invoker
set search_path = ''
set plan_cache_mode = force_custom_plan
as $func$
#variable_conflict use_column
begin
  return query
  with me as (
    select (select auth.uid()) as uid
  ),
  scope_boards as (
    select b.id
    from public.boards b
    where b.org_id = p_org_id
      and b.archived_at is null
      and (
        p_folder_id is null
        or exists (
          select 1 from public.folder_boards fb
          where fb.folder_id = p_folder_id and fb.board_id = b.id
        )
      )
  ),
  mine_ids as materialized (
    select distinct a as item_id
    from public.items_assigned_to((select m.uid from me m)) a
  ),
  unread as materialized (
    select n.item_id,
           count(*)::int as unread_count,
           max(n.created_at) as newest
    from public.notifications n
    where n.recipient_id = (select m.uid from me m)
      and n.read_at is null
      and n.org_id = p_org_id
      and n.item_id is not null
      and n.kind in ('mention', 'update_on_item')
    group by n.item_id
  ),
  succ_ids as materialized (
    select d.predecessor_id, d.successor_id
    from public.item_dependencies d
    where d.predecessor_id in (select mi.item_id from mine_ids mi)
  ),
  facts as materialized (
    select f.*, (mi.item_id is not null) as is_mine
    from public.item_facts f
    left join mine_ids mi on mi.item_id = f.item_id
    where f.org_id = p_org_id
      and (
        mi.item_id is not null
        or f.item_id in (select u.item_id from unread u)
        or f.item_id in (select s.successor_id from succ_ids s)
      )
  ),
  mine as materialized (
    select f.item_id, f.board_id, f.group_id, f.name, f.status_label, f.due_date,
           f.status_column_id, f.due_column_id
    from facts f
    where f.is_mine
      and not f.is_done
      and f.board_id in (select sb.id from scope_boards sb)
  ),
  candidates as (
    select m.item_id, m.board_id, m.group_id, m.name, m.status_label,
           m.due_date, m.status_column_id, m.due_column_id, true as assigned
    from mine m
    union all
    select f.item_id, f.board_id, f.group_id, f.name, f.status_label,
           f.due_date, f.status_column_id, f.due_column_id, false as assigned
    from facts f
    join unread u on u.item_id = f.item_id
    where not f.is_done
      and f.board_id in (select sb.id from scope_boards sb)
      and not exists (select 1 from mine m where m.item_id = f.item_id)
  ),
  succ as materialized (
    select s.predecessor_id, sf.item_id, sf.name, sf.due_date
    from succ_ids s
    join facts sf on sf.item_id = s.successor_id and not sf.is_done
    where s.predecessor_id in (select m.item_id from mine m)
  ),
  people as materialized (
    -- Same elements as public.item_assignee_ids, for every successor at once.
    select cv.item_id, jsonb_agg(distinct u.id) as ids
    from public.cell_values cv
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(cv.value -> 'userIds') = 'array'
           then cv.value -> 'userIds' else '[]'::jsonb end
    ) as u(id)
    where cv.item_id in (select s.item_id from succ s)
      and cv.value ? 'userIds'
      and u.id is not null
    group by cv.item_id
  ),
  waiting as (
    select s.predecessor_id as item_id,
           count(*)::int as waiting_count,
           jsonb_path_query_array(
             jsonb_agg(
               jsonb_build_object(
                 'itemId', s.item_id,
                 'name', s.name,
                 'assigneeIds', coalesce(pe.ids, '[]'::jsonb)
               )
               order by s.due_date nulls last, s.item_id
             ),
             '$[0 to 1]'
           ) as waiting
    from succ s
    left join people pe on pe.item_id = s.item_id
    where exists (
      select 1
      from jsonb_array_elements_text(coalesce(pe.ids, '[]'::jsonb)) as x(id)
      where x.id <> (select m.uid from me m)::text
    )
    group by s.predecessor_id
  ),
  pre as materialized (
    -- Tiers 0-4 need no activity data. Tier 0 (due today) comes first and
    -- wins over every other reason; "due soon" (3) is tomorrow and the day
    -- after.
    select c.*,
           coalesce(w.waiting_count, 0) as waiting_count,
           coalesce(w.waiting, '[]'::jsonb) as waiting,
           coalesce(u.unread_count, 0) as unread_count,
           u.newest,
           case
             when c.assigned and c.due_date = p_today then 0
             when c.assigned and c.due_date < p_today then 1
             when c.assigned and coalesce(w.waiting_count, 0) > 0 then 2
             when c.assigned and c.due_date between p_today + 1 and p_today + 2 then 3
             when coalesce(u.unread_count, 0) > 0 then 4
           end as tier_a
    from candidates c
    left join waiting w on w.item_id = c.item_id
    left join unread u on u.item_id = c.item_id
  ),
  need_quiet as materialized (
    select p.item_id from pre p where p.assigned and p.tier_a is null
  ),
  quiet as materialized (
    select nq.item_id,
           greatest(
             (select a.created_at from public.item_activities a
               where a.item_id = nq.item_id
               order by a.created_at desc limit 1),
             (select u.created_at from public.item_updates u
               where u.item_id = nq.item_id
               order by u.created_at desc limit 1)
           ) as last_at,
           exists (
             select 1 from public.item_activities a
             where a.item_id = nq.item_id and a.action <> 'item_created'
           ) as worked
    from need_quiet nq
  ),
  tiered as materialized (
    select p.*,
           q.last_at,
           coalesce(
             p.tier_a,
             case
               when p.assigned and q.worked
                    and q.last_at < (p_today - greatest(p_stall_days, 1))::timestamptz
                 then 5
             end
           ) as tier
    from pre p
    left join quiet q on q.item_id = p.item_id
  ),
  tier_counts as (
    -- Every tier's total, counted BEFORE the limit, so a tier the limit cut
    -- off still reports its true size.
    select t.tier, count(*)::int as n
    from tiered t
    where t.tier is not null
    group by t.tier
  ),
  ranked as materialized (
    select
      t.item_id, t.name as item_name, t.board_id, b.name as board_name,
      g.name as group_name, t.status_label, t.due_date, t.tier,
      case when t.due_date < p_today then p_today - t.due_date end as days_overdue,
      t.waiting_count, t.waiting, t.unread_count, t.assigned,
      (t.status_column_id is not null) as has_status,
      (t.due_column_id is not null) as has_due,
      case t.tier
        -- Due today: whoever has people waiting first.
        when 0 then -(t.waiting_count)::double precision
        -- Overdue: most recently overdue first.
        when 1 then -(t.due_date - date '2000-01-01')::double precision
        when 2 then -(t.waiting_count)::double precision
        when 3 then (t.due_date - date '2000-01-01')::double precision
        when 4 then -extract(epoch from t.newest)::double precision
        when 5 then extract(epoch from t.last_at)::double precision
      end as sk
    from tiered t
    join public.boards b on b.id = t.board_id
    left join public.groups g on g.id = t.group_id
    where t.tier is not null
    order by t.tier, sk, t.item_id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ),
  edits as materialized (
    -- One permission check per board on the returned page, not per row.
    select d.board_id, public.can_edit_board(d.board_id) as can_edit
    from (select distinct r.board_id from ranked r) d
  )
  select
    r.item_id, r.item_name, r.board_id, r.board_name, r.group_name,
    r.status_label, r.due_date, r.tier, r.days_overdue, r.waiting_count,
    r.waiting, r.unread_count,
    -- days_quiet for the returned page only (<= 50 rows).
    case when r.assigned and lq.last_at is not null
         then p_today - lq.last_at::date end as days_quiet,
    coalesce(
      (select jsonb_object_agg(tc.tier::text, tc.n) from tier_counts tc),
      '{}'::jsonb
    ) as tier_totals,
    coalesce(e.can_edit, false) as can_edit,
    r.has_status,
    r.has_due
  from ranked r
  left join edits e on e.board_id = r.board_id
  left join lateral (
    select greatest(
      (select max(a.created_at) from public.item_activities a
        where a.item_id = r.item_id),
      (select max(u.created_at) from public.item_updates u
        where u.item_id = r.item_id)
    ) as last_at
    where r.assigned
  ) lq on true
  order by r.tier, r.sk, r.item_id;
end
$func$;

revoke execute on function public.get_focus_today_v2(uuid, date, uuid, int, int) from public, anon;
grant execute on function public.get_focus_today_v2(uuid, date, uuid, int, int) to authenticated, service_role;

-- ── measurement and report ─────────────────────────────────────────────────
do $report$
declare
  r record;
  v_today date;
  v_old jsonb;
  v_new jsonb;
  v_failed text[] := '{}';
  v_users jsonb := '[]'::jsonb;
  t0 timestamptz;
  v_ms_old numeric;
  v_ms_new numeric;
  v_old_n int;
  v_new_n int;
  v_totals jsonb;
  v_sum int;
  v_bad int;
  v_old_overdue int;
  v_anon boolean;
  v_auth boolean;
  c_sig constant text := 'public.get_focus_today_v2(uuid,date,uuid,integer,integer)';
begin
  for r in
    select om.org_id, om.user_id, count(*) as open_items
    from public.org_members om
    join lateral public.items_assigned_to(om.user_id) a on true
    join public.item_facts f
      on f.item_id = a and f.org_id = om.org_id and not f.is_done
    group by om.org_id, om.user_id
    order by count(*) desc, om.org_id, om.user_id
    limit 5
  loop
    perform set_config('request.jwt.claims', '', true);
    v_today := public._work_today(r.org_id);
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.user_id::text, 'role', 'authenticated')::text, true);

    t0 := clock_timestamp();
    select coalesce(jsonb_agg(jsonb_build_object(
             'rn', o.rn, 'item_id', o.item_id, 'tier', o.tier,
             'due_date', o.due_date, 'tier_total', o.tier_total) order by o.rn),
           '[]'::jsonb)
      into v_old
    from (
      select row_number() over () as rn, x.item_id, x.tier, x.due_date, x.tier_total
      from public.get_focus_today(r.org_id, v_today, null, 5, 50) x
    ) o;
    v_ms_old := round(extract(epoch from clock_timestamp() - t0) * 1000);

    t0 := clock_timestamp();
    select coalesce(jsonb_agg(jsonb_build_object(
             'rn', n.rn, 'item_id', n.item_id, 'tier', n.tier,
             'due_date', n.due_date, 'board_id', n.board_id,
             'tier_totals', n.tier_totals, 'can_edit', n.can_edit,
             'has_status', n.has_status, 'has_due', n.has_due) order by n.rn),
           '[]'::jsonb)
      into v_new
    from (
      select row_number() over () as rn, x.item_id, x.tier, x.due_date,
             x.board_id, x.tier_totals, x.can_edit, x.has_status, x.has_due
      from public.get_focus_today_v2(r.org_id, v_today, null, 5, 50) x
    ) n;
    v_ms_new := round(extract(epoch from clock_timestamp() - t0) * 1000);

    v_old_n := jsonb_array_length(v_old);
    v_new_n := jsonb_array_length(v_new);
    v_totals := coalesce(v_new -> 0 -> 'tier_totals', '{}'::jsonb);

    -- Tier order.
    select count(*) into v_bad
    from (
      select (e ->> 'tier')::int as tier,
             lag((e ->> 'tier')::int) over (order by (e ->> 'rn')::int) as prev
      from jsonb_array_elements(v_new) e
    ) s
    where s.prev is not null and s.tier < s.prev;
    if v_bad > 0 then
      v_failed := v_failed || format('user %s: %s rows out of tier order', r.user_id, v_bad);
    end if;

    -- Tier 0 is due today; tier 1 is due before today.
    select count(*) into v_bad
    from jsonb_array_elements(v_new) e
    where ((e ->> 'tier')::int = 0 and (e ->> 'due_date')::date is distinct from v_today)
       or ((e ->> 'tier')::int = 1 and not coalesce((e ->> 'due_date')::date < v_today, false));
    if v_bad > 0 then
      v_failed := v_failed || format('user %s: %s rows in tier 0/1 with the wrong due date', r.user_id, v_bad);
    end if;

    -- Tier 1 runs most recent first.
    select count(*) into v_bad
    from (
      select (e ->> 'due_date')::date as due,
             lag((e ->> 'due_date')::date) over (order by (e ->> 'rn')::int) as prev
      from jsonb_array_elements(v_new) e
      where (e ->> 'tier')::int = 1
    ) s
    where s.prev is not null and s.due > s.prev;
    if v_bad > 0 then
      v_failed := v_failed || format('user %s: overdue rows not most recent first (%s)', r.user_id, v_bad);
    end if;

    -- Same items when the old list was complete.
    if v_old_n < 50 then
      select count(*) into v_bad
      from (
        select o ->> 'item_id' as id from jsonb_array_elements(v_old) o
      ) a
      full join (
        select n ->> 'item_id' as id from jsonb_array_elements(v_new) n
      ) b on a.id = b.id
      where a.id is null or b.id is null;
      if v_bad > 0 or v_new_n <> v_old_n then
        v_failed := v_failed || format('user %s: old list (%s) and new list (%s) differ in %s items',
          r.user_id, v_old_n, v_new_n, v_bad);
      end if;
    end if;

    -- The overdue set is unchanged.
    select max((o ->> 'tier_total')::int) into v_old_overdue
    from jsonb_array_elements(v_old) o
    where (o ->> 'tier')::int = 1;
    if v_old_overdue is not null
       and v_old_overdue is distinct from (v_totals ->> '1')::int then
      v_failed := v_failed || format('user %s: overdue total old %s, new %s',
        r.user_id, v_old_overdue, v_totals ->> '1');
    end if;

    -- tier_totals against the rows returned.
    select coalesce(sum(t.value::int), 0) into v_sum from jsonb_each_text(v_totals) t;
    if v_sum < v_new_n or (v_new_n < 50 and v_sum <> v_new_n) then
      v_failed := v_failed || format('user %s: tier_totals add up to %s for %s rows',
        r.user_id, v_sum, v_new_n);
    end if;

    -- can_edit, has_status, has_due (still as this member).
    select count(*) into v_bad
    from jsonb_array_elements(v_new) e
    where (e ->> 'can_edit')::boolean
          is distinct from public.can_edit_board((e ->> 'board_id')::uuid);
    if v_bad > 0 then
      v_failed := v_failed || format('user %s: can_edit differs from can_edit_board on %s rows', r.user_id, v_bad);
    end if;

    select count(*) into v_bad
    from jsonb_array_elements(v_new) e
    left join public.item_facts f on f.item_id = (e ->> 'item_id')::uuid
    where (e ->> 'has_status')::boolean is distinct from (f.status_column_id is not null)
       or (e ->> 'has_due')::boolean is distinct from (f.due_column_id is not null);
    if v_bad > 0 then
      v_failed := v_failed || format('user %s: has_status / has_due differ from item_facts on %s rows', r.user_id, v_bad);
    end if;

    v_users := v_users || jsonb_build_object(
      'org_id', r.org_id,
      'user_id', r.user_id,
      'today', v_today,
      'open_items', r.open_items,
      'old', jsonb_build_object(
        'n', v_old_n,
        'by_tier', (select coalesce(jsonb_object_agg(s.tier, s.n), '{}'::jsonb)
                    from (select o ->> 'tier' as tier, count(*) as n
                          from jsonb_array_elements(v_old) o group by 1) s),
        'due_today_on_page', (select count(*) from jsonb_array_elements(v_old) o
                              where (o ->> 'due_date')::date = v_today),
        'ms', v_ms_old),
      'new', jsonb_build_object(
        'n', v_new_n,
        'by_tier', (select coalesce(jsonb_object_agg(s.tier, s.n), '{}'::jsonb)
                    from (select e ->> 'tier' as tier, count(*) as n
                          from jsonb_array_elements(v_new) e group by 1) s),
        'tier_totals', v_totals,
        'due_today_on_page', (select count(*) from jsonb_array_elements(v_new) e
                              where (e ->> 'due_date')::date = v_today),
        'editable_rows', (select count(*) from jsonb_array_elements(v_new) e
                          where (e ->> 'can_edit')::boolean),
        'ms', v_ms_new));
  end loop;

  perform set_config('request.jwt.claims', '', true);

  v_anon := has_function_privilege('anon', c_sig, 'execute');
  v_auth := has_function_privilege('authenticated', c_sig, 'execute');
  if v_anon then
    v_failed := v_failed || 'anon can execute get_focus_today_v2'::text;
  end if;
  if not v_auth then
    v_failed := v_failed || 'authenticated cannot execute get_focus_today_v2'::text;
  end if;
  if jsonb_array_length(v_users) = 0 then
    v_failed := v_failed || 'nothing was measured (no member with open assigned items)'::text;
  end if;

  raise exception 'FOCUS_TODAY_V2 %', jsonb_build_object(
    'ok', cardinality(v_failed) = 0,
    'failed', to_jsonb(v_failed),
    'anon_can_execute', v_anon,
    'authenticated_can_execute', v_auth,
    'users', v_users)::text;
end;
$report$;
