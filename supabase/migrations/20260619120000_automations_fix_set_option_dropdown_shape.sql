-- Fix: automation `set_option` must write the target column's NATIVE value shape.
--
-- The 5a engine always wrote the status shape `{optionId: x}`. For a DROPDOWN
-- target column (which stores `{optionIds: [...]}`), that shape is unreadable by
-- the client — `DropdownCell` reads `value.optionIds`, so the cell renders BLANK
-- even though the row exists in the DB (run-history still logs `set`, since the
-- engine did write — just in the wrong shape). Recreate `_automation_run` so the
-- `set_option` branch builds the value from the target column's `kind`, and
-- compare equality on the full value. Same 8-arg signature → in-place replace
-- (no overload). Then backfill any dropdown cells already written in the wrong
-- shape.

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
  v_kind     text;
  v_newval   jsonb;
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
        -- Build the value in the target column's native shape: a dropdown stores
        -- an optionIds[] array; status (and the null fallback) store a singular
        -- optionId.
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

-- Backfill: repair dropdown cells previously written by the engine in the wrong
-- singular shape ({optionId: x} → {optionIds: [x]}). Manual edits already use the
-- correct shape, so this targets only engine-corrupted cells. Idempotent.
update public.cell_values cv
set value = jsonb_build_object('optionIds', jsonb_build_array(cv.value->>'optionId'))
from public.columns c
where c.id = cv.column_id
  and c.kind = 'dropdown'
  and cv.value ? 'optionId'
  and not (cv.value ? 'optionIds')
  and (cv.value->>'optionId') is not null;
