-- Rolled-back dry run for the folder_tower migration, PART 3 of 3.
-- Send ONE execute_sql call made of, concatenated in this exact order:
--   1. command-center-tower-dry-run-before.sql  -- records "before" in temp table tower_dry
--   2. the migration text (supabase/migrations/*_folder_tower.sql)
--   3. this file  -- asserts, then RAISEs one exception whose message is
--      'TOWER_DRY <json>' (carries ALL_PASSED), so the implicit txn rolls back.
-- No explicit BEGIN/COMMIT/ROLLBACK anywhere.

do $after$
declare
  f uuid; v_uid uuid; v_plan json; v_ms numeric; v_best numeric; i int;
  v_this date := date_trunc('week', current_date)::date;
  v_before jsonb; v_res jsonb; v_all jsonb := '{}'::jsonb; v_pass boolean := true;
  v_rows int; v_hash text; v_items int; v_dated int;
  v_load_sum int; v_load_exp int; v_in_window boolean;
  v_ovd_sum int; v_ovd_exp int; v_ovd_rollup numeric;
  v_imp int; v_comp int; v_t_after numeric; v_t_load numeric;
  r record;
begin
  foreach f in array array[
    'bb2b3010-65d1-4ac7-8c47-474c415e78d7'::uuid,
    '2fee1041-c6c1-4064-b6a5-b14e965f40c3'::uuid
  ] loop
    select b.created_by into v_uid
    from public.folder_boards fb join public.boards b on b.id = fb.board_id
    where fb.folder_id = f and b.created_by is not null
    limit 1;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    select t.v into v_before from tower_dry t where t.k = 'before:' || f;

    select count(*),
           md5(coalesce(string_agg(
             b.stage_key || '|' || b.week_start || '|' || b.planned || '|' || b.completed,
             ',' order by b.stage_key, b.week_start), '')),
           coalesce(sum(b.imported_done), 0), coalesce(sum(b.completed), 0),
           bool_or(b.week_start = v_this),
           coalesce(sum(b.overdue_open) filter (where b.week_start = v_this), 0)
      into v_rows, v_hash, v_imp, v_comp, v_in_window, v_ovd_sum
    from public.folder_burn(f) b;
    v_in_window := coalesce(v_in_window, false);

    select count(*), count(*) filter (where x.planned_on is not null)
      into v_items, v_dated
    from public._folder_item_flags(f) x;

    select coalesce(sum(l.open_due), 0) into v_load_sum from public.folder_load(f) l;
    select count(*) into v_load_exp
    from public._folder_item_flags(f) x
    where not x.is_done and x.planned_on is not null
      and date_trunc('week', x.planned_on)::date <= v_this + 21;

    -- expected overdue for the current week, by burn's own rule
    select count(*) into v_ovd_exp
    from public._folder_item_flags(f) x
    join public.items it on it.id = x.item_id
    where x.due_on is not null
      and x.due_on < least(v_this + 7, current_date)
      and it.created_at::date < v_this + 7
      and not (x.is_done and x.done_on is not null and x.done_on < v_this + 7);
    select coalesce(sum(r2.overdue), 0) into v_ovd_rollup from public.folder_rollup(f) r2;

    v_best := null;
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_burn(%L)', f) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
    v_t_after := v_best;
    v_best := null;
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_load(%L)', f) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
    v_t_load := v_best;

    v_res := jsonb_build_object(
      'burn_rows_before', v_before -> 'burn_rows', 'burn_rows_after', v_rows,
      'ok_burn_cells_unchanged',
        (v_before ->> 'burn_hash') = v_hash and (v_before ->> 'burn_rows')::int = v_rows,
      'rollup_before', jsonb_build_object('total', v_before -> 'rollup_total',
        'done', v_before -> 'rollup_done', 'overdue', v_before -> 'rollup_overdue'),
      'rollup_after', (select jsonb_build_object('total', coalesce(sum(r3.total), 0),
        'done', coalesce(sum(r3.done), 0), 'overdue', coalesce(sum(r3.overdue), 0))
        from public.folder_rollup(f) r3),
      'ok_rollup_unchanged', (
        select (v_before ->> 'rollup_total')::numeric = coalesce(sum(r4.total), 0)
           and (v_before ->> 'rollup_done')::numeric = coalesce(sum(r4.done), 0)
           and (v_before ->> 'rollup_overdue')::numeric = coalesce(sum(r4.overdue), 0)
        from public.folder_rollup(f) r4),
      'items', v_items, 'dated_items', v_dated,
      'ok_fixture_nonempty', v_items > 0,
      'load_sum', v_load_sum, 'load_expected', v_load_exp,
      'ok_load_sum', v_load_sum = v_load_exp,
      'overdue_now_burn', case when v_in_window then to_jsonb(v_ovd_sum) end,
      'overdue_now_expected', case when v_in_window then to_jsonb(v_ovd_exp) end,
      'overdue_now_rollup_info', v_ovd_rollup,
      'ok_overdue_now', case when v_in_window then v_ovd_sum = v_ovd_exp end,
      'overdue_now_note', case when not v_in_window then 'current week outside burn window' end,
      'imported_done', v_imp, 'completed', v_comp,
      'ok_imported_done_bounded', v_imp <= v_comp,
      't_burn_before_ms', v_before -> 't_burn_ms', 't_burn_after_ms', v_t_after,
      't_load_ms', v_t_load,
      'ok_burn_time', v_t_after <= 1.2 * (v_before ->> 't_burn_ms')::numeric
                      or (v_t_after - (v_before ->> 't_burn_ms')::numeric) < 5);

    for r in select e.key, e.value from jsonb_each(v_res) e where e.key like 'ok\_%' loop
      if r.value <> 'null'::jsonb and r.value <> 'true'::jsonb then v_pass := false; end if;
    end loop;
    v_all := v_all || jsonb_build_object(f::text, v_res);
  end loop;

  v_all := v_all || jsonb_build_object('grants', jsonb_build_object(
    'authenticated_burn', has_function_privilege('authenticated', 'public.folder_burn(uuid)', 'execute'),
    'service_role_burn', has_function_privilege('service_role', 'public.folder_burn(uuid)', 'execute'),
    'anon_burn', has_function_privilege('anon', 'public.folder_burn(uuid)', 'execute'),
    'authenticated_load', has_function_privilege('authenticated', 'public.folder_load(uuid, integer, integer)', 'execute'),
    'service_role_load', has_function_privilege('service_role', 'public.folder_load(uuid, integer, integer)', 'execute'),
    'anon_load', has_function_privilege('anon', 'public.folder_load(uuid, integer, integer)', 'execute')));
  if not (has_function_privilege('authenticated', 'public.folder_burn(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.folder_burn(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.folder_burn(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.folder_load(uuid, integer, integer)', 'execute')
      and has_function_privilege('service_role', 'public.folder_load(uuid, integer, integer)', 'execute')
      and not has_function_privilege('anon', 'public.folder_load(uuid, integer, integer)', 'execute')) then
    v_pass := false;
  end if;
  v_all := v_all || jsonb_build_object('ALL_PASSED', v_pass);
  raise exception 'TOWER_DRY %', v_all::text;
end
$after$;
