-- Phase 5b-1: engine — isolated condition predicate, condition gate, shared
-- action runner, person_assigned branch on cell_values, item_created on items.
-- All functions: SECURITY DEFINER, search_path='' (advisor parity).

-- 1) Build an injection-safe EXISTS/NOT EXISTS predicate for one condition,
--    bound to a specific item. Mirrors D3b's _dashboard_list_predicate but
--    isolated (no coupling to the shipped dashboards RPC).
create or replace function public._automation_condition_predicate(
  p_col uuid, p_op text, p_val text, p_item_id uuid
) returns text
language plpgsql immutable set search_path = '' as $$
declare
  e_open text := format(
    'exists(select 1 from public.cell_values cv where cv.item_id = %L and cv.column_id = %L and ',
    p_item_id, p_col
  );
  n_open text := format(
    'not exists(select 1 from public.cell_values cv where cv.item_id = %L and cv.column_id = %L and ',
    p_item_id, p_col
  );
begin
  -- malformed numeric/date values yield a guaranteed-false predicate
  if p_op in ('num_eq','num_ne','gt','lt')
     and (p_val is null or p_val !~ '^-?[0-9]+(\.[0-9]+)?$') then
    return 'false';
  end if;
  if p_op in ('before','after','on')
     and (p_val is null or p_val !~ '^\d{4}-\d{2}-\d{2}$') then
    return 'false';
  end if;

  return case p_op
    when 'is'        then e_open || format('cv.value->>''optionId'' = %L)', p_val)
    when 'is_not'    then e_open || format('cv.value->>''optionId'' is distinct from %L)', p_val)
    when 'contains'  then e_open || format('cv.value->>''text'' ilike %L)', '%' || coalesce(p_val,'') || '%')
    when 'eq'        then e_open || format('cv.value->>''text'' = %L)', p_val)
    when 'num_eq'    then e_open || format('(cv.value->>''n'')::numeric = %L::numeric)', p_val)
    when 'num_ne'    then e_open || format('(cv.value->>''n'')::numeric <> %L::numeric)', p_val)
    when 'gt'        then e_open || format('(cv.value->>''n'')::numeric > %L::numeric)', p_val)
    when 'lt'        then e_open || format('(cv.value->>''n'')::numeric < %L::numeric)', p_val)
    when 'before'    then e_open || format('(cv.value->>''date'')::date < %L::date)', p_val)
    when 'after'     then e_open || format('(cv.value->>''date'')::date > %L::date)', p_val)
    when 'on'        then e_open || format('(cv.value->>''date'')::date = %L::date)', p_val)
    when 'not_empty' then e_open || 'cv.value is not null)'
    when 'is_empty'  then n_open || 'cv.value is not null)'
    else 'false'
  end;
end; $$;

-- 2) Evaluate the whole condition jsonb against one item. NULL/empty ⇒ pass.
create or replace function public._automation_conditions_pass(
  p_condition jsonb, p_item_id uuid
) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_comb  text;
  v_preds text[] := '{}';
  c       jsonb;
  v_where text;
  v_pass  boolean;
begin
  if p_condition is null
     or jsonb_typeof(p_condition->'conditions') is distinct from 'array'
     or jsonb_array_length(p_condition->'conditions') = 0 then
    return true;
  end if;

  v_comb := case
    when lower(coalesce(p_condition->>'combinator','and')) = 'or' then 'or'
    else 'and'
  end;

  for c in select * from jsonb_array_elements(p_condition->'conditions')
  loop
    v_preds := array_append(
      v_preds,
      public._automation_condition_predicate(
        (c->>'columnId')::uuid,
        c->>'operator',
        c->>'value',
        p_item_id
      )
    );
  end loop;

  v_where := array_to_string(v_preds, ' ' || v_comb || ' ');
  execute 'select (' || v_where || ')' into v_pass;
  return coalesce(v_pass, false);
end; $$;

-- 3) Shared action runner: condition gate + the 5a notify/set_option loop.
create or replace function public._automation_run(
  p_automation_id uuid,
  p_actions jsonb,
  p_condition jsonb,
  p_item_id uuid,
  p_org_id uuid,
  p_board_id uuid,
  p_actor uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a        jsonb;
  v_rid    uuid;
  v_target uuid;
  v_opt    text;
begin
  if not public._automation_conditions_pass(p_condition, p_item_id) then
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

      if v_rid is not null and v_rid is distinct from p_actor then
        if not exists (
          select 1 from public.notifications n
          where n.recipient_id = v_rid
            and n.item_id = p_item_id
            and n.automation_id = p_automation_id
            and n.read_at is null
        ) then
          insert into public.notifications
            (org_id, recipient_id, actor_id, kind, board_id, item_id, automation_id)
          values
            (p_org_id, v_rid, p_actor, 'automation', p_board_id, p_item_id, p_automation_id);
        end if;
      end if;

    elsif a->>'type' = 'set_option' then
      v_target := (a->>'columnId')::uuid;
      v_opt := a->>'optionId';
      if not exists (
        select 1 from public.cell_values cv
        where cv.item_id = p_item_id
          and cv.column_id = v_target
          and cv.value->>'optionId' = v_opt
      ) then
        insert into public.cell_values (org_id, board_id, item_id, column_id, value)
        values (p_org_id, p_board_id, p_item_id, v_target,
                jsonb_build_object('optionId', v_opt))
        on conflict (item_id, column_id) do update set value = excluded.value;
      end if;
    end if;
  end loop;
end; $$;

-- 4) Replace the cell_values trigger: status_changed (5a) + person_assigned (new).
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

  -- True iff a People cell gained a userId (addition). Empty for non-people cells.
  v_assigned := exists (
    select 1
    from jsonb_array_elements_text(coalesce(new.value->'userIds', '[]'::jsonb)) nu(uid)
    where tg_op = 'INSERT'
       or not (coalesce(old.value->'userIds', '[]'::jsonb) ? nu.uid)
  );

  for r in
    select id, actions, condition
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
      r.id, r.actions, r.condition, new.item_id, new.org_id, new.board_id, v_actor
    );
  end loop;

  return new;
end; $$;

-- 5) New items AFTER INSERT trigger for item_created rules.
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
      r.id, r.actions, r.condition, new.id, new.org_id, new.board_id, v_actor
    );
  end loop;

  return new;
end; $$;

drop trigger if exists items_run_automations on public.items;
create trigger items_run_automations
  after insert on public.items
  for each row execute function public.tg_run_item_automations();
