-- Phase 5b-2 cleanup: drop the redundant organizations UPDATE policy.
-- The initial auth/tenancy migration already ships "organizations: update if owner/admin"
-- with the identical has_org_role(owner/admin) predicate, which gates the timezone write.
-- The 5b-2 schema migration added a second, duplicate policy ("organizations: update if
-- admin") — harmless (permissive policies OR together) but dead DDL. Remove it.
drop policy if exists "organizations: update if admin" on public.organizations;
