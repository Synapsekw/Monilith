-- Phase 5c-1: automation run-history (observability) + fault isolation.

-- 1) Run-history table.
create table if not exists public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id)    on delete cascade,
  org_id        uuid not null references public.organizations (id)  on delete cascade,
  board_id      uuid not null references public.boards (id)         on delete cascade,
  item_id       uuid          references public.items (id)          on delete set null,
  trigger_type  text not null,
  status        text not null check (status in ('ran','blocked','error')),
  actions       jsonb not null default '[]'::jsonb,
  error         text,
  created_at    timestamptz not null default now()
);

alter table public.automation_runs enable row level security;

drop policy if exists "automation_runs: read if member" on public.automation_runs;
create policy "automation_runs: read if member"
  on public.automation_runs for select to authenticated
  using (public.is_org_member(org_id));
-- No client write policy: rows are written only by the SECURITY DEFINER engine.

create index if not exists automation_runs_rule_recent_idx
  on public.automation_runs (automation_id, created_at desc);

-- 2) Recreate _automation_run: + p_trigger_type, + per-action outcome logging,
--    + begin/exception fault isolation. Behavior of notify/set_option is unchanged;
--    each branch now also records its outcome.
create or replace function public._automation_run(
  p_automation_id uuid, p_actions jsonb, p_condition jsonb,
  p_item_id uuid, p_org_id uuid, p_board_id uuid, p_actor uuid,
  p_trigger_type text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a          jsonb;
  v_outcomes jsonb := '[]'::jsonb;
  v_rid      uuid;
  v_target   uuid;
  v_opt      text;
  v_outcome  text;
begin
  begin
    if not public._automation_conditions_pass(p_condition, p_item_id) then
      insert into public.automation_runs
        (automation_id, org_id, board_id, item_id, trigger_type, status)
      values (p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'blocked');
      return;
    end if;

    for a in select * from jsonb_array_elements(p_actions)
    loop
      if a->>'type' = 'notify' then
        if a#>>'{recipient,kind}' = 'member' then
          v_rid := (a#>>'{recipient,userId}')::uuid;
        else
          select (cv.value->'userIds'->>0)::uuid
            into v_rid
          from public.cell_values cv
          where cv.item_id = p_item_id
            and cv.column_id = (a#>>'{recipient,peopleColumnId}')::uuid;
        end if;

        if v_rid is null then
          v_outcome := 'skipped_no_recipient';
        elsif v_rid is not distinct from p_actor then
          v_outcome := 'skipped_self';
        elsif exists (
          select 1 from public.notifications n
          where n.recipient_id = v_rid
            and n.item_id = p_item_id
            and n.automation_id = p_automation_id
            and n.read_at is null
        ) then
          v_outcome := 'skipped_dup';
        else
          insert into public.notifications
            (org_id, recipient_id, actor_id, kind, board_id, item_id, automation_id)
          values
            (p_org_id, v_rid, p_actor, 'automation', p_board_id, p_item_id, p_automation_id);
          v_outcome := 'sent';
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','notify','outcome',v_outcome);

      elsif a->>'type' = 'set_option' then
        v_target := (a->>'columnId')::uuid;
        v_opt := a->>'optionId';
        if exists (
          select 1 from public.cell_values cv
          where cv.item_id = p_item_id
            and cv.column_id = v_target
            and cv.value->>'optionId' = v_opt
        ) then
          v_outcome := 'skipped_equal';
        else
          insert into public.cell_values (org_id, board_id, item_id, column_id, value)
          values (p_org_id, p_board_id, p_item_id, v_target,
                  jsonb_build_object('optionId', v_opt))
          on conflict (item_id, column_id) do update set value = excluded.value;
          v_outcome := 'set';
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','set_option','outcome',v_outcome);
      end if;
    end loop;

    insert into public.automation_runs
      (automation_id, org_id, board_id, item_id, trigger_type, status, actions)
    values (p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'ran', v_outcomes);

  exception when others then
    insert into public.automation_runs
      (automation_id, org_id, board_id, item_id, trigger_type, status, error)
    values (p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'error', sqlerrm);
  end;
end; $$;

-- 3) Recreate callers to pass p_trigger_type.
-- 3a) cell_values trigger (status_changed + person_assigned) — adds trigger_type to the select.
create or replace function public.tg_run_automations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_depth    int  := coalesce(nullif(current_setting('pulse.aut_depth', true), '')::int, 0);
  v_actor    uuid := (select auth.uid());
  v_new_opt  text := new.value->>'optionId';
  v_assigned boolean;
  r          record;
begin
  if (tg_op = 'UPDATE' and new.value is not distinct from old.value) then
    return new;
  end if;

  if v_depth >= 5 then
    return new;
  end if;
  perform set_config('pulse.aut_depth', (v_depth + 1)::text, true);

  v_assigned := exists (
    select 1
    from jsonb_array_elements_text(coalesce(new.value->'userIds', '[]'::jsonb)) nu(uid)
    where tg_op = 'INSERT'
       or not (coalesce(old.value->'userIds', '[]'::jsonb) ? nu.uid)
  );

  for r in
    select id, actions, condition, trigger->>'type' as trigger_type
    from public.automations
    where board_id = new.board_id
      and enabled
      and trigger->>'columnId' = new.column_id::text
      and (
        (
          trigger->>'type' = 'status_changed'
          and (
            trigger->>'toOptionId' is null
            or trigger->>'toOptionId' = v_new_opt
            or (new.value ? 'optionIds'
                and (new.value->'optionIds') ? (trigger->>'toOptionId'))
          )
        )
        or (trigger->>'type' = 'person_assigned' and v_assigned)
      )
  loop
    perform public._automation_run(
      r.id, r.actions, r.condition, new.item_id, new.org_id, new.board_id, v_actor, r.trigger_type
    );
  end loop;

  return new;
end; $$;

-- 3b) items trigger (item_created).
create or replace function public.tg_run_item_automations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_depth int  := coalesce(nullif(current_setting('pulse.aut_depth', true), '')::int, 0);
  v_actor uuid := (select auth.uid());
  r       record;
begin
  if v_depth >= 5 then
    return new;
  end if;
  perform set_config('pulse.aut_depth', (v_depth + 1)::text, true);

  for r in
    select id, actions, condition
    from public.automations
    where board_id = new.board_id
      and enabled
      and trigger->>'type' = 'item_created'
  loop
    perform public._automation_run(
      r.id, r.actions, r.condition, new.id, new.org_id, new.board_id, v_actor, 'item_created'
    );
  end loop;

  return new;
end; $$;

-- 3c) date sweep (date_reached) — recreate passing 'date_reached'. Body identical to 5b-2
--     except the _automation_run call gains the trigger_type arg.
create or replace function public._automation_date_sweep(p_now timestamptz default now())
returns void
language plpgsql security definer set search_path = '' as $$
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
      v_local := p_now at time zone v_org.timezone;
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
        v_target := v_today - (v_rule.trigger ->> 'offsetDays')::int;

        for v_item in
          select cv.item_id
          from public.cell_values cv
          where cv.column_id = (v_rule.trigger ->> 'columnId')::uuid
            and (cv.value ->> 'date') = v_target::text
        loop
          insert into public.automation_date_fires
            (automation_id, item_id, org_id, fire_date)
          values (v_rule.id, v_item.item_id, v_org.id, v_today)
          on conflict do nothing;

          get diagnostics v_count = row_count;
          if v_count > 0 then
            perform public._automation_run(
              v_rule.id, v_rule.actions, v_rule.condition,
              v_item.item_id, v_rule.org_id, v_rule.board_id, null, 'date_reached');
          end if;
        end loop;
      end loop;
    exception
      when others then
        raise warning 'automation date sweep skipped org %: %', v_org.id, sqlerrm;
    end;
  end loop;
end; $$;

-- 4) Prune: keep the last 50 runs per rule; daily via pg_cron (installed in 5b-2).
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
end; $$;

select cron.schedule('automation-runs-prune', '30 3 * * *',
  $cron$ select public._automation_runs_prune() $cron$);
