-- Filtered item reads over item_facts (spec 4.6). One base function holds the
-- filters; query_items pages it, count_items groups it.

create or replace function public.query_items_base(
  p_org_id uuid,
  p_board_id uuid default null,
  p_folder_id uuid default null,
  p_group_id uuid default null,
  p_assignee uuid default null,
  p_unassigned boolean default false,
  p_state text default 'open',
  p_due_from date default null,
  p_due_to date default null,
  p_updated_since timestamptz default null
)
returns table (
  item_id uuid,
  board_id uuid,
  group_id uuid,
  name text,
  status_label text,
  is_done boolean,
  due_date date,
  last_change timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $func$
  select *
  from (
    select
      f.item_id, f.board_id, f.group_id, f.name, f.status_label, f.is_done,
      f.due_date,
      greatest(
        f.updated_at,
        (select max(a.created_at) from public.item_activities a
          where a.item_id = f.item_id),
        (select max(u.created_at) from public.item_updates u
          where u.item_id = f.item_id)
      ) as last_change
    from public.item_facts f
    where f.org_id = p_org_id
      and (p_board_id is null or f.board_id = p_board_id)
      and (
        p_folder_id is null
        or exists (
          select 1 from public.folder_boards fb
          where fb.folder_id = p_folder_id and fb.board_id = f.board_id
        )
      )
      and (p_group_id is null or f.group_id = p_group_id)
      and (
        p_state = 'any'
        or (p_state = 'open' and not f.is_done)
        or (p_state = 'done' and f.is_done)
      )
      and (p_due_from is null or f.due_date >= p_due_from)
      and (p_due_to is null or f.due_date <= p_due_to)
      and (
        p_assignee is null
        or f.item_id in (select a from public.items_assigned_to(p_assignee) a)
      )
      and (
        not coalesce(p_unassigned, false)
        or public.item_assignee_ids(f.item_id) = '[]'::jsonb
      )
  ) s
  where p_updated_since is null or s.last_change >= p_updated_since
$func$;

revoke execute on function public.query_items_base(uuid, uuid, uuid, uuid, uuid, boolean, text, date, date, timestamptz) from public, anon;
grant execute on function public.query_items_base(uuid, uuid, uuid, uuid, uuid, boolean, text, date, date, timestamptz) to authenticated, service_role;

create or replace function public.query_items(
  p_org_id uuid,
  p_board_id uuid default null,
  p_folder_id uuid default null,
  p_group_id uuid default null,
  p_assignee uuid default null,
  p_unassigned boolean default false,
  p_state text default 'open',
  p_due_from date default null,
  p_due_to date default null,
  p_updated_since timestamptz default null,
  p_sort text default 'due',
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  item_id uuid,
  item_name text,
  board_id uuid,
  board_name text,
  group_name text,
  status_label text,
  is_done boolean,
  due_date date,
  last_change timestamptz,
  assignee_ids jsonb,
  total int
)
language sql
stable
security invoker
set search_path = ''
as $func$
  with page as (
    select q.*, (count(*) over ())::int as total
    from public.query_items_base(
      p_org_id, p_board_id, p_folder_id, p_group_id, p_assignee,
      p_unassigned, p_state, p_due_from, p_due_to, p_updated_since
    ) q
    order by
      case when p_sort = 'updated' then q.last_change end desc nulls last,
      case when p_sort <> 'updated' then q.due_date end asc nulls last,
      q.item_id
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
    offset least(greatest(coalesce(p_offset, 0), 0), 1000)
  )
  select
    p.item_id, p.name, p.board_id, b.name, g.name, p.status_label, p.is_done,
    p.due_date, p.last_change, public.item_assignee_ids(p.item_id), p.total
  from page p
  join public.boards b on b.id = p.board_id
  left join public.groups g on g.id = p.group_id
  order by
    case when p_sort = 'updated' then p.last_change end desc nulls last,
    case when p_sort <> 'updated' then p.due_date end asc nulls last,
    p.item_id
$func$;

revoke execute on function public.query_items(uuid, uuid, uuid, uuid, uuid, boolean, text, date, date, timestamptz, text, int, int) from public, anon;
grant execute on function public.query_items(uuid, uuid, uuid, uuid, uuid, boolean, text, date, date, timestamptz, text, int, int) to authenticated, service_role;

create or replace function public.count_items(
  p_org_id uuid,
  p_count_by text,
  p_board_id uuid default null,
  p_folder_id uuid default null,
  p_group_id uuid default null,
  p_assignee uuid default null,
  p_unassigned boolean default false,
  p_state text default 'open',
  p_due_from date default null,
  p_due_to date default null,
  p_updated_since timestamptz default null
)
returns table (key text, label text, item_count int)
language sql
stable
security invoker
set search_path = ''
as $func$
  with base as (
    select * from public.query_items_base(
      p_org_id, p_board_id, p_folder_id, p_group_id, p_assignee,
      p_unassigned, p_state, p_due_from, p_due_to, p_updated_since
    )
  )
  select b.id::text, b.name, count(*)::int
  from base q join public.boards b on b.id = q.board_id
  where p_count_by = 'board'
  group by b.id, b.name
  union all
  select coalesce(q.status_label, ''), coalesce(q.status_label, 'No status'), count(*)::int
  from base q
  where p_count_by = 'status'
  group by q.status_label
  union all
  select x.id, null::text, count(*)::int
  from base q
  cross join lateral jsonb_array_elements_text(
    case when public.item_assignee_ids(q.item_id) = '[]'::jsonb
         then '[""]'::jsonb else public.item_assignee_ids(q.item_id) end
  ) as x(id)
  where p_count_by = 'assignee'
  group by x.id
  order by 3 desc, 2 nulls last
  limit 100
$func$;

revoke execute on function public.count_items(uuid, text, uuid, uuid, uuid, uuid, boolean, text, date, date, timestamptz) from public, anon;
grant execute on function public.count_items(uuid, text, uuid, uuid, uuid, uuid, boolean, text, date, date, timestamptz) to authenticated, service_role;

-- My Work, rebuilt on item_facts: open items only, one org, ordered BEFORE
-- the limit. Replaces get_my_work_items, which is left in place until no
-- deployed build calls it.
create or replace function public.get_my_open_work(
  p_org_id uuid,
  p_limit int default 500
)
returns table (
  item_id uuid,
  item_name text,
  board_id uuid,
  board_name text,
  group_name text,
  due_date text,
  status_label text,
  status_color text
)
language sql
stable
security invoker
set search_path = ''
as $func$
  select
    f.item_id, f.name, f.board_id, b.name, g.name,
    f.due_date::text, f.status_label, f.status_color
  from public.item_facts f
  join public.boards b on b.id = f.board_id
  left join public.groups g on g.id = f.group_id
  where f.org_id = p_org_id
    and not f.is_done
    and f.item_id in (
      select a from public.items_assigned_to((select auth.uid())) a
    )
  order by f.due_date asc nulls last, f.item_id
  limit least(greatest(coalesce(p_limit, 500), 1), 500)
$func$;

revoke execute on function public.get_my_open_work(uuid, int) from public, anon;
grant execute on function public.get_my_open_work(uuid, int) to authenticated, service_role;
