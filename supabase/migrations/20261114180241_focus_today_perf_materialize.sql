-- Third performance pass on get_focus_today (same signature, columns, tiers,
-- ordering, limit clamp and grants). Diagnosis from EXPLAIN ANALYZE: the
-- non-materialised `quiet` CTE was inlined, so the planner joined it to `pre`
-- with a nested loop whose join filter evaluated the per-item activity
-- subqueries once per candidate PAIR (82,410 executions, ~550 ms). Marking
-- `quiet` MATERIALIZED evaluates it once per item.
create or replace function public.get_focus_today(
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
  tier_total int
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
    select f.item_id, f.board_id, f.group_id, f.name, f.status_label, f.due_date
    from facts f
    where f.is_mine
      and not f.is_done
      and f.board_id in (select sb.id from scope_boards sb)
  ),
  candidates as (
    select m.item_id, m.board_id, m.group_id, m.name, m.status_label,
           m.due_date, true as assigned
    from mine m
    union all
    select f.item_id, f.board_id, f.group_id, f.name, f.status_label,
           f.due_date, false as assigned
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
    -- Tiers 1-4 need no activity data.
    select c.*,
           coalesce(w.waiting_count, 0) as waiting_count,
           coalesce(w.waiting, '[]'::jsonb) as waiting,
           coalesce(u.unread_count, 0) as unread_count,
           u.newest,
           case
             when c.assigned and c.due_date < p_today then 1
             when c.assigned and coalesce(w.waiting_count, 0) > 0 then 2
             when c.assigned and c.due_date between p_today and p_today + 2 then 3
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
  tiered as (
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
  ranked as (
    select
      t.item_id, t.name as item_name, t.board_id, b.name as board_name,
      g.name as group_name, t.status_label, t.due_date, t.tier,
      case when t.due_date < p_today then p_today - t.due_date end as days_overdue,
      t.waiting_count, t.waiting, t.unread_count, t.assigned,
      (count(*) over (partition by t.tier))::int as tier_total,
      case t.tier
        when 1 then (t.due_date - date '2000-01-01')::double precision
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
  )
  select
    r.item_id, r.item_name, r.board_id, r.board_name, r.group_name,
    r.status_label, r.due_date, r.tier, r.days_overdue, r.waiting_count,
    r.waiting, r.unread_count,
    -- days_quiet for the returned page only (<= 50 rows).
    case when r.assigned and lq.last_at is not null
         then p_today - lq.last_at::date end as days_quiet,
    r.tier_total
  from ranked r
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

revoke execute on function public.get_focus_today(uuid, date, uuid, int, int) from public, anon;
grant execute on function public.get_focus_today(uuid, date, uuid, int, int) to authenticated, service_role;
