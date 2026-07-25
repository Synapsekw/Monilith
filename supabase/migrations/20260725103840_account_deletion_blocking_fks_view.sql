-- 20260725103840_account_deletion_blocking_fks_view.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds two read-only introspection helpers so the test suite can assert the
--   schema itself, turning spec §3.2's "deletion fails loudly" property into an
--   automated tripwire instead of a hope.
--
--   `account_deletion_blocking_fks()` lists every NOT NULL + ON DELETE NO ACTION
--   FK column pointing at `auth.users`. Those are exactly the columns that must be
--   emptied by `user_delete_reassign_authorship()` before an account can be
--   deleted. A test pins the list, so adding a new authorship column without
--   teaching the RPC about it fails CI rather than breaking deletion in production.
--
--   `account_deletion_reattribution_frozen_columns()` closes the OTHER hole — the
--   one that actually bit during this build. Two BEFORE UPDATE triggers
--   (items_protect_creation_metadata, item_updates_protect_attribution) rewrite
--   attribution back to its old value, so a reassignment UPDATE reports success and
--   changes nothing. Listing the frozen columns lets the same test assert that every
--   frozen authorship column has a sanctioned reassignment branch, so the next
--   freeze trigger someone adds cannot silently re-break deletion.
--
--   PostgREST cannot select from pg_constraint / pg_trigger directly, hence the
--   SECURITY DEFINER wrappers. Both are strictly read-only catalog reads.

create or replace function public.account_deletion_blocking_fks()
returns table (qualified_column text)
language sql
stable
security definer
set search_path to ''
as $$
  select src.relname || '.' || a.attname
  from pg_constraint c
  join pg_class src on src.oid = c.conrelid
  join pg_namespace sn on sn.oid = src.relnamespace
  join pg_class tgt on tgt.oid = c.confrelid
  join pg_namespace tn on tn.oid = tgt.relnamespace
  join unnest(c.conkey) k(attnum) on true
  join pg_attribute a on a.attrelid = src.oid and a.attnum = k.attnum
  where c.contype = 'f'
    and tn.nspname = 'auth'
    and tgt.relname = 'users'
    and sn.nspname = 'public'
    and c.confdeltype = 'a'   -- NO ACTION
    and a.attnotnull
  order by 1;
$$;

revoke all on function public.account_deletion_blocking_fks() from public, anon;
grant execute on function public.account_deletion_blocking_fks() to authenticated, service_role;

-- Every `public` BEFORE UPDATE trigger whose function body writes an
-- `auth.users`-referencing column back to its OLD value, i.e. every attribution
-- freeze. Reported as `<table>.<column>` so a test can compare it against the
-- set the reassignment RPC knows how to work around.
create or replace function public.account_deletion_reattribution_frozen_columns()
returns table (qualified_column text)
language sql
stable
security definer
set search_path to ''
as $$
  select distinct tbl.relname || '.' || a.attname
  from pg_trigger t
  join pg_class tbl on tbl.oid = t.tgrelid
  join pg_namespace tn on tn.oid = tbl.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_constraint c on c.conrelid = tbl.oid and c.contype = 'f'
  join pg_class ftgt on ftgt.oid = c.confrelid
  join pg_namespace fns on fns.oid = ftgt.relnamespace
  join unnest(c.conkey) k(attnum) on true
  join pg_attribute a on a.attrelid = tbl.oid and a.attnum = k.attnum
  where not t.tgisinternal
    and tn.nspname = 'public'
    and (t.tgtype & 2) <> 0    -- BEFORE
    and (t.tgtype & 16) <> 0   -- UPDATE
    and fns.nspname = 'auth' and ftgt.relname = 'users'
    and pg_get_functiondef(p.oid) like '%new.' || a.attname || ' := old.' || a.attname || '%'
  order by 1;
$$;

revoke all on function public.account_deletion_reattribution_frozen_columns() from public, anon;
grant execute on function public.account_deletion_reattribution_frozen_columns() to authenticated, service_role;
