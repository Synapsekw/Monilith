-- Rolled-back dry run for the folder_tower migration.
-- Send as ONE execute_sql call. No explicit BEGIN: the closing RAISE aborts the
-- implicit transaction, so nothing persists. The message starts "TOWER_DRY ".
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
    insert into tower_dry values ('burn_before:' || f, (
      select jsonb_build_object('rows', count(*),
        'planned', coalesce(sum(planned), 0), 'completed', coalesce(sum(completed), 0))
      from public.folder_burn(f)));
    insert into tower_dry values ('rollup:' || f, (
      select jsonb_build_object('total', coalesce(sum(total), 0),
        'done', coalesce(sum(done), 0), 'overdue', coalesce(sum(overdue), 0))
      from public.folder_rollup(f)));
    v_best := null;
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_burn(%L)', f) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
    insert into tower_dry values ('t_burn_before_ms:' || f, to_jsonb(v_best));
  end loop;
end
$before$;

-- <<MIGRATION>>

do $after$
declare
  f uuid; v_uid uuid; v_plan json; v_ms numeric; v_best numeric; i int;
  v_this date := date_trunc('week', current_date)::date;
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
    insert into tower_dry values ('burn_after:' || f, (
      select jsonb_build_object('rows', count(*),
        'planned', coalesce(sum(planned), 0), 'completed', coalesce(sum(completed), 0),
        'imported_done', coalesce(sum(imported_done), 0),
        'overdue_now', coalesce(sum(overdue_open) filter (where week_start = v_this), 0))
      from public.folder_burn(f)));
    insert into tower_dry values ('load:' || f, (
      select jsonb_build_object('rows', count(*), 'open_due', coalesce(sum(open_due), 0),
        'boards', count(distinct board_id), 'weeks', count(distinct week_start))
      from public.folder_load(f)));
    v_best := null;
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_burn(%L)', f) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
    insert into tower_dry values ('t_burn_after_ms:' || f, to_jsonb(v_best));
    v_best := null;
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_load(%L)', f) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
    insert into tower_dry values ('t_load_ms:' || f, to_jsonb(v_best));
  end loop;
  insert into tower_dry values ('grants', jsonb_build_object(
    'anon_burn', has_function_privilege('anon', 'public.folder_burn(uuid)', 'execute'),
    'anon_load', has_function_privilege('anon', 'public.folder_load(uuid, integer, integer)', 'execute'),
    'authed_load', has_function_privilege('authenticated', 'public.folder_load(uuid, integer, integer)', 'execute')));
  raise exception 'TOWER_DRY %', (select jsonb_object_agg(k, v) from tower_dry)::text;
end
$after$;
