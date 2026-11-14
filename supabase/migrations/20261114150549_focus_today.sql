-- Ranked "what should I do today" for the calling user (spec 4.4).
-- Tiering, ordering and the limit all happen here: nothing is classified
-- after the limit. Identity is auth.uid() inside the function.
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
language sql
stable
security invoker
set search_path = ''
as $func$
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
  mine as (
    select f.*
    from public.item_facts f
    where f.org_id = p_org_id
      and not f.is_done
      and f.board_id in (select sb.id from scope_boards sb)
      and f.item_id in (
        select a from public.items_assigned_to((select m.uid from me m)) a
      )
  ),
  unread as (
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
  candidates as (
    select m.item_id, m.board_id, m.group_id, m.name, m.status_label,
           m.due_date, true as assigned
    from mine m
    union all
    select f.item_id, f.board_id, f.group_id, f.name, f.status_label,
           f.due_date, false as assigned
    from public.item_facts f
    join unread u on u.item_id = f.item_id
    where f.org_id = p_org_id
      and not f.is_done
      and f.board_id in (select sb.id from scope_boards sb)
      and f.item_id not in (select m.item_id from mine m)
  ),
  succ as (
    select d.predecessor_id,
           s.item_id,
           s.name,
           s.due_date,
           public.item_assignee_ids(s.item_id) as assignee_ids
    from public.item_dependencies d
    join public.item_facts s
      on s.item_id = d.successor_id and not s.is_done
    where d.predecessor_id in (select m.item_id from mine m)
  ),
  waiting as (
    select s.predecessor_id as item_id,
           count(*)::int as waiting_count,
           jsonb_path_query_array(
             jsonb_agg(
               jsonb_build_object(
                 'itemId', s.item_id,
                 'name', s.name,
                 'assigneeIds', s.assignee_ids
               )
               order by s.due_date nulls last, s.item_id
             ),
             '$[0 to 1]'
           ) as waiting
    from succ s
    where exists (
      select 1
      from jsonb_array_elements_text(s.assignee_ids) as x(id)
      where x.id <> (select m.uid from me m)::text
    )
    group by s.predecessor_id
  ),
  quiet as (
    select c.item_id,
           greatest(
             (select max(a.created_at) from public.item_activities a
               where a.item_id = c.item_id),
             (select max(u.created_at) from public.item_updates u
               where u.item_id = c.item_id)
           ) as last_at,
           exists (
             select 1 from public.item_activities a
             where a.item_id = c.item_id and a.action <> 'item_created'
           ) as worked
    from candidates c
    where c.assigned
  ),
  tiered as (
    select c.*,
           coalesce(w.waiting_count, 0) as waiting_count,
           coalesce(w.waiting, '[]'::jsonb) as waiting,
           coalesce(u.unread_count, 0) as unread_count,
           u.newest,
           q.last_at,
           case
             when c.assigned and c.due_date < p_today then 1
             when c.assigned and coalesce(w.waiting_count, 0) > 0 then 2
             when c.assigned and c.due_date between p_today and p_today + 2 then 3
             when coalesce(u.unread_count, 0) > 0 then 4
             when c.assigned and coalesce(q.worked, false)
                  and q.last_at < (p_today - greatest(p_stall_days, 1))::timestamptz
               then 5
           end as tier
    from candidates c
    left join waiting w on w.item_id = c.item_id
    left join unread u on u.item_id = c.item_id
    left join quiet q on q.item_id = c.item_id
  )
  select
    t.item_id,
    t.name as item_name,
    t.board_id,
    b.name as board_name,
    g.name as group_name,
    t.status_label,
    t.due_date,
    t.tier,
    case when t.due_date < p_today then p_today - t.due_date end as days_overdue,
    t.waiting_count,
    t.waiting,
    t.unread_count,
    case when t.last_at is not null then p_today - t.last_at::date end as days_quiet,
    (count(*) over (partition by t.tier))::int as tier_total
  from tiered t
  join public.boards b on b.id = t.board_id
  left join public.groups g on g.id = t.group_id
  where t.tier is not null
  order by
    t.tier,
    case t.tier
      when 1 then (t.due_date - date '2000-01-01')::double precision
      when 2 then -(t.waiting_count)::double precision
      when 3 then (t.due_date - date '2000-01-01')::double precision
      when 4 then -extract(epoch from t.newest)::double precision
      when 5 then extract(epoch from t.last_at)::double precision
    end,
    t.item_id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$func$;

revoke execute on function public.get_focus_today(uuid, date, uuid, int, int) from public, anon;
grant execute on function public.get_focus_today(uuid, date, uuid, int, int) to authenticated, service_role;
