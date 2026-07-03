-- Health summary widget + digest vocabulary (MVP Final item 8).
-- Rule semantics mirror src/lib/boards/overdue.ts exactly (the shipped tint):
--   done      ⇔ first status column's option label ~* '(done|complete)'
--   overdue   ⇔ any date-kind cell with coalesce(end, date) < today, and not done
--   incomplete⇔ not done AND (owner missing in first people column OR date missing
--               in first date column); each criterion skipped when the board has
--               no column of that kind. Top-level items only (parent_id is null).
-- NOTE: added enum values must NOT be used later in this same migration
-- (PG allows ADD VALUE in a transaction only if unused within it) — they aren't.

alter type public.widget_kind add value if not exists 'health';
alter type public.notification_kind add value if not exists 'health_digest';

-- Digest notifications carry their numbers inline (rendered client-side without a
-- join). Written only by the service-role digest path; the existing insert policy
-- (actor_id = auth.uid()) is unchanged.
alter table public.notifications add column if not exists payload jsonb;

-- Per-item rule evaluation — THE single implementation of the structural-
-- completeness + overdue predicates. Internal: no grant to authenticated.
create or replace function public._board_health_flags(p_board_id uuid)
returns table (
  item_id uuid,
  item_name text,
  item_created_at timestamptz,
  is_done boolean,
  is_overdue boolean,
  is_incomplete boolean
)
language sql stable security definer set search_path = '' as $$
  with cols as (
    select
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'status'
        order by c.position asc limit 1) as status_col,
      (select c.settings from public.columns c
        where c.board_id = p_board_id and c.kind = 'status'
        order by c.position asc limit 1) as status_settings,
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'people'
        order by c.position asc limit 1) as people_col,
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'date'
        order by c.position asc limit 1) as date_col
  ),
  base as (
    select
      i.id,
      i.name,
      i.created_at,
      exists (
        select 1
        from public.cell_values cv,
             jsonb_array_elements(
               coalesce(cols.status_settings -> 'options', '[]'::jsonb)) opt
        where cv.item_id = i.id
          and cv.column_id = cols.status_col
          and opt ->> 'id' = cv.value ->> 'optionId'
          and opt ->> 'label' ~* '(done|complete)'
      ) as is_done,
      exists (
        select 1
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and coalesce(cv.value ->> 'end', cv.value ->> 'date')
              < current_date::text
      ) as has_past_due,
      (cols.people_col is not null) as has_people_col,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.people_col
          and jsonb_array_length(coalesce(cv.value -> 'userIds', '[]'::jsonb)) > 0
      ) as has_owner,
      (cols.date_col is not null) as has_date_col,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.date_col
          and cv.value ->> 'date' is not null
      ) as has_date
    from public.items i
    cross join cols
    where i.board_id = p_board_id and i.parent_id is null
  )
  select
    id,
    name,
    created_at,
    is_done,
    (has_past_due and not is_done) as is_overdue,
    (not is_done and (
      (has_people_col and not has_owner) or (has_date_col and not has_date)
    )) as is_incomplete
  from base
$$;

revoke execute on function public._board_health_flags(uuid)
  from public, anon, authenticated;

-- Aggregate for the widget + digest counts. Internal.
create or replace function public._board_health_counts(
  p_board_id uuid,
  p_since timestamptz
) returns table (
  total_items integer,
  done_items integer,
  overdue_items integer,
  incomplete_items integer,
  new_items integer
)
language sql stable security definer set search_path = '' as $$
  select
    count(*)::int,
    count(*) filter (where f.is_done)::int,
    count(*) filter (where f.is_overdue)::int,
    count(*) filter (where f.is_incomplete)::int,
    count(*) filter (where f.item_created_at >= p_since)::int
  from public._board_health_flags(p_board_id) f;
$$;

revoke execute on function public._board_health_counts(uuid, timestamptz)
  from public, anon, authenticated;

-- Widget RPC: member-guarded single-row read, trailing-7-day "new" window.
create or replace function public.dashboard_health_summary(p_board_id uuid)
returns table (
  total_items integer,
  done_items integer,
  overdue_items integer,
  incomplete_items integer,
  new_items integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  return query
    select * from public._board_health_counts(p_board_id, now() - interval '7 days');
end; $$;

grant execute on function public.dashboard_health_summary(uuid) to authenticated;

-- Access paths: items_board_id_idx (board filter), items_parent_id_idx (top-level
-- predicate), cell_values PK (item_id, column_id) for the per-item lookups,
-- items_board_created_idx for the new-items window. Output: one row.
