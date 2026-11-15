-- verify-query-items-leak.sql: run via supabase-dev execute_sql AFTER
-- verify-query-items.sql, as a separate call. Proves the rolled-back fixtures
-- left nothing behind and the session is back to a plain role with no claims.
select
  (select count(*) from public.boards where name like 'verify query_items%') as boards,
  (select count(*) from public.folders where name like 'verify query_items%') as folders,
  (select count(*) from public.organizations where name like 'verify query_items%') as orgs,
  (select count(*) from public.items where name like 'qi %' or name like 'eq %') as items,
  current_user as current_user,
  current_setting('request.jwt.claims', true) as claims;
-- Expected: 0, 0, 0, 0, postgres, null (or empty).
