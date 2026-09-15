-- 20260915115118_folder_workload_order_tiebreak.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Task review fix (Minor, folded into the required fix round) for
--   20260915112812_folder_burn_workload_gallery.sql's folder_workload:
--
--   `order by u.uid asc nulls last, f.board_name asc` had no tiebreak beyond
--   board name — two boards with the same name, or the same user/board pair
--   split across multiple stages (groups), had undefined relative row order.
--   Added `f.board_id asc, lower(trim(f.group_name)) asc` tiebreaks (board id
--   for same-named boards, then stage key for multiple stages on one board)
--   so the row order is fully deterministic. No column, signature, or
--   filtering change — `create or replace`, additive only.
--
--   Note for Task 5 (Zod): folder_workload.user_id is NULL for the
--   unassigned row (an item with zero owners), even though the generated
--   TypeScript type says `string` — Postgres's `returns table` doesn't carry
--   nullability for a plain `text` column that can legitimately be null at
--   runtime. Task 5's schema must declare `user_id` as `.nullable()`, not
--   plain `z.string()`.

create or replace function public.folder_workload(p_folder_id uuid)
returns table (
  user_id text,
  board_id uuid,
  board_name text,
  stage_key text,
  stage_name text,
  open_items integer,
  overdue_items integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with flags as (
    select * from public._folder_item_flags(p_folder_id)
  )
  select u.uid,
         f.board_id,
         f.board_name,
         lower(trim(f.group_name)),
         min(f.group_name),
         count(*)::int,
         count(*) filter (where f.is_overdue)::int
  from flags f
  cross join lateral unnest(
    case when cardinality(f.owner_ids) = 0 then array[null::text] else f.owner_ids end
  ) as u(uid)
  where not f.is_done
  group by u.uid, f.board_id, f.board_name, lower(trim(f.group_name))
  order by u.uid asc nulls last, f.board_name asc, f.board_id asc,
           lower(trim(f.group_name)) asc;
end; $$;

revoke execute on function public.folder_workload(uuid) from public, anon;
grant execute on function public.folder_workload(uuid) to authenticated;
