begin;

do $verify$
declare
  v_org uuid;
  v_ws uuid;
  v_user uuid;
  v_board uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_status uuid := gen_random_uuid();
  v_status2 uuid := gen_random_uuid();
  v_date uuid := gen_random_uuid();
  v_people uuid := gen_random_uuid();
  v_open uuid := gen_random_uuid();
  v_done uuid := gen_random_uuid();
  v_shipped uuid := gen_random_uuid();
  v_bad uuid := gen_random_uuid();
  r record;
begin
  select w.org_id, w.id into v_org, v_ws from public.workspaces w limit 1;
  select m.user_id into v_user from public.org_members m
   where m.org_id = v_org limit 1;

  insert into public.boards (id, org_id, workspace_id, name, created_by, position)
    values (v_board, v_org, v_ws, 'verify item_facts', v_user, 0);
  insert into public.groups (id, org_id, board_id, name, position)
    values (v_group, v_org, v_board, 'G', 0);
  insert into public.columns (id, org_id, board_id, name, kind, position, settings) values
    (v_status, v_org, v_board, 'Status', 'status', 1,
      '{"options":[{"id":"a","label":"Working","color":"#1"},{"id":"b","label":"Done","color":"#2"},{"id":"c","label":"Shipped","color":"#3"}]}'),
    (v_status2, v_org, v_board, 'Review', 'status', 5,
      '{"options":[{"id":"x","label":"Approved","color":"#4"}]}'),
    (v_date, v_org, v_board, 'Due', 'date', 2, '{}'),
    (v_people, v_org, v_board, 'Owner', 'people', 3, '{}');
  insert into public.items (id, org_id, board_id, group_id, name, position, created_by) values
    (v_open, v_org, v_board, v_group, 'open', 1, v_user),
    (v_done, v_org, v_board, v_group, 'done', 2, v_user),
    (v_shipped, v_org, v_board, v_group, 'shipped', 3, v_user),
    (v_bad, v_org, v_board, v_group, 'bad date', 4, v_user);
  insert into public.cell_values (org_id, board_id, item_id, column_id, value) values
    (v_org, v_board, v_open, v_status, '{"optionId":"a"}'),
    (v_org, v_board, v_open, v_date, '{"date":"2026-11-01","end":"2026-11-05"}'),
    (v_org, v_board, v_open, v_people, jsonb_build_object('userIds', jsonb_build_array(v_user::text))),
    (v_org, v_board, v_done, v_status, '{"optionId":"b"}'),
    (v_org, v_board, v_shipped, v_status, '{"optionId":"c"}'),
    (v_org, v_board, v_bad, v_date, '{"date":"soon"}');

  -- Guess mode: first status column, label ~ done|complete.
  select * into r from public.item_facts where item_id = v_open;
  if r.is_done or r.status_label <> 'Working' or r.due_date <> date '2026-11-05' then
    raise exception 'open item wrong: %', row_to_json(r);
  end if;
  select * into r from public.item_facts where item_id = v_done;
  if not r.is_done then raise exception 'Done label not detected'; end if;
  select * into r from public.item_facts where item_id = v_shipped;
  if r.is_done then raise exception 'Shipped must be open under the guess'; end if;
  select * into r from public.item_facts where item_id = v_bad;
  if r.due_date is not null then raise exception 'malformed date must be null'; end if;

  -- Explicit settings win.
  update public.boards
     set work_status_column_id = v_status, work_done_option_ids = array['c']
   where id = v_board;
  select * into r from public.item_facts where item_id = v_shipped;
  if not r.is_done then raise exception 'explicit done option ignored'; end if;
  select * into r from public.item_facts where item_id = v_done;
  if r.is_done then raise exception 'label guess must not apply once options are set'; end if;

  -- Assignee helpers.
  if not exists (select 1 from public.items_assigned_to(v_user) a where a = v_open) then
    raise exception 'items_assigned_to missed the assigned item';
  end if;
  if public.item_assignee_ids(v_open) <> jsonb_build_array(v_user::text) then
    raise exception 'item_assignee_ids wrong';
  end if;

  raise notice 'verify-item-facts: all checks passed';
end
$verify$;

rollback;
