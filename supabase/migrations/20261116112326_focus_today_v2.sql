-- 20261116112326_focus_today_v2.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds public.get_focus_today_v2, the Today list with a new order and three
--   facts the row actions need. public.get_focus_today is left untouched, so
--   the app already deployed keeps working; new app code calls v2 and falls
--   back to the old function while v2 does not exist yet. The old function
--   can be dropped once no deployed build calls it.
--
--   Differences from get_focus_today (same arguments, same candidates, same
--   limit clamp of 1..50, security invoker):
--   * tier 0 "due today" is new and comes first (assigned, due = p_today);
--     it wins over blocking. Tier 3 "due soon" is now tomorrow and the day
--     after only.
--   * tier 1 "overdue" is ordered most recently overdue first (was oldest
--     first), so the limit keeps the fresh ones.
--   * tier_totals (jsonb, tier -> count) replaces tier_total: every tier's
--     size counted before the limit, on every row, so a tier that was cut
--     off is still counted.
--   * can_edit: public.can_edit_board for the row's board, evaluated once per
--     board on the returned page.
--   * has_status / has_due: whether the board has a status column / a due
--     date column under the item_facts rule (what "mark done" and "change
--     due date" would write to).
--   The order is applied BEFORE the limit, in SQL, so nothing is classified
--   in the app after rows were cut.

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
