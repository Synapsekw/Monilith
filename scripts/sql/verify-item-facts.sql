-- verify-item-facts.sql: run via supabase-dev execute_sql as ONE batch.
-- Fixtures live inside begin; ... rollback; nothing is committed.
-- Every read is `into strict` and every check is `is distinct from`, so a
-- missing/duplicated row or a NULL result raises instead of passing silently.
begin;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

do $verify$
declare
  v_org uuid;
  v_ws uuid;
  v_user uuid;
  v_user2 uuid := gen_random_uuid();   -- never assigned anywhere
  v_outsider uuid;                     -- member of a DIFFERENT org only
  v_board uuid := gen_random_uuid();
  v_board_arch uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_group_arch uuid := gen_random_uuid();
  v_group_b2 uuid := gen_random_uuid();
  v_status uuid := gen_random_uuid();
  v_status2 uuid := gen_random_uuid();
  v_date uuid := gen_random_uuid();
  v_date2 uuid := gen_random_uuid();
  v_people uuid := gen_random_uuid();
  v_open uuid := gen_random_uuid();
  v_done uuid := gen_random_uuid();
  v_shipped uuid := gen_random_uuid();
  v_bad uuid := gen_random_uuid();
  v_feb31 uuid := gen_random_uuid();
  v_m13 uuid := gen_random_uuid();
  v_nullppl uuid := gen_random_uuid();
  v_arch_item uuid := gen_random_uuid();
  v_in_arch_group uuid := gen_random_uuid();
  v_in_arch_board uuid := gen_random_uuid();
  -- Better guesses (20261115073021): separate boards so the cases above stay put.
  v_board3 uuid := gen_random_uuid();
  v_board4 uuid := gen_random_uuid();
  v_board5 uuid := gen_random_uuid();
  v_group3 uuid := gen_random_uuid();
  v_group4 uuid := gen_random_uuid();
  v_group5 uuid := gen_random_uuid();
  v_status3 uuid := gen_random_uuid();
  v_start3 uuid := gen_random_uuid();
  v_cal3 uuid := gen_random_uuid();
  v_due3 uuid := gen_random_uuid();
  v_start4 uuid := gen_random_uuid();
  v_cal4 uuid := gen_random_uuid();
  v_start5 uuid := gen_random_uuid();
  v_cancelled uuid := gen_random_uuid();
  v_incomplete uuid := gen_random_uuid();
  v_notdone uuid := gen_random_uuid();
  v_completed uuid := gen_random_uuid();
  v_item4 uuid := gen_random_uuid();
  v_item5 uuid := gen_random_uuid();
  r record;
  n int;
  ids uuid[];
  ok boolean;
begin
  select w.org_id, w.id into strict v_org, v_ws from public.workspaces w limit 1;
  select m.user_id into strict v_user from public.org_members m
   where m.org_id = v_org limit 1;
  select m.user_id into strict v_outsider from public.org_members m
   where m.org_id <> v_org
     and not exists (select 1 from public.org_members x
                      where x.org_id = v_org and x.user_id = m.user_id)
   limit 1;

  insert into public.boards (id, org_id, workspace_id, name, created_by, position) values
    (v_board, v_org, v_ws, 'verify item_facts', v_user, 0);
  insert into public.boards (id, org_id, workspace_id, name, created_by, position, archived_at) values
    (v_board_arch, v_org, v_ws, 'verify item_facts archived', v_user, 0, now());
  insert into public.groups (id, org_id, board_id, name, position) values
    (v_group, v_org, v_board, 'G', 0),
    (v_group_b2, v_org, v_board_arch, 'G', 0);
  insert into public.groups (id, org_id, board_id, name, position, archived_at) values
    (v_group_arch, v_org, v_board, 'Archived G', 1, now());
  insert into public.columns (id, org_id, board_id, name, kind, position, settings) values
    (v_status, v_org, v_board, 'Status', 'status', 1,
      '{"options":[{"id":"a","label":"Working","color":"#1"},{"id":"b","label":"Done","color":"#2"},{"id":"c","label":"Shipped","color":"#3"}]}'),
    (v_status2, v_org, v_board, 'Review', 'status', 5,
      '{"options":[{"id":"x","label":"Approved","color":"#4"},{"id":"y","label":"Completed","color":"#5"}]}'),
    (v_date, v_org, v_board, 'Due', 'date', 2, '{}'),
    (v_date2, v_org, v_board, 'Due 2', 'date', 4, '{}'),
    (v_people, v_org, v_board, 'Owner', 'people', 3, '{}');
  insert into public.items (id, org_id, board_id, group_id, name, position, created_by) values
    (v_open, v_org, v_board, v_group, 'open', 1, v_user),
    (v_done, v_org, v_board, v_group, 'done', 2, v_user),
    (v_shipped, v_org, v_board, v_group, 'shipped', 3, v_user),
    (v_bad, v_org, v_board, v_group, 'bad date', 4, v_user),
    (v_feb31, v_org, v_board, v_group, 'feb 31', 5, v_user),
    (v_m13, v_org, v_board, v_group, 'month 13', 6, v_user),
    (v_nullppl, v_org, v_board, v_group, 'null person', 7, v_user),
    (v_in_arch_group, v_org, v_board, v_group_arch, 'in archived group', 8, v_user),
    (v_in_arch_board, v_org, v_board_arch, v_group_b2, 'in archived board', 1, v_user);
  insert into public.items (id, org_id, board_id, group_id, name, position, created_by, archived_at) values
    (v_arch_item, v_org, v_board, v_group, 'archived item', 9, v_user, now());
  insert into public.cell_values (org_id, board_id, item_id, column_id, value) values
    (v_org, v_board, v_open, v_status, '{"optionId":"a"}'),
    (v_org, v_board, v_open, v_status2, '{"optionId":"x"}'),
    (v_org, v_board, v_open, v_date, '{"date":"2026-11-01","end":"2026-11-05"}'),
    (v_org, v_board, v_open, v_date2, '{"date":"2026-12-25"}'),
    (v_org, v_board, v_open, v_people, jsonb_build_object('userIds', jsonb_build_array(v_user::text))),
    (v_org, v_board, v_done, v_status, '{"optionId":"b"}'),
    (v_org, v_board, v_shipped, v_status, '{"optionId":"c"}'),
    (v_org, v_board, v_shipped, v_status2, '{"optionId":"y"}'),
    (v_org, v_board, v_bad, v_date, '{"date":"soon"}'),
    (v_org, v_board, v_feb31, v_date, '{"date":"2026-02-31"}'),
    (v_org, v_board, v_m13, v_date, '{"date":"2026-13-01"}'),
    (v_org, v_board, v_nullppl, v_people, jsonb_build_object('userIds', jsonb_build_array(null, v_user::text))),
    (v_org, v_board, v_arch_item, v_status, '{"optionId":"a"}'),
    (v_org, v_board, v_in_arch_group, v_status, '{"optionId":"a"}');

  -- Row set: exactly the 7 live items, each exactly once; excluded ones absent.
  select count(*) into n from public.item_facts where board_id = v_board;
  if n is distinct from 7 then raise exception 'expected 7 live rows on fixture board, got %', n; end if;
  select count(*) into n from public.item_facts
   where item_id in (v_open, v_done, v_shipped, v_bad, v_feb31, v_m13, v_nullppl);
  if n is distinct from 7 then raise exception 'each live fixture item must appear once, got %', n; end if;
  if exists (select 1 from public.item_facts where item_id = v_arch_item) then
    raise exception 'archived item must be absent'; end if;
  if exists (select 1 from public.item_facts where item_id = v_in_arch_group) then
    raise exception 'item in archived group must be absent'; end if;
  if exists (select 1 from public.item_facts where item_id = v_in_arch_board)
     or exists (select 1 from public.item_facts where board_id = v_board_arch) then
    raise exception 'item on archived board must be absent'; end if;

  -- Guess mode: LOWEST-position status (pos 1) and date (pos 2) columns.
  select * into strict r from public.item_facts where item_id = v_open;
  if r.status_column_id is distinct from v_status
     or r.status_option_id is distinct from 'a'
     or r.status_label is distinct from 'Working'
     or r.status_color is distinct from '#1'
     or r.is_done is distinct from false
     or r.due_column_id is distinct from v_date
     or r.due_date is distinct from date '2026-11-05'
     or r.org_id is distinct from v_org
     or r.board_id is distinct from v_board
     or r.group_id is distinct from v_group
     or r.name is distinct from 'open' then
    raise exception 'open item wrong: %', row_to_json(r);
  end if;
  select * into strict r from public.item_facts where item_id = v_done;
  if r.is_done is distinct from true or r.status_label is distinct from 'Done' then
    raise exception 'Done label not detected: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_shipped;
  if r.is_done is distinct from false or r.status_label is distinct from 'Shipped' then
    raise exception 'Shipped must be open under the guess: %', row_to_json(r); end if;

  -- Impossible / malformed dates: NULL, no raise, other rows still readable.
  select * into strict r from public.item_facts where item_id = v_bad;
  if r.due_date is not null or r.due_column_id is distinct from v_date then
    raise exception 'malformed date must be null: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_feb31;
  if r.due_date is not null then raise exception '2026-02-31 must be null: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_m13;
  if r.due_date is not null then raise exception '2026-13-01 must be null: %', row_to_json(r); end if;
  -- One query that touches the bad rows AND good rows must not raise.
  select count(*) into n from public.item_facts
   where board_id = v_board and (due_date is null or due_date >= date '2000-01-01');
  if n is distinct from 7 then raise exception 'bad dates broke a wide read: %', n; end if;

  -- Explicit work_status_column_id = second status column.
  update public.boards set work_status_column_id = v_status2 where id = v_board;
  select * into strict r from public.item_facts where item_id = v_open;
  if r.status_column_id is distinct from v_status2
     or r.status_label is distinct from 'Approved'
     or r.is_done is distinct from false then
    raise exception 'explicit status column ignored (open): %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_shipped;
  if r.status_label is distinct from 'Completed' or r.is_done is distinct from true then
    raise exception 'explicit status column ignored (shipped): %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_done;
  if r.status_label is not null or r.is_done is distinct from false then
    raise exception 'done item has no status2 cell: %', row_to_json(r); end if;

  -- Explicit work_due_column_id = second date column.
  update public.boards set work_due_column_id = v_date2 where id = v_board;
  select * into strict r from public.item_facts where item_id = v_open;
  if r.due_column_id is distinct from v_date2 or r.due_date is distinct from date '2026-12-25' then
    raise exception 'explicit due column ignored: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_feb31;
  if r.due_column_id is distinct from v_date2 or r.due_date is not null then
    raise exception 'feb31 under date2 must be null: %', row_to_json(r); end if;

  -- Explicit done option ids win over the label guess.
  update public.boards
     set work_status_column_id = v_status, work_done_option_ids = array['c']
   where id = v_board;
  select * into strict r from public.item_facts where item_id = v_shipped;
  if r.is_done is distinct from true then raise exception 'explicit done option ignored: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_done;
  if r.is_done is distinct from false then
    raise exception 'label guess must not apply once options are set: %', row_to_json(r); end if;

  -- Assignee helpers.
  select array_agg(a order by a) into ids from public.items_assigned_to(v_user) a
   where a in (v_open, v_nullppl, v_done, v_shipped);
  if ids is distinct from (select array_agg(x order by x) from unnest(array[v_open, v_nullppl]) x) then
    raise exception 'items_assigned_to(user) wrong: %', ids; end if;
  select count(*) into n from public.items_assigned_to(v_user2);
  if n is distinct from 0 then raise exception 'unassigned user must match nothing: %', n; end if;
  if public.item_assignee_ids(v_open) is distinct from jsonb_build_array(v_user::text) then
    raise exception 'item_assignee_ids wrong: %', public.item_assignee_ids(v_open); end if;
  if public.item_assignee_ids(v_done) is distinct from '[]'::jsonb then
    raise exception 'item without people cell must be []: %', public.item_assignee_ids(v_done); end if;
  if public.item_assignee_ids(v_nullppl) is distinct from jsonb_build_array(v_user::text) then
    raise exception 'JSON null must be excluded: %', public.item_assignee_ids(v_nullppl); end if;

  -- Stale done list (review I1): deleting the configured status column nulls
  -- work_status_column_id through its FK but leaves work_done_option_ids. The
  -- dead list must not apply; the guess takes over (lowest remaining status
  -- column = Review, where 'Completed' matches the done label).
  delete from public.columns where id = v_status;
  select b.work_status_column_id is null and b.work_done_option_ids = array['c']
    into strict ok from public.boards b where b.id = v_board;
  if ok is distinct from true then
    raise exception 'fixture: FK should null the column and keep the done list'; end if;
  select * into strict r from public.item_facts where item_id = v_shipped;
  if r.status_column_id is distinct from v_status2
     or r.status_label is distinct from 'Completed'
     or r.is_done is distinct from true then
    raise exception 'stale done list must fall back to the guess: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_open;
  if r.status_label is distinct from 'Approved' or r.is_done is distinct from false then
    raise exception 'stale done list: open item wrong: %', row_to_json(r); end if;

  -- Better guesses (20261115073021). Parity: src/lib/boards/work-guess.test.ts
  -- asserts the same labels and column names, so keep the two in step.
  -- Board 3: 'Start' sits at a LOWER position than 'Due date', and 'Calendar'
  -- (contains "end" but not as a word) sits between them. The due guess must
  -- pick 'Due date'. Labels: Cancelled and Completed are done; Incomplete and
  -- Not done are open.
  insert into public.boards (id, org_id, workspace_id, name, created_by, position) values
    (v_board3, v_org, v_ws, 'verify item_facts guesses', v_user, 0),
    (v_board4, v_org, v_ws, 'verify item_facts no due name', v_user, 0),
    (v_board5, v_org, v_ws, 'verify item_facts start only', v_user, 0);
  insert into public.groups (id, org_id, board_id, name, position) values
    (v_group3, v_org, v_board3, 'G', 0),
    (v_group4, v_org, v_board4, 'G', 0),
    (v_group5, v_org, v_board5, 'G', 0);
  insert into public.columns (id, org_id, board_id, name, kind, position, settings) values
    (v_status3, v_org, v_board3, 'Status', 'status', 0,
      '{"options":[{"id":"k","label":"Cancelled","color":"#6"},{"id":"i","label":"Incomplete","color":"#7"},{"id":"n","label":"Not done","color":"#8"},{"id":"m","label":"Completed","color":"#9"}]}'),
    (v_start3, v_org, v_board3, 'Start', 'date', 1, '{}'),
    (v_cal3, v_org, v_board3, 'Calendar', 'date', 2, '{}'),
    (v_due3, v_org, v_board3, 'Due date', 'date', 6, '{}'),
    -- Board 4: no due-like name; 'Calendar' must beat the lower-position 'Start'.
    (v_start4, v_org, v_board4, 'Start', 'date', 1, '{}'),
    (v_cal4, v_org, v_board4, 'Calendar', 'date', 2, '{}'),
    -- Board 5: a lone 'Start' column is still the fallback.
    (v_start5, v_org, v_board5, 'Start', 'date', 1, '{}');
  insert into public.items (id, org_id, board_id, group_id, name, position, created_by) values
    (v_cancelled, v_org, v_board3, v_group3, 'cancelled', 1, v_user),
    (v_incomplete, v_org, v_board3, v_group3, 'incomplete', 2, v_user),
    (v_notdone, v_org, v_board3, v_group3, 'not done', 3, v_user),
    (v_completed, v_org, v_board3, v_group3, 'completed', 4, v_user),
    (v_item4, v_org, v_board4, v_group4, 'board 4 item', 1, v_user),
    (v_item5, v_org, v_board5, v_group5, 'board 5 item', 1, v_user);
  insert into public.cell_values (org_id, board_id, item_id, column_id, value) values
    (v_org, v_board3, v_cancelled, v_status3, '{"optionId":"k"}'),
    (v_org, v_board3, v_cancelled, v_start3, '{"date":"2026-01-01"}'),
    (v_org, v_board3, v_cancelled, v_cal3, '{"date":"2026-02-02"}'),
    (v_org, v_board3, v_cancelled, v_due3, '{"date":"2026-03-03"}'),
    (v_org, v_board3, v_incomplete, v_status3, '{"optionId":"i"}'),
    (v_org, v_board3, v_notdone, v_status3, '{"optionId":"n"}'),
    (v_org, v_board3, v_completed, v_status3, '{"optionId":"m"}'),
    (v_org, v_board4, v_item4, v_start4, '{"date":"2026-04-04"}'),
    (v_org, v_board4, v_item4, v_cal4, '{"date":"2026-05-05"}'),
    (v_org, v_board5, v_item5, v_start5, '{"date":"2026-06-06"}');

  -- A: due column guess by name.
  select * into strict r from public.item_facts where item_id = v_cancelled;
  if r.due_column_id is distinct from v_due3 or r.due_date is distinct from date '2026-03-03' then
    raise exception 'due guess must prefer Due date over Start/Calendar: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_item4;
  if r.due_column_id is distinct from v_cal4 or r.due_date is distinct from date '2026-05-05' then
    raise exception 'due guess must rank Start after Calendar: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_item5;
  if r.due_column_id is distinct from v_start5 or r.due_date is distinct from date '2026-06-06' then
    raise exception 'a lone Start column must still be the due guess: %', row_to_json(r); end if;
  select count(*) into n from public.item_facts
   where board_id = v_board3 and due_column_id is distinct from v_due3;
  if n is distinct from 0 then raise exception 'every board 3 row must use Due date, % do not', n; end if;

  -- B: done label guess.
  select * into strict r from public.item_facts where item_id = v_cancelled;
  if r.status_label is distinct from 'Cancelled' or r.is_done is distinct from true then
    raise exception 'Cancelled must be done: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_completed;
  if r.status_label is distinct from 'Completed' or r.is_done is distinct from true then
    raise exception 'Completed must be done: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_incomplete;
  if r.status_label is distinct from 'Incomplete' or r.is_done is distinct from false then
    raise exception 'Incomplete must be open: %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_notdone;
  if r.status_label is distinct from 'Not done' or r.is_done is distinct from false then
    raise exception 'Not done must be open: %', row_to_json(r); end if;

  -- Explicit settings still win over both guesses.
  update public.boards
     set work_due_column_id = v_start3,
         work_status_column_id = v_status3,
         work_done_option_ids = array['n']
   where id = v_board3;
  select * into strict r from public.item_facts where item_id = v_cancelled;
  if r.due_column_id is distinct from v_start3 or r.due_date is distinct from date '2026-01-01'
     or r.is_done is distinct from false then
    raise exception 'explicit settings must override the guesses (cancelled): %', row_to_json(r); end if;
  select * into strict r from public.item_facts where item_id = v_notdone;
  if r.is_done is distinct from true then
    raise exception 'explicit done list must override the guess (not done): %', row_to_json(r); end if;

  -- RLS (negative only): a member of ANOTHER org sees none of the fixture board.
  -- The positive case is skipped: it needs board/workspace visibility rows for
  -- the fixture user that this script would have to invent.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.item_facts where board_id = v_board;
  reset role;
  if n is distinct from 0 then raise exception 'cross-org user sees % fixture rows', n; end if;

  raise notice 'verify-item-facts: all checks passed';
end
$verify$;

rollback;

-- Visible pass marker (the MCP does not surface RAISE NOTICE; any failure above raises).
select 'verify-item-facts: all checks passed' as result;
