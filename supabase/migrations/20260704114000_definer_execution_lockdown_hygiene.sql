-- Security hygiene (finding #9): re-assert the definer-execution lockdown that
-- 20260621130000_lockdown_definer_execution_and_perf.sql established, plus two
-- loose ends.
--
-- (a) platform_user_sole_owned_orgs was created with `set search_path = public`
--     (20260619250000:7) — the only definer function not pinned to ''. Its body
--     is fully schema-qualified (public.is_platform_admin(), public.org_members,
--     public.organizations), so '' is safe and removes the mutable-search_path
--     footgun.
alter function public.platform_user_sole_owned_orgs(uuid) set search_path = '';

-- (b) Default privileges: new functions still get a PUBLIC execute grant at
--     creation time. Revoke it going forward so future definer functions are
--     not anon-callable by default. (Applies to objects created by the current
--     role.)
alter default privileges in schema public
  revoke execute on functions from public, anon;

-- (c) Functions created AFTER the 20260621130000 lockdown re-acquired the
--     default PUBLIC execute grant (create function grants EXECUTE to PUBLIC),
--     because each shipped only `grant execute … to authenticated` without a
--     matching `revoke … from public, anon`. They fail closed today (their own
--     bodies enforce is_org_member / can_edit_* / is_platform_admin), but they
--     should not be reachable off the REST API as `anon` at all. Strip the
--     PUBLIC + anon grant explicitly. A name-based DO block covers every
--     overload without hardcoding (possibly drifting) argument signatures.
--     (dashboard_completion/series/health_summary are also revoked in
--     20260704110000; re-revoking is idempotent.)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname in (
        'goals_rollup', 'create_goal', 'duplicate_board_structure',
        'duplicate_dashboard', 'workload_rollup', 'workload_actuals_rollup',
        'dashboard_completion', 'dashboard_series', 'dashboard_health_summary',
        'import_rows_into_board', 'can_edit_goal', 'can_edit_member_capacity'
      )
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;
