-- Phase 5c-1 follow-up: drop the orphaned 7-arg _automation_run overload.
--
-- The 5c-1 run-history migration (20260619100000) added an 8-arg _automation_run
-- (gaining p_trigger_type) via CREATE OR REPLACE FUNCTION. Because the argument
-- list changed, Postgres created a NEW overload rather than replacing the old
-- 7-arg signature, leaving two _automation_run functions in the schema. All three
-- callers (tg_run_automations, tg_run_item_automations, _automation_date_sweep)
-- were recreated to call the 8-arg version, so the 7-arg copy is dead code — a
-- needless SECURITY DEFINER surface. Drop it so the engine has a single entry point.
drop function if exists public._automation_run(uuid, jsonb, jsonb, uuid, uuid, uuid, uuid);
