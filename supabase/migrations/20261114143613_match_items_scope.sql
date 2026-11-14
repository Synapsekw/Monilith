-- 20261114143613_match_items_scope.sql
-- Version minted by scripts/new-migration.sh; filename must match the remote ledger row.

-- match_items gains an org filter and a board-list filter so semantic search
-- can be scoped to an organization or a project folder. A changed argument
-- list would create an overload and make named-argument calls ambiguous, so
-- the old function is dropped and recreated in this one transaction. Existing
-- callers pass a subset of these named arguments and keep working.
drop function public.match_items(extensions.vector, int, uuid, uuid);

create function public.match_items(
  p_query_embedding extensions.vector,
  p_limit int default 20,
  p_board_id uuid default null,
  p_exclude_item_id uuid default null,
  p_org_id uuid default null,
  p_board_ids uuid[] default null
)
returns table (item_id uuid, name text, board_id uuid, board_name text, distance real)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    e.item_id,
    i.name,
    e.board_id,
    b.name as board_name,
    (e.embedding operator(extensions.<=>) p_query_embedding)::real as distance
  from public.item_embeddings e
  join public.items i on i.id = e.item_id and i.archived_at is null
  join public.boards b on b.id = e.board_id and b.archived_at is null
  where (p_board_id is null or e.board_id = p_board_id)
    and (p_exclude_item_id is null or e.item_id <> p_exclude_item_id)
    and (p_org_id is null or e.org_id = p_org_id)
    and (p_board_ids is null or e.board_id = any (p_board_ids))
  order by e.embedding operator(extensions.<=>) p_query_embedding
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function public.match_items(extensions.vector, int, uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.match_items(extensions.vector, int, uuid, uuid, uuid, uuid[]) to authenticated, service_role;
