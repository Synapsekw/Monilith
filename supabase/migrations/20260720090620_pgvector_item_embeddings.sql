-- 20260720090620_pgvector_item_embeddings.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (E5 · F15 semantic search — infra root, Task B1):
--   Enables pgvector and adds the greenfield semantic-search storage:
--     * public.item_embeddings — one composite-document embedding per item
--       (1536-dim, matches the fixed platform model text-embedding-3-small);
--       content_hash + model bound re-embedding and make a model swap a
--       controlled re-index (spec §4.4/§4.5).
--     * an HNSW ANN index (cosine) for sub-linear nearest-neighbour reads, plus
--       a board index for the scoped/`p_board_id` path.
--     * RLS: default-deny; SELECT only for items on boards the caller can read
--       (mirrors search_items' posture via readable_board_ids()); NO client
--       insert/update — writes happen only through the service embed endpoint.
--     * public.match_items(...) — the ANN retrieval RPC. SECURITY INVOKER +
--       STABLE + search_path='' so the CALLER's item_embeddings/items/boards
--       SELECT policies scope every row (no cross-tenant leakage, no added
--       privilege — same security posture as search_items). k is clamped ≤ 50.
--
-- HNSW (not IVFFlat): no training pass, supports the continuous incremental
--   inserts of a live corpus, and better recall at our scale (spec §4.4).

create extension if not exists vector with schema extensions;

create table public.item_embeddings (
  item_id      uuid primary key references public.items (id) on delete cascade,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null references public.boards (id) on delete cascade,
  embedding    extensions.vector(1536) not null,   -- fixed model dim (§4.5)
  content_hash text not null,                       -- bounds re-embedding
  model        text not null,                       -- embedding model id (index-version guard)
  embedded_at  timestamptz not null default now()
);

-- ANN index for the hot-path nearest-neighbour read (cosine distance operator
-- `<=>`, matched by vector_cosine_ops). Sub-linear, no rebuild cadence.
create index item_embeddings_ann_idx on public.item_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);
-- Supports the board-scoped filter (match_items p_board_id) and board deletes.
create index item_embeddings_board_idx on public.item_embeddings (board_id);

alter table public.item_embeddings enable row level security;

-- Read-only to callers who can read the item's board; mirrors the board-scoped
-- semijoin posture of the other authenticated tables (readable_board_ids() is a
-- SECURITY DEFINER helper that EVALUATES readability — a table that RETURNS rows
-- must not itself be DEFINER). No INSERT/UPDATE/DELETE policy ⇒ default-deny for
-- clients; the service embed endpoint writes with the service role.
create policy item_embeddings_select on public.item_embeddings
  for select using (board_id in (select public.readable_board_ids()));

-- ANN retrieval. SECURITY INVOKER so results are scoped by the caller's RLS
-- SELECT policies on item_embeddings/items/boards. search_path='' pins every
-- object to public.*/extensions.*. k clamped to [1,50] so a growing corpus is
-- never scanned unbounded.
create or replace function public.match_items(
  p_query_embedding extensions.vector,
  p_limit int default 20,
  p_board_id uuid default null,
  p_exclude_item_id uuid default null
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
  join public.items i on i.id = e.item_id
  join public.boards b on b.id = e.board_id
  where (p_board_id is null or e.board_id = p_board_id)
    and (p_exclude_item_id is null or e.item_id <> p_exclude_item_id)
  order by e.embedding operator(extensions.<=>) p_query_embedding
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- Match the locked-down grant posture of search_items (no PUBLIC, no anon).
revoke execute on function public.match_items(extensions.vector, int, uuid, uuid) from public;
grant execute on function public.match_items(extensions.vector, int, uuid, uuid) to authenticated, service_role;
