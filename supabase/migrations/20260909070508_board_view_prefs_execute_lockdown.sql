-- 20260909070508_board_view_prefs_execute_lockdown.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Revokes the PUBLIC execute grant Postgres hands every new function, so
--   save_board_view_prefs is callable only by authenticated users.

-- Postgres grants EXECUTE to PUBLIC on every newly created function, which
-- means the anon role inherits it. 20260909064520 created
-- save_board_view_prefs without the repo's lockdown idiom, so anon could reach
-- the function body — caught by the anon-reachability conformance test. The RPC
-- would still have failed on the NOT NULL user_id (auth.uid() is null for
-- anon), but an unauthenticated caller must not reach a function body at all.
revoke execute on function public.save_board_view_prefs (uuid, jsonb)
  from public, anon;
grant execute on function public.save_board_view_prefs (uuid, jsonb)
  to authenticated;
