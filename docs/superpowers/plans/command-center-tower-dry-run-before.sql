-- Rolled-back dry run for the folder_tower migration, PART 1 of 3.
-- Send ONE execute_sql call made of, concatenated in this exact order:
--   1. this file (command-center-tower-dry-run-before.sql)  -- runs on the OLD functions
--   2. the migration text (supabase/migrations/*_folder_tower.sql)
--   3. command-center-tower-dry-run.sql                     -- asserts, then RAISEs
-- No explicit BEGIN/COMMIT: the closing RAISE aborts the implicit transaction,
-- so nothing persists. This part only records "before" values in a temp table.
-- (folder_burn_packed and the jsonb folder_load are new in the migration, so
-- there is no "before" for them; PART 3 checks them against folder_burn and
-- _folder_item_flags directly.)
select set_config('lock_timeout', '4s', true), set_config('statement_timeout', '120s', true);

create temp table tower_dry (k text primary key, v jsonb) on commit drop;

do $before$
declare
  f uuid; v_uid uuid; v_plan json; v_ms numeric; v_best numeric; i int;
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
    v_best := null;
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_burn(%L)', f) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
    insert into tower_dry values ('before:' || f, (
      select jsonb_build_object(
        'burn_rows', count(*),
        'burn_hash', md5(coalesce(string_agg(
          b.stage_key || '|' || b.week_start || '|' || b.planned || '|' || b.completed,
          ',' order by b.stage_key, b.week_start), '')),
        'rollup_total', (select coalesce(sum(r.total), 0) from public.folder_rollup(f) r),
        'rollup_done', (select coalesce(sum(r.done), 0) from public.folder_rollup(f) r),
        'rollup_overdue', (select coalesce(sum(r.overdue), 0) from public.folder_rollup(f) r),
        't_burn_ms', v_best)
      from public.folder_burn(f) b));
  end loop;
end
$before$;
