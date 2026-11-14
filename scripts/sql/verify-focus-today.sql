-- verify-focus-today.sql: run via supabase-dev execute_sql as ONE batch.
-- Everything lives inside begin; ... rollback; nothing is committed.
-- Reads are `into strict`; every comparison is `is distinct from <expected>`
-- so a missing/duplicated row or a NULL result raises instead of passing.
-- Exact row sets AND exact order are asserted (ordered arrays of item names).
-- Fixture rows are inserted in a scrambled order so a missing ORDER BY fails.
-- The function reads auth.uid(): we impersonate via request.jwt.claims, and
-- call it both as the table owner and under `set local role authenticated`.
begin;

do $verify$
declare
  v_org uuid;
  v_ws uuid;
  v_user uuid;
  v_other uuid;
  v_outsider uuid;
  v_other_org uuid;
  v_board uuid := gen_random_uuid();
  v_board2 uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_group_arch uuid := gen_random_uuid();
  v_group2 uuid := gen_random_uuid();
  v_status uuid := gen_random_uuid();
  v_date uuid := gen_random_uuid();
  v_people uuid := gen_random_uuid();
  v_folder uuid := gen_random_uuid();
  v_today constant date := date '2026-11-14';
  r record;
  n int;
  names text[];
  tiers int[];
  exp_names constant text[] := array[
    'overdue','overdue_and_blocking',
    'blocker2','blocker',
    'today_due','soon',
    'mentioned','mentioned_old',
    'stalled_old','stalled'];
  exp_tiers constant int[] := array[1,1,2,2,3,3,4,4,5,5];
begin
  -- Fixture org: >= 2 active members, a workspace, fewest items (so unscoped
  -- calls are not drowned in real data).
  select o.org_id into strict v_org
    from (select m.org_id, count(*) c from public.org_members m
           where m.deactivated_at is null and m.role <> 'agent'
           group by 1 having count(*) >= 2) o
    join public.workspaces w on w.org_id = o.org_id
    order by (select count(*) from public.items i where i.org_id = o.org_id), o.org_id
    limit 1;
  select w.id into strict v_ws from public.workspaces w where w.org_id = v_org
    order by w.id limit 1;
  -- Fixture user: owner/admin/member (never guest/agent), not a Mono, no in-app
  -- opt-out for mention/update_on_item (gate_notification_by_pref would silently
  -- drop the fixture notifications), and the FEWEST real assigned items so real
  -- data cannot crowd the fixtures out of a limit-50 page.
  select m.user_id into strict v_user from public.org_members m
   where m.org_id = v_org and m.deactivated_at is null
     and m.role in ('owner','admin','member')
     and not exists (select 1 from public.profiles p where p.id = m.user_id and p.is_agent)
     and not exists (select 1 from public.monos mo where mo.user_id = m.user_id)
     and not exists (select 1 from public.notification_preferences np
                      where np.user_id = m.user_id and np.channel = 'in_app'
                        and np.kind in ('mention','update_on_item'))
   order by (select count(*) from public.items_assigned_to(m.user_id)), m.user_id
   limit 1;
  select m.user_id into strict v_other from public.org_members m
   where m.org_id = v_org and m.deactivated_at is null
     and m.role in ('owner','admin','member')
     and not exists (select 1 from public.profiles p where p.id = m.user_id and p.is_agent)
     and not exists (select 1 from public.monos mo where mo.user_id = m.user_id)
     and m.user_id <> v_user order by m.user_id limit 1;
  select m.user_id, m.org_id into strict v_outsider, v_other_org
    from public.org_members m
   where m.org_id <> v_org
     and not exists (select 1 from public.org_members x
                      where x.org_id = v_org and x.user_id = m.user_id)
   order by m.user_id limit 1;

  insert into public.boards (id, org_id, workspace_id, name, created_by, position) values
    (v_board, v_org, v_ws, 'verify focus_today', v_user, 0),
    (v_board2, v_org, v_ws, 'verify focus_today off-folder', v_user, 0);
  insert into public.groups (id, org_id, board_id, name, position) values
    (v_group, v_org, v_board, 'Sprint 4', 0),
    (v_group2, v_org, v_board2, 'Other', 0);
  insert into public.groups (id, org_id, board_id, name, position, archived_at) values
    (v_group_arch, v_org, v_board, 'Archived G', 1, now());
  insert into public.columns (id, org_id, board_id, name, kind, position, settings) values
    (v_status, v_org, v_board, 'Status', 'status', 1,
      '{"options":[{"id":"a","label":"Working","color":"#1"},{"id":"b","label":"Done","color":"#2"}]}'),
    (v_date, v_org, v_board, 'Due', 'date', 2, '{}'),
    (v_people, v_org, v_board, 'Owner', 'people', 3, '{}');
  insert into public.folders (id, org_id, workspace_id, name, created_by)
    values (v_folder, v_org, v_ws, 'verify focus_today folder', v_user);
  insert into public.folder_boards (folder_id, board_id) values (v_folder, v_board);

  -- Scrambled insertion order (NOT the expected output order).
  create temp table fx (name text primary key, id uuid not null default gen_random_uuid(),
                        grp uuid, brd uuid) on commit drop;
  insert into fx (name, grp, brd) values
    ('stalled', v_group, v_board), ('later', v_group, v_board),
    ('soon', v_group, v_board), ('mentioned_old', v_group, v_board),
    ('blocker', v_group, v_board), ('finished', v_group, v_board),
    ('overdue_and_blocking', v_group, v_board), ('w2b', v_group, v_board),
    ('mention_done', v_group, v_board), ('self_blocker', v_group, v_board),
    ('stalled_old', v_group, v_board), ('own_next', v_group, v_board),
    ('today_due', v_group, v_board), ('waiter', v_group, v_board),
    ('chatty', v_group, v_board), ('blocker2', v_group, v_board),
    ('in_arch_group', v_group_arch, v_board), ('w2a', v_group, v_board),
    ('mentioned', v_group, v_board), ('pred_of_done', v_group, v_board),
    ('read_mention', v_group, v_board), ('overdue', v_group, v_board),
    ('done_succ', v_group, v_board), ('w2c', v_group, v_board),
    ('fresh', v_group, v_board), ('off_folder', v_group2, v_board2);
  insert into public.items (id, org_id, board_id, group_id, name, position, created_by)
    select f.id, v_org, f.brd, f.grp, f.name, row_number() over (order by f.name), v_user
    from fx f;

  -- people column: 'u' = v_user, 'o' = v_other.
  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org, f.brd, f.id, v_people,
         jsonb_build_object('userIds', jsonb_build_array(
           case a.who when 'u' then v_user::text else v_other::text end))
  from fx f
  join (values
    ('overdue','u'),('overdue_and_blocking','u'),('blocker','u'),('blocker2','u'),
    ('waiter','o'),('w2a','o'),('w2b','o'),('w2c','o'),
    ('self_blocker','u'),('own_next','u'),('soon','u'),('today_due','u'),
    ('mentioned','o'),('mentioned_old','o'),('read_mention','o'),('mention_done','o'),
    ('stalled','u'),('stalled_old','u'),('fresh','u'),('chatty','u'),
    ('finished','u'),('later','u'),('in_arch_group','u'),('pred_of_done','u'),
    ('done_succ','o')
  ) as a(nm, who) on a.nm = f.name
  where f.brd = v_board;
  -- off_folder lives on board2, which has no people column of its own: give it
  -- one so it is assigned to v_user there.
  insert into public.columns (id, org_id, board_id, name, kind, position, settings)
    values (gen_random_uuid(), v_org, v_board2, 'Owner', 'people', 1, '{}'),
           (gen_random_uuid(), v_org, v_board2, 'Due', 'date', 2, '{}');
  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org, v_board2, f.id, c.id, jsonb_build_object('userIds', jsonb_build_array(v_user::text))
    from fx f, public.columns c
   where f.name = 'off_folder' and c.board_id = v_board2 and c.kind = 'people';
  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org, v_board2, f.id, c.id, '{"date":"2026-11-11"}'
    from fx f, public.columns c
   where f.name = 'off_folder' and c.board_id = v_board2 and c.kind = 'date';
  -- status
  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org, v_board, f.id, v_status, jsonb_build_object('optionId', s.opt)
  from fx f join (values
    ('overdue','a'),('overdue_and_blocking','a'),('waiter','a'),
    ('finished','b'),('mention_done','b'),('done_succ','b')
  ) as s(nm, opt) on s.nm = f.name;
  -- due dates
  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org, v_board, f.id, v_date, jsonb_build_object('date', d.dt)
  from fx f join (values
    ('overdue','2026-11-10'),('overdue_and_blocking','2026-11-12'),
    ('soon','2026-11-16'),('today_due','2026-11-14'),
    ('finished','2026-11-01'),('later','2026-12-20'),
    ('in_arch_group','2026-11-01')
  ) as d(nm, dt) on d.nm = f.name;

  -- dependencies (predecessor -> successor)
  insert into public.item_dependencies (org_id, board_id, predecessor_board_id, predecessor_id, successor_id)
  select v_org, v_board, v_board, p.id, s.id
  from (values
    ('overdue_and_blocking','waiter'), ('blocker','waiter'),
    ('blocker2','w2a'), ('blocker2','w2b'), ('blocker2','w2c'),
    ('self_blocker','own_next'), ('pred_of_done','done_succ')
  ) as d(pn, sn)
  join fx p on p.name = d.pn join fx s on s.name = d.sn;

  -- Remove any trigger-made activity/notification noise, then write our own.
  delete from public.item_activities where item_id in (select id from fx);
  delete from public.item_updates where item_id in (select id from fx);
  delete from public.notifications where item_id in (select id from fx);
  insert into public.item_updates (org_id, board_id, item_id, author_id, body, body_text, created_at)
  select v_org, v_board, f.id, v_other, '{"type":"doc","content":[]}'::jsonb, 'ping',
         '2026-11-13 12:00+00'::timestamptz
  from fx f where f.name = 'chatty';
  -- tg_log_update_activity just logged an `update_added` activity at now():
  -- remove it so the comment is the ONLY recent signal on `chatty`.
  delete from public.item_activities where item_id in (select id from fx);
  insert into public.item_activities (org_id, board_id, item_id, action, created_at)
  select v_org, v_board, f.id, 'cell_changed', a.ts::timestamptz
  from fx f join (values
    ('stalled','2026-11-01 12:00+00'),('stalled_old','2026-10-20 12:00+00'),
    ('fresh','2026-11-13 12:00+00'),('chatty','2026-11-01 12:00+00')
  ) as a(nm, ts) on a.nm = f.name;
  insert into public.notifications (org_id, board_id, item_id, recipient_id, kind, created_at, read_at)
  select v_org, v_board, f.id, v_user, nv.kind::public.notification_kind,
         nv.ts::timestamptz, nv.rd::timestamptz
  from fx f join (values
    ('mentioned','mention','2026-11-12 10:00+00', null),
    ('mentioned_old','mention','2026-11-05 10:00+00', null),
    ('read_mention','mention','2026-11-12 10:00+00','2026-11-12 11:00+00'),
    ('mention_done','mention','2026-11-12 10:00+00', null)
  ) as nv(nm, kind, ts, rd) on nv.nm = f.name;
  -- an `assigned` notification must NOT count as an unread reply
  insert into public.notifications (org_id, board_id, item_id, recipient_id, kind)
  select v_org, v_board, f.id, v_user, 'assigned' from fx f where f.name = 'later';
  select count(*) into n from public.notifications where item_id in (select id from fx);
  if n is distinct from 5 then
    raise exception 'S1 fixture notifications were dropped by a trigger (preferences?): % of 5', n; end if;
  select count(*) into n from public.item_activities where item_id in (select id from fx);
  if n is distinct from 4 then
    raise exception 'S2 expected exactly the 4 fixture activities, got %', n; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  -- ===== A. owner role, claims set, folder-scoped (exact set + order) =====
  names := '{}'; tiers := '{}';
  for r in select * from public.get_focus_today(v_org, v_today, v_folder) loop
    names := names || r.item_name; tiers := tiers || r.tier;
  end loop;
  if names is distinct from exp_names then
    raise exception 'A1 order/rowset wrong (owner): got %', names; end if;
  if tiers is distinct from exp_tiers then
    raise exception 'A1 tiers wrong (owner): got %', tiers; end if;

  -- per-row fields
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'overdue';
  if r.tier is distinct from 1 or r.days_overdue is distinct from 4
     or r.tier_total is distinct from 2 or r.waiting_count is distinct from 0
     or r.waiting is distinct from '[]'::jsonb or r.unread_count is distinct from 0
     or r.status_label is distinct from 'Working' or r.due_date is distinct from date '2026-11-10'
     or r.group_name is distinct from 'Sprint 4' or r.board_name is distinct from 'verify focus_today'
     or r.board_id is distinct from v_board then
    raise exception 'A2 overdue row wrong: %', row_to_json(r); end if;
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'overdue_and_blocking';
  if r.tier is distinct from 1 or r.days_overdue is distinct from 2
     or r.waiting_count is distinct from 1 or r.tier_total is distinct from 2
     or jsonb_array_length(r.waiting) is distinct from 1
     or r.waiting -> 0 ->> 'name' is distinct from 'waiter'
     or r.waiting -> 0 -> 'assigneeIds' is distinct from jsonb_build_array(v_other::text) then
    raise exception 'A3 overdue_and_blocking wrong: %', row_to_json(r); end if;
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'blocker2';
  if r.tier is distinct from 2 or r.waiting_count is distinct from 3
     or jsonb_array_length(r.waiting) is distinct from 2 or r.days_overdue is not null
     or r.tier_total is distinct from 2 then
    raise exception 'A4 blocker2 wrong (count 3, array capped at 2): %', row_to_json(r); end if;
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'blocker';
  if r.tier is distinct from 2 or r.waiting_count is distinct from 1 or r.due_date is not null then
    raise exception 'A5 blocker wrong: %', row_to_json(r); end if;
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'soon';
  if r.tier is distinct from 3 or r.days_overdue is not null then
    raise exception 'A6 soon wrong: %', row_to_json(r); end if;
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'today_due';
  if r.tier is distinct from 3 or r.days_overdue is not null then
    raise exception 'A7 today_due wrong (due today is not overdue): %', row_to_json(r); end if;
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'mentioned';
  if r.tier is distinct from 4 or r.unread_count is distinct from 1
     or r.tier_total is distinct from 2 or r.days_quiet is not null then
    raise exception 'A8 mentioned wrong: %', row_to_json(r); end if;
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'stalled';
  if r.tier is distinct from 5 or r.days_quiet is distinct from 13 or r.tier_total is distinct from 2 then
    raise exception 'A9 stalled wrong: %', row_to_json(r); end if;
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'stalled_old';
  if r.tier is distinct from 5 or r.days_quiet is distinct from 25 then
    raise exception 'A10 stalled_old wrong: %', row_to_json(r); end if;

  -- Explicitly absent items (each reason in its own check).
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder)
   where item_name in ('waiter','w2a','w2b','w2c','done_succ');
  if n is distinct from 0 then raise exception 'A11 other-user-only items returned: %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder)
   where item_name in ('self_blocker','own_next');
  if n is distinct from 0 then raise exception 'A12 self-blocker / own successor must not be returned (not tier 2): %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'pred_of_done';
  if n is distinct from 0 then raise exception 'A13 predecessor of a DONE successor must not be tier 2: %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'fresh';
  if n is distinct from 0 then raise exception 'A14 fresh (recent activity) returned: %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'chatty';
  if n is distinct from 0 then raise exception 'A15 comment must count as activity (chatty stalled): %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'finished';
  if n is distinct from 0 then raise exception 'A16 done item returned: %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'later';
  if n is distinct from 0 then raise exception 'A17 later (and kind=assigned notification) returned: %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'in_arch_group';
  if n is distinct from 0 then raise exception 'A18 overdue item in archived group returned: %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'mention_done';
  if n is distinct from 0 then raise exception 'A19 mention on a done item returned: %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'read_mention';
  if n is distinct from 0 then raise exception 'A20 read mention returned: %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder) where item_name = 'off_folder';
  if n is distinct from 0 then raise exception 'A21 off-folder item returned under folder scope: %', n; end if;

  -- Limit applies after ordering; tier_total counts the full set.
  select * into strict r from public.get_focus_today(v_org, v_today, v_folder, 5, 1);
  if r.item_name is distinct from 'overdue' or r.tier_total is distinct from 2 then
    raise exception 'B1 limit 1 wrong: %', row_to_json(r); end if;
  names := '{}';
  for r in select * from public.get_focus_today(v_org, v_today, v_folder, 5, 4) loop names := names || r.item_name; end loop;
  if names is distinct from array['overdue','overdue_and_blocking','blocker2','blocker'] then
    raise exception 'B2 limit 4 wrong: %', names; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder, 5, 0);
  if n is distinct from 1 then raise exception 'B3 limit 0 must clamp to 1: %', n; end if;

  -- The caller's date decides, not the server clock.
  select * into strict r from public.get_focus_today(v_org, date '2026-11-10', v_folder) where item_name = 'overdue';
  if r.tier is distinct from 3 or r.days_overdue is not null then
    raise exception 'C1 overdue with today=11-10 must be tier 3: %', row_to_json(r); end if;

  -- Stall window: a huge p_stall_days un-stalls both stalled items.
  -- cutoff 2026-10-05: stalled_old (10-20) is no longer stale -> zero tier-5 rows.
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder, 40, 50) where tier = 5;
  if n is distinct from 0 then raise exception 'C2a p_stall_days=40 should yield no tier-5 rows: %', n; end if;
  -- cutoff 2026-10-25: only stalled_old (10-20) is stale; stalled (11-01) is not.
  names := '{}';
  for r in select * from public.get_focus_today(v_org, v_today, v_folder, 20, 50) where tier = 5 loop
    names := names || r.item_name; end loop;
  if names is distinct from array['stalled_old'] then
    raise exception 'C2b p_stall_days=20 should leave only stalled_old: %', names; end if;

  -- Wrong org / random folder: zero rows.
  select count(*) into n from public.get_focus_today(v_other_org, v_today, v_folder);
  if n is distinct from 0 then raise exception 'D1 other org returned rows: %', n; end if;
  select count(*) into n from public.get_focus_today(v_org, v_today, gen_random_uuid());
  if n is distinct from 0 then raise exception 'D2 random folder returned rows: %', n; end if;

  -- ===== E. unscoped (owner): fixture boards' rows, exact order =====
  select count(*) into n from public.get_focus_today(v_org, v_today, null, 5, 50);
  if n >= 50 then
    raise exception 'E0 fixture user has >= 50 ranked real items; a limit-50 page could truncate fixtures'; end if;
  names := '{}';
  for r in select * from public.get_focus_today(v_org, v_today, null, 5, 50)
            where board_id in (v_board, v_board2) loop
    names := names || r.item_name;
  end loop;
  if names is distinct from array['overdue','off_folder','overdue_and_blocking','blocker2','blocker',
      'today_due','soon','mentioned','mentioned_old','stalled_old','stalled'] then
    raise exception 'E1 unscoped order/rowset wrong (owner): %', names; end if;

  -- ===== F. same calls under `authenticated` (RLS really applies) =====
  set local role authenticated;
  names := '{}'; tiers := '{}';
  for r in select * from public.get_focus_today(v_org, v_today, v_folder) loop
    names := names || r.item_name; tiers := tiers || r.tier;
  end loop;
  reset role;
  if names is distinct from exp_names or tiers is distinct from exp_tiers then
    raise exception 'F1 authenticated folder-scoped result wrong: % / %', names, tiers; end if;

  set local role authenticated;
  names := '{}';
  for r in select * from public.get_focus_today(v_org, v_today, null, 5, 50)
            where board_id in (v_board, v_board2) loop
    names := names || r.item_name;
  end loop;
  reset role;
  if names is distinct from array['overdue','off_folder','overdue_and_blocking','blocker2','blocker',
      'today_due','soon','mentioned','mentioned_old','stalled_old','stalled'] then
    raise exception 'F2 authenticated unscoped wrong: %', names; end if;

  -- Negative: a member of ANOTHER org. Meaningful only because F1 (same role,
  -- v_user) returned 10 rows.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder);
  reset role;
  if n is distinct from 0 then raise exception 'G1 outsider (authenticated) sees % fixture rows', n; end if;
  set local role authenticated;
  select count(*) into n from public.get_focus_today(v_org, v_today, null, 5, 50);
  reset role;
  if n is distinct from 0 then raise exception 'G2 outsider unscoped on foreign org sees % rows', n; end if;

  -- Anonymous (no uid): zero rows, never an error.
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.get_focus_today(v_org, v_today, v_folder);
  if n is distinct from 0 then raise exception 'G3 no-identity call returned % rows', n; end if;

  raise notice 'verify-focus-today: all checks passed';
end
$verify$;

rollback;

-- Leak checks + visible pass marker (the MCP does not surface RAISE NOTICE; any
-- failure above raises). After rollback: no fixture board, role/claims reset.
select case
  when exists (select 1 from public.boards where name like 'verify focus_today%')
    then 1/0
  when exists (select 1 from public.folders where name = 'verify focus_today folder')
    then 1/0
  when current_user <> session_user and current_user <> 'postgres' then 1/0
  when coalesce(nullif(current_setting('request.jwt.claims', true), ''), 'unset') <> 'unset' then 1/0
  else 'verify-focus-today: all checks passed; no leaked fixtures; role ' || current_user || '; claims unset'
end as result;
