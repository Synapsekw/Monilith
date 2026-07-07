-- Similarity-ranked global item search for the ⌘K command palette.
--
-- WHAT THIS DOES
--   Adds public.search_items(p_query, p_limit): a hybrid, index-assisted item
--   search that (a) still returns every exact-substring match the previous ILIKE
--   did, and (b) adds pg_trgm word-similarity for typo tolerance, ranked
--   exact-contains -> word_similarity -> recency -> id. Reuses the existing
--   items_name_trgm_idx GIN index (verified: both branches Bitmap-Index-Scan it).
--
-- SECURITY: SECURITY INVOKER (the default, stated explicitly) so the read runs
--   under the CALLER's RLS -- items/boards SELECT policies scope results to boards
--   the caller can read. The function adds no privilege. Contrast the SECURITY
--   DEFINER RLS helpers (readable_board_ids()) which bypass RLS to EVALUATE it; a
--   function that RETURNS rows must not.
--
-- search_path='' pins every object to public.*/extensions.* (pg_trgm lives in
--   extensions).
--
-- WHY plpgsql + set_config, not a function-header `SET`:
--   We need pg_trgm.word_similarity_threshold lowered to 0.3 so real typos pass
--   (measured: word_similarity('desing','Design spec') = 0.571, under the 0.6
--   default) while unrelated text stays 0.0. This managed Postgres REJECTS a
--   function-header `SET pg_trgm.word_similarity_threshold = '0.3'` at CREATE time
--   ("permission denied to set parameter" -- extension GUCs are restricted in the
--   ALTER/CREATE FUNCTION SET path). A session-level set IS allowed for this
--   USERSET GUC, so we set it inside the body with set_config(..., is_local=true):
--   transaction-local, so it resets at the end of each RPC call and never leaks
--   across pooled/pgbouncer connections. The `%>` operator then filters at 0.3 and
--   both WHERE branches still Bitmap-Index-Scan items_name_trgm_idx (EXPLAIN
--   verified on dev with enable_seqscan=off).

-- Immutable helper: escape LIKE metacharacters so a query of "50%" or "a_b" is
-- matched literally by the ILIKE branch. Same logic as the lib's old
-- escapeLikePattern (escape backslash first, then % and _).
create or replace function public.escape_like(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_');
$$;

create or replace function public.search_items(
  p_query text,
  p_limit int default 25
)
returns table (id uuid, name text, board_id uuid, board_name text, rank real)
language plpgsql
security invoker
stable
set search_path = ''
as $$
begin
  -- Transaction-local: lowers the word-similarity cutoff to 0.3 for this call
  -- only (resets at end of the RPC's transaction, no cross-connection leak).
  perform set_config('pg_trgm.word_similarity_threshold', '0.3', true);

  return query
    select
      i.id,
      i.name,
      i.board_id,
      b.name as board_name,
      extensions.word_similarity(p_query, i.name) as rank
    from public.items i
    join public.boards b on b.id = i.board_id
    where i.name operator(extensions.%>) p_query
       or i.name ilike '%' || public.escape_like(p_query) || '%'
    order by
      (i.name ilike '%' || public.escape_like(p_query) || '%') desc,
      extensions.word_similarity(p_query, i.name) desc,
      i.updated_at desc,
      i.id
    limit least(greatest(coalesce(p_limit, 25), 1), 50);
end;
$$;

-- Match the locked-down grant posture of the other authenticated-callable
-- functions (no PUBLIC, no anon).
revoke execute on function public.escape_like(text) from public;
grant execute on function public.escape_like(text) to authenticated, service_role;
revoke execute on function public.search_items(text, int) from public;
grant execute on function public.search_items(text, int) to authenticated, service_role;
