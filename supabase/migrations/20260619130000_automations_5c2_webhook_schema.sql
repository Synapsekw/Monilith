-- Phase 5c-2: external/webhook automation actions (pg_net) — schema + engine branch.
-- Adds the pg_net extension, a delivery ledger, an SSRF URL guard, a pure outcome
-- mapper, the call_webhook branch in _automation_run, and an admin-gate trigger on
-- automations. Reconcile sweep + cron live in the sibling 130001 migration.

create extension if not exists pg_net;   -- installs the `net` schema on Supabase

-- ── Delivery ledger ─────────────────────────────────────────────────────────
create table if not exists public.automation_webhook_deliveries (
  request_id   bigint primary key,
  run_id       uuid not null references public.automation_runs (id) on delete cascade,
  action_index int  not null,
  org_id       uuid not null references public.organizations (id)   on delete cascade,
  status       text not null default 'pending' check (status in ('pending','done')),
  created_at   timestamptz not null default now()
);

alter table public.automation_webhook_deliveries enable row level security;

drop policy if exists "webhook_deliveries: read if member"
  on public.automation_webhook_deliveries;
create policy "webhook_deliveries: read if member"
  on public.automation_webhook_deliveries for select to authenticated
  using (public.is_org_member(org_id));
-- No client write policy: rows are written only by the SECURITY DEFINER engine.

create index if not exists automation_webhook_deliveries_pending_idx
  on public.automation_webhook_deliveries (request_id)
  where status = 'pending';

-- ── SSRF URL guard (best-effort; pure SQL, no DNS) ──────────────────────────
create or replace function public._webhook_url_safe(p_url text)
returns boolean language plpgsql immutable security definer set search_path = '' as $$
declare
  v_host text;
begin
  if p_url is null or lower(p_url) not like 'https://%' then
    return false;
  end if;
  -- host = between scheme and the first '/', '?' or '#'; strip any userinfo/port.
  v_host := lower(split_part(regexp_replace(substring(p_url from 9), '[/?#].*$', ''), '@', -1));
  v_host := split_part(v_host, ':', 1);
  if v_host is null or v_host = '' then
    return false;
  end if;
  if v_host in ('localhost', 'metadata.google.internal', '169.254.169.254')
     or v_host like '%.internal' or v_host like '%.local' or v_host like '%.localhost' then
    return false;
  end if;
  -- IP-literal hosts: reject private/loopback/link-local/special ranges.
  begin
    if v_host::inet <<= any (array[
        '127.0.0.0/8','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16',
        '169.254.0.0/16','0.0.0.0/8','::1/128','fc00::/7','fe80::/10'
      ]::inet[]) then
      return false;
    end if;
  exception when others then
    null;  -- not an IP literal → a hostname; allowed (DNS rebinding is a documented residual)
  end;
  return true;
end; $$;

-- ── Pure outcome mapper (unit-tested directly) ──────────────────────────────
create or replace function public._webhook_outcome(p_status_code int, p_error_msg text)
returns text language sql immutable security definer set search_path = '' as $$
  select case
    when p_error_msg is not null and p_error_msg <> '' then 'failed_network'
    when p_status_code between 200 and 299 then 'delivered_' || p_status_code::text
    when p_status_code is not null then 'failed_' || p_status_code::text
    else 'failed_network'
  end;
$$;

-- ── Engine: _automation_run + call_webhook branch ───────────────────────────
create or replace function public._automation_run(
  p_automation_id uuid, p_actions jsonb, p_condition jsonb,
  p_item_id uuid, p_org_id uuid, p_board_id uuid, p_actor uuid,
  p_trigger_type text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a          jsonb;
  v_idx      int;
  v_outcomes jsonb := '[]'::jsonb;
  v_pending  jsonb := '[]'::jsonb;      -- {rid, idx} per queued webhook
  v_run_id   uuid := gen_random_uuid(); -- minted up front so ledger FK resolves
  v_rid      uuid;
  v_target   uuid;
  v_opt      text;
  v_kind     text;
  v_newval   jsonb;
  v_url      text;
  v_body     jsonb;
  v_headers  jsonb;
  v_req_id   bigint;
  v_outcome  text;
  p          jsonb;
begin
  begin
    if not public._automation_conditions_pass(p_condition, p_item_id) then
      insert into public.automation_runs
        (id, automation_id, org_id, board_id, item_id, trigger_type, status)
      values (v_run_id, p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'blocked');
      return;
    end if;

    for a, v_idx in
      select value, (ordinality - 1)::int from jsonb_array_elements(p_actions) with ordinality
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
        select kind into v_kind from public.columns where id = v_target;
        if v_kind = 'dropdown' then
          v_newval := jsonb_build_object('optionIds', jsonb_build_array(v_opt));
        else
          v_newval := jsonb_build_object('optionId', v_opt);
        end if;
        if exists (
          select 1 from public.cell_values cv
          where cv.item_id = p_item_id
            and cv.column_id = v_target
            and cv.value = v_newval
        ) then
          v_outcome := 'skipped_equal';
        else
          insert into public.cell_values (org_id, board_id, item_id, column_id, value)
          values (p_org_id, p_board_id, p_item_id, v_target, v_newval)
          on conflict (item_id, column_id) do update set value = excluded.value;
          v_outcome := 'set';
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','set_option','outcome',v_outcome);

      elsif a->>'type' = 'call_webhook' then
        v_url := a->>'url';
        if not public._webhook_url_safe(v_url) then
          v_outcome := 'blocked_unsafe_url';
        else
          v_body := jsonb_build_object(
            'automation', jsonb_build_object('id', p_automation_id),
            'board_id',   p_board_id,
            'item_id',    p_item_id,
            'item_name',  (select name from public.items where id = p_item_id),
            'trigger',    p_trigger_type,
            'fired_at',   now()
          );
          v_headers := jsonb_build_object('Content-Type', 'application/json');
          if a->'authHeader' is not null then
            v_headers := v_headers
              || jsonb_build_object(a#>>'{authHeader,name}', a#>>'{authHeader,value}');
          end if;
          v_req_id := net.http_post(url := v_url, body := v_body, headers := v_headers);
          v_outcome := 'queued';
          v_pending := v_pending || jsonb_build_object('rid', v_req_id, 'idx', v_idx);
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','call_webhook','outcome',v_outcome);
      end if;
    end loop;

    insert into public.automation_runs
      (id, automation_id, org_id, board_id, item_id, trigger_type, status, actions)
    values (v_run_id, p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'ran', v_outcomes);

    for p in select * from jsonb_array_elements(v_pending) loop
      insert into public.automation_webhook_deliveries (request_id, run_id, action_index, org_id)
      values ((p->>'rid')::bigint, v_run_id, (p->>'idx')::int, p_org_id);
    end loop;

  exception when others then
    insert into public.automation_runs
      (id, automation_id, org_id, board_id, item_id, trigger_type, status, error)
    values (v_run_id, p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'error', sqlerrm);
  end;
end; $$;

-- ── Admin gate (security boundary): webhook rules require owner/admin ────────
create or replace function public.tg_automations_guard_webhook()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Boundary applies only to authenticated end-users. A null auth.uid() means a
  -- trusted server context (service-role key, cron, SECURITY DEFINER RPC), which
  -- is server-only and never reaches the browser — allow it through.
  if new.actions @> '[{"type":"call_webhook"}]'::jsonb
     and (select auth.uid()) is not null
     and not public.has_org_role(new.org_id, array['owner','admin']::public.org_role[]) then
    raise exception 'Webhook actions require an organization admin'
      using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists trg_automations_guard_webhook on public.automations;
create trigger trg_automations_guard_webhook
  before insert or update on public.automations
  for each row execute function public.tg_automations_guard_webhook();
