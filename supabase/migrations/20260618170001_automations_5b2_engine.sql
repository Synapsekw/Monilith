-- Phase 5b-2: the date sweep + pg_cron schedule.

create extension if not exists pg_cron;   -- installs into the `cron` schema on Supabase

-- _automation_date_sweep: fire date_reached rules for every org at 08:00 org-local.
-- p_now defaults to now() in production; tests inject a deterministic instant.
-- Each org is processed in its own sub-block: a bad timezone (or any per-org error)
-- skips that org rather than aborting the whole sweep.
create or replace function public._automation_date_sweep(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    record;
  v_rule   record;
  v_item   record;
  v_local  timestamp;
  v_today  date;
  v_target date;
  v_count  int;
begin
  for v_org in select id, timezone from public.organizations loop
    begin
      -- Wall-clock time in the org's timezone (DST-correct).
      v_local := p_now at time zone v_org.timezone;
      -- Fire each org once per local day, at its own 08:00 local hour.
      if extract(hour from v_local)::int <> 8 then
        continue;
      end if;
      v_today := v_local::date;

      for v_rule in
        select id, board_id, org_id, actions, condition, trigger
        from public.automations
        where org_id = v_org.id
          and enabled
          and (trigger ->> 'type') = 'date_reached'
      loop
        -- offsetDays sign: cell = today - offsetDays
        -- (-3 => today+3 i.e. 3 days out; +2 => today-2 i.e. 2 days ago).
        v_target := v_today - (v_rule.trigger ->> 'offsetDays')::int;

        for v_item in
          select cv.item_id
          from public.cell_values cv
          where cv.column_id = (v_rule.trigger ->> 'columnId')::uuid
            and (cv.value ->> 'date') = v_target::text   -- text compare: no cast errors
        loop
          insert into public.automation_date_fires
            (automation_id, item_id, org_id, fire_date)
          values (v_rule.id, v_item.item_id, v_org.id, v_today)
          on conflict do nothing;

          get diagnostics v_count = row_count;
          if v_count > 0 then
            -- actor := null (system-initiated; never self-excludes a recipient).
            perform public._automation_run(
              v_rule.id, v_rule.actions, v_rule.condition,
              v_item.item_id, v_rule.org_id, v_rule.board_id, null);
          end if;
        end loop;
      end loop;
    exception
      when others then
        -- Isolate per-org failures (e.g. an invalid timezone): skip, don't abort the sweep.
        raise warning 'automation date sweep skipped org %: %', v_org.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- Hourly schedule. cron.schedule upserts by job name => migration is re-runnable.
select cron.schedule(
  'automations-date-sweep',
  '0 * * * *',
  $cron$ select public._automation_date_sweep() $cron$
);
