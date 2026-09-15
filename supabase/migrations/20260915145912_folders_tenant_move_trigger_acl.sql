-- 20260915145912_folders_tenant_move_trigger_acl.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   public.folders_block_tenant_move() (added in 20260915142403) is a
--   SECURITY DEFINER, trigger-only function that was created with the
--   default PUBLIC execute grant. Convention for trigger-only definer
--   functions (20260725102610_definer_acl_lockdown.sql) is to revoke that
--   default and grant execute only to service_role — Postgres fires trigger
--   functions without an EXECUTE privilege check on the invoking role, so
--   this changes no app path; it only closes the direct-call surface.

revoke all on function public.folders_block_tenant_move()
  from public, anon, authenticated;
grant execute on function public.folders_block_tenant_move()
  to service_role;
