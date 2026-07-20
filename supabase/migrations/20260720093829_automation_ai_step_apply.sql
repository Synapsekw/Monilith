-- 20260720093829_automation_ai_step_apply.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Phase 10 · E5 · Task A2 — F13 "AI action step"):
--   1) Adds an `ai_step` branch to the confined `_automation_run` executor: when
--      a rule fires an ai_step action, it INSERTs an `automation_ai_jobs` row
--      (A1 ledger) and fires a NON-BLOCKING, HMAC-signed `net.http_post {job_id}`
--      to /api/ai/automation-step — mirroring the existing call_webhook async hop
--      exactly (pg_net, transaction commits immediately). The model CANNOT be
--      called inline (this runs in the mutating txn as a definer), so it hops out.
--   2) Adds `automation_ai_apply(p_job, p_action)` — a SECURITY DEFINER confined
--      applier the endpoint calls back with the model's CHOSEN action. It re-runs
--      the SAME per-action confinement guards as `_automation_run`
--      (set_option/set_percent target column must belong to the board;
--      move_to_group group same-board; notify recipient must be is_member_of the
--      org), writes ONE `automation_runs` outcome row (ai_decided / ai_skipped*),
--      and marks the job done. The AI never gets a raw write path (spec §4.1 #3).
--
-- Signing secret (shared decision): the DB reads the endpoint base URL from Vault
-- secret `app_url` (reused from the health-digest cron) and the HMAC secret from
-- Vault secret `ai_pgnet_hmac_secret`. The server verifies with env
-- AI_PGNET_HMAC_SECRET (must equal the Vault value). The signature is computed
-- over `v_hmac_body::text` and pg_net transmits that same jsonb serialization, so
-- the route's verifyBody(rawBody) matches byte-for-byte.
--
-- pgcrypto (extensions.hmac) — Supabase keeps relocatable extensions in the
-- `extensions` schema; this guard is idempotent and harmless if already present.
create extension if not exists pgcrypto with schema extensions;

-- ── 1) _automation_run + ai_step branch ─────────────────────────────────────
-- CREATE OR REPLACE only. Body copied verbatim from the latest definition
-- (20260704111500_automation_run_recipient_and_target_guards.sql) with exactly
-- the `ai_step` branch + its locals (v_job_id / v_secret / v_app_url / v_sig /
-- v_hmac_body) added; every other branch is byte-for-byte unchanged.
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
  v_job_id    uuid;                     -- ai_step: the enqueued automation_ai_jobs id
  v_secret    text;                     -- ai_step: HMAC signing secret (Vault)
  v_app_url   text;                     -- ai_step: endpoint base URL (Vault)
  v_sig       text;                     -- ai_step: hex HMAC-SHA256 of the body
  v_hmac_body jsonb;                    -- ai_step: {job_id} — signed AND sent verbatim
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

      elsif a->>'type' = 'ai_step' then
        -- F13 async model hop (mirrors call_webhook): enqueue an audited job then
        -- fire a signed net.http_post {job_id}. The model NEVER runs inline; the
        -- endpoint decides one bounded action and applies it via
        -- automation_ai_apply (below). The whole ai_step config is stored on the
        -- job so the endpoint reads instruction+allow from it.
        insert into public.automation_ai_jobs
          (automation_id, org_id, board_id, item_id, config, status)
        values
          (p_automation_id, p_org_id, p_board_id, p_item_id, a, 'pending')
        returning id into v_job_id;

        select decrypted_secret into v_app_url
          from vault.decrypted_secrets where name = 'app_url';
        select decrypted_secret into v_secret
          from vault.decrypted_secrets where name = 'ai_pgnet_hmac_secret';

        if v_app_url is null or v_secret is null then
          -- Not provisioned (Vault secrets missing) — the reconcile cron will
          -- time the job out; log it so the run history stays truthful.
          v_outcome := 'ai_unconfigured';
        else
          v_hmac_body := jsonb_build_object('job_id', v_job_id);
          v_sig := encode(
            extensions.hmac(v_hmac_body::text, v_secret, 'sha256'), 'hex');
          perform net.http_post(
            url := v_app_url || '/api/ai/automation-step',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'X-Pulse-Signature', v_sig),
            body := v_hmac_body
          );
          v_outcome := 'ai_pending';
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','ai_step','outcome',v_outcome);
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

revoke execute on function public._automation_run(uuid, jsonb, jsonb, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- ── 2) automation_ai_apply — the confined applier ───────────────────────────
-- The service endpoint hands the model's chosen action here. This re-applies the
-- SAME confinement guards as _automation_run for that one action, writes an
-- automation_runs outcome, and marks the job resolved. A null/foreign choice is
-- logged as ai_skipped* and NEVER applied. Idempotent: a non-pending job no-ops.
create or replace function public.automation_ai_apply(p_job uuid, p_action jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org        uuid;
  v_board      uuid;
  v_item       uuid;
  v_automation uuid;
  v_status     text;
  v_type       text;
  v_outcome    text := 'ai_skipped';
  v_target     uuid;
  v_opt        text;
  v_kind       text;
  v_newval     jsonb;
  v_group      uuid;
  v_moved      int;
  v_rid        uuid;
begin
  select org_id, board_id, item_id, automation_id, status
    into v_org, v_board, v_item, v_automation, v_status
  from public.automation_ai_jobs
  where id = p_job;

  -- Idempotency: only a pending job is actionable (redelivery / double-apply).
  if not found or v_status <> 'pending' then
    return;
  end if;

  begin
    if p_action is null or jsonb_typeof(p_action) is distinct from 'object' then
      -- No decision (entitlement off / model declined) — log ai_skipped only.
      insert into public.automation_runs
        (automation_id, org_id, board_id, item_id, trigger_type, status, actions)
      values (v_automation, v_org, v_board, v_item, 'ai_step', 'ran',
        jsonb_build_array(jsonb_build_object('type','ai_step','outcome','ai_skipped')));
      update public.automation_ai_jobs
         set status = 'skipped', resolved_at = now()
       where id = p_job;
      return;
    end if;

    v_type := p_action->>'type';

    if v_type = 'set_option' then
      v_target := (p_action->>'columnId')::uuid;
      v_opt := p_action->>'optionId';
      -- Confine the target column to THIS board (identical to _automation_run #4b).
      select kind into v_kind from public.columns
        where id = v_target and board_id = v_board;
      if v_kind is null then
        v_outcome := 'ai_skipped_bad_target';
      else
        if v_kind = 'dropdown' then
          v_newval := jsonb_build_object('optionIds', jsonb_build_array(v_opt));
        else
          v_newval := jsonb_build_object('optionId', v_opt);
        end if;
        insert into public.cell_values (org_id, board_id, item_id, column_id, value)
        values (v_org, v_board, v_item, v_target, v_newval)
        on conflict (item_id, column_id) do update set value = excluded.value;
        v_outcome := 'ai_decided';
      end if;

    elsif v_type = 'set_percent' then
      v_target := (p_action->>'columnId')::uuid;
      if not exists (
        select 1 from public.columns where id = v_target and board_id = v_board
      ) then
        v_outcome := 'ai_skipped_bad_target';
      else
        v_newval := jsonb_build_object('percent', (p_action->>'percent')::numeric);
        insert into public.cell_values (org_id, board_id, item_id, column_id, value)
        values (v_org, v_board, v_item, v_target, v_newval)
        on conflict (item_id, column_id) do update set value = excluded.value;
        v_outcome := 'ai_decided';
      end if;

    elsif v_type = 'move_to_group' then
      v_group := (p_action->>'groupId')::uuid;
      update public.items i
         set group_id = v_group,
             position = coalesce(
               (select max(i2.position) from public.items i2
                 where i2.group_id = v_group and i2.parent_id is null),
               0
             ) + 1
       where i.id = v_item
         and i.parent_id is null
         and i.group_id is distinct from v_group
         and exists (
           select 1 from public.groups g where g.id = v_group and g.board_id = v_board
         );
      get diagnostics v_moved = row_count;
      v_outcome := case when v_moved > 0 then 'ai_decided' else 'ai_skipped_bad_target' end;

    elsif v_type = 'notify' then
      if p_action#>>'{recipient,kind}' = 'member' then
        v_rid := (p_action#>>'{recipient,userId}')::uuid;
      else
        select (cv.value->'userIds'->>0)::uuid
          into v_rid
        from public.cell_values cv
        where cv.item_id = v_item
          and cv.column_id = (p_action#>>'{recipient,peopleColumnId}')::uuid;
      end if;
      if v_rid is null then
        v_outcome := 'ai_skipped_no_recipient';
      elsif not public.is_member_of(v_rid, v_org) then
        -- recipient must be a member of the job's org (identical to #4a).
        v_outcome := 'ai_skipped_not_member';
      else
        insert into public.notifications
          (org_id, recipient_id, actor_id, kind, board_id, item_id, automation_id)
        values (v_org, v_rid, null, 'automation', v_board, v_item, v_automation);
        v_outcome := 'ai_decided';
      end if;

    else
      -- ai_step must never choose call_webhook / an unknown type; log + drop.
      v_outcome := 'ai_skipped_bad_type';
    end if;

    insert into public.automation_runs
      (automation_id, org_id, board_id, item_id, trigger_type, status, actions)
    values (v_automation, v_org, v_board, v_item, 'ai_step', 'ran',
      jsonb_build_array(jsonb_build_object('type', v_type, 'outcome', v_outcome)));
    update public.automation_ai_jobs
       set status = 'done', resolved_at = now()
     where id = p_job;

  exception when others then
    update public.automation_ai_jobs
       set status = 'error', error = sqlerrm, resolved_at = now()
     where id = p_job;
    insert into public.automation_runs
      (automation_id, org_id, board_id, item_id, trigger_type, status, error)
    values (v_automation, v_org, v_board, v_item, 'ai_step', 'error', sqlerrm);
  end;
end; $$;

-- Confined definer: only the service-role endpoint may call it. No client path.
revoke execute on function public.automation_ai_apply(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.automation_ai_apply(uuid, jsonb) to service_role;
