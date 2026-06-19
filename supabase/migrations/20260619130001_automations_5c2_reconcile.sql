-- Phase 5c-2: reconcile sweep — fold pg_net responses into run-history, plus a
-- ledger cleanup folded into the existing daily prune.

create or replace function public._automation_webhook_reconcile()
returns void language plpgsql security definer set search_path = '' as $$
declare
  d        record;
  v_code   int;
  v_err    text;
  v_timed  boolean;
begin
  for d in
    select request_id, run_id, action_index
    from public.automation_webhook_deliveries
    where status = 'pending'
  loop
    select status_code, error_msg, timed_out
      into v_code, v_err, v_timed
    from net._http_response
    where id = d.request_id;

    if not found then
      continue;  -- response not back yet; revisit next minute
    end if;

    update public.automation_runs
      set actions = jsonb_set(
        actions,
        array[d.action_index::text, 'outcome'],
        to_jsonb(public._webhook_outcome(
          v_code,
          case when coalesce(v_timed, false) then 'timeout' else v_err end
        ))
      )
      where id = d.run_id;

    update public.automation_webhook_deliveries
      set status = 'done'
      where request_id = d.request_id;
  end loop;
end; $$;

-- Recreate the daily prune: keep last 50 runs/rule (unchanged) + drop old done
-- deliveries. Body of the keep-50 delete is copied verbatim from 5c-1.
create or replace function public._automation_runs_prune() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.automation_runs ar
  using (
    select id, row_number() over (
      partition by automation_id order by created_at desc, id desc
    ) as rn
    from public.automation_runs
  ) ranked
  where ar.id = ranked.id and ranked.rn > 50;

  delete from public.automation_webhook_deliveries
  where status = 'done' and created_at < now() - interval '1 day';
end; $$;

select cron.schedule(
  'automation-webhook-reconcile', '* * * * *',
  $cron$ select public._automation_webhook_reconcile() $cron$
);
