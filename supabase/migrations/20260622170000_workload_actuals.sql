-- Phase 7c v2: workload actuals overlay. Pre-aggregate COMPLETED logged time
-- (time_entries) per (assignee, board, day) over a bounded horizon, so the
-- /workload grid can overlay actuals next to planned effort. Mirrors
-- workload_rollup's security posture: is_org_member + can_read_board, bounded.

-- Support the horizon range scan (existing indexes are item/board-scoped, none
-- on started_at). Partial: only completed entries are ever summed here.
create index if not exists time_entries_org_started_completed_idx
  on public.time_entries (org_id, started_at)
  where ended_at is not null;

-- workload_actuals_rollup: per (user, board, day) completed seconds for the
-- caller's readable boards over [p_from, p_to]. Day bucket = started_at::date.
create or replace function public.workload_actuals_rollup(p_from date, p_to date)
returns table (
  user_id  uuid,
  board_id uuid,
  day      date,
  secs     bigint
)
language sql security definer set search_path = '' as $$
  select
    te.user_id,
    te.board_id,
    te.started_at::date as day,
    sum(te.duration_secs)::bigint as secs
  from public.time_entries te
  join public.boards b on b.id = te.board_id
  where te.ended_at is not null
    and te.duration_secs is not null
    and te.started_at::date >= p_from
    and te.started_at::date <= p_to
    and public.is_org_member(b.org_id)
    and public.can_read_board(te.board_id)
  group by te.user_id, te.board_id, te.started_at::date
  limit 5000;
$$;
grant execute on function public.workload_actuals_rollup(date, date) to authenticated;
