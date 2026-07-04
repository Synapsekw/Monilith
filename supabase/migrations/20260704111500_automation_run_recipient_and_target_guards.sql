-- Security hardening (finding #4): confine _automation_run's client-authored
-- action payloads. Automations (trigger + actions jsonb) are authored by any
-- board editor and executed by this SECURITY DEFINER engine, which bypasses
-- RLS. Three action fields come straight from that untrusted jsonb and were
-- used unconfined:
--   a) notify.recipient.userId — an arbitrary uuid. A cross-org uuid would get
--      a notifications row inserted for a user outside p_org_id (nuisance inbox
--      row / dead deep-link). The notifications INSERT policy already demands
--      is_member_of(recipient, org) for client writes (20260617102000), but the
--      definer engine bypasses it. Re-assert it here: skip delivery silently if
--      the resolved recipient is not a member of p_org_id.
--   b/c) set_option.columnId / set_percent.columnId — an arbitrary column uuid.
--      A column id on ANOTHER board/org would have a cell_values row written
--      against it (cross-org FK write, since the engine supplies org_id/board_id
--      from the trigger row but column_id from the payload). Validate the target
--      column belongs to p_board_id; skip the action if it does not.
--
-- CREATE OR REPLACE only. Body copied verbatim from the latest definition
-- (20260703091000_automations_percent_sync.sql) with exactly the three guards
-- above added; every other branch (move_to_group, call_webhook, condition
-- gate, run/ledger bookkeeping, error handling) is byte-for-byte unchanged.
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
  v_group    uuid;
  v_moved    int;
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
        elsif not public.is_member_of(v_rid, p_org_id) then
          -- recipient uuid came from client-authored actions jsonb; never
          -- deliver to a non-member (finding #4a).
          v_outcome := 'skipped_not_member';
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
        -- Confine the target column to this board (finding #4b): column id comes
        -- from client-authored actions jsonb and the definer bypasses RLS.
        select kind into v_kind from public.columns
          where id = v_target and board_id = p_board_id;
        if v_kind is null then
          v_outcome := 'skipped_bad_target';
        else
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
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','set_option','outcome',v_outcome);

      elsif a->>'type' = 'set_percent' then
        v_target := (a->>'columnId')::uuid;
        -- Confine the target column to this board (finding #4c).
        if not exists (
          select 1 from public.columns
          where id = v_target and board_id = p_board_id
        ) then
          v_outcome := 'skipped_bad_target';
        else
          v_newval := jsonb_build_object('percent', (a->>'percent')::numeric);
          if exists (
            select 1 from public.cell_values cv
            where cv.item_id = p_item_id
              and cv.column_id = v_target
              and (cv.value->>'percent')::numeric = (a->>'percent')::numeric
          ) then
            v_outcome := 'skipped_equal';
          else
            insert into public.cell_values (org_id, board_id, item_id, column_id, value)
            values (p_org_id, p_board_id, p_item_id, v_target, v_newval)
            on conflict (item_id, column_id) do update set value = excluded.value;
            v_outcome := 'set';
          end if;
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','set_percent','outcome',v_outcome);

      elsif a->>'type' = 'move_to_group' then
        v_group := (a->>'groupId')::uuid;
        update public.items i
           set group_id = v_group,
               position = coalesce(
                 (select max(i2.position) from public.items i2
                   where i2.group_id = v_group and i2.parent_id is null),
                 0
               ) + 1
         where i.id = p_item_id
           and i.parent_id is null
           and i.group_id is distinct from v_group
           and exists (
             select 1 from public.groups g
              where g.id = v_group and g.board_id = p_board_id
           );
        get diagnostics v_moved = row_count;
        v_outcome := case when v_moved > 0 then 'moved' else 'skipped_noop' end;
        v_outcomes := v_outcomes || jsonb_build_object('type','move_to_group','outcome',v_outcome);

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

-- _automation_run is an internal engine helper (fired via tg_run_automations /
-- reconcile paths). Keep it off the direct REST surface, matching 20260621130000.
revoke execute on function public._automation_run(uuid, jsonb, jsonb, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
