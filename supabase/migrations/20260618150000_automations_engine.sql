-- Phase 5a: in-DB automation engine. AFTER trigger on cell_values evaluates
-- enabled rules whose trigger column matches the changed cell, then runs their
-- actions (notify / set_option). A transaction-local depth guard caps cascades
-- (legitimate chains allowed up to depth 5; runaway loops bounded). Mirrors the
-- existing SECURITY DEFINER + search_path='' trigger pattern.
create or replace function public.tg_run_automations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_depth  int  := coalesce(current_setting('pulse.aut_depth', true)::int, 0);
  v_actor  uuid := (select auth.uid());
  v_new_opt text := new.value->>'optionId';
  r        record;
  a        jsonb;
  v_rid    uuid;
  v_target uuid;
  v_opt    text;
begin
  if (tg_op = 'UPDATE' and new.value is not distinct from old.value) then
    return new;
  end if;

  if v_depth >= 5 then
    return new;
  end if;
  perform set_config('pulse.aut_depth', (v_depth + 1)::text, true);

  for r in
    select id, actions
    from public.automations
    where board_id = new.board_id
      and enabled
      and trigger->>'columnId' = new.column_id::text
      and (
        trigger->>'toOptionId' is null
        or trigger->>'toOptionId' = v_new_opt
        or (new.value ? 'optionIds'
            and (new.value->'optionIds') ? (trigger->>'toOptionId'))
      )
  loop
    for a in select * from jsonb_array_elements(r.actions)
    loop
      if a->>'type' = 'notify' then
        if a#>>'{recipient,kind}' = 'member' then
          v_rid := (a#>>'{recipient,userId}')::uuid;
        else
          select (cv.value->'userIds'->>0)::uuid
            into v_rid
          from public.cell_values cv
          where cv.item_id = new.item_id
            and cv.column_id = (a#>>'{recipient,peopleColumnId}')::uuid;
        end if;

        if v_rid is not null and v_rid is distinct from v_actor then
          if not exists (
            select 1 from public.notifications n
            where n.recipient_id = v_rid
              and n.item_id = new.item_id
              and n.automation_id = r.id
              and n.read_at is null
          ) then
            insert into public.notifications
              (org_id, recipient_id, actor_id, kind, board_id, item_id, automation_id)
            values
              (new.org_id, v_rid, v_actor, 'automation', new.board_id, new.item_id, r.id);
          end if;
        end if;

      elsif a->>'type' = 'set_option' then
        v_target := (a->>'columnId')::uuid;
        v_opt := a->>'optionId';
        if not exists (
          select 1 from public.cell_values cv
          where cv.item_id = new.item_id
            and cv.column_id = v_target
            and cv.value->>'optionId' = v_opt
        ) then
          insert into public.cell_values (org_id, board_id, item_id, column_id, value)
          values (new.org_id, new.board_id, new.item_id, v_target,
                  jsonb_build_object('optionId', v_opt))
          on conflict (item_id, column_id) do update set value = excluded.value;
        end if;
      end if;
    end loop;
  end loop;

  return new;
end; $$;

create trigger cell_values_run_automations
  after insert or update on public.cell_values
  for each row execute function public.tg_run_automations();
