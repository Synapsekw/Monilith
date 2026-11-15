-- verify-query-items.sql: run via supabase-dev execute_sql as ONE batch.
-- Everything lives inside begin; ... rollback; nothing is committed. A throwaway
-- ORG is created inside the transaction so org-wide calls see ONLY fixtures and
-- exact result sets / totals can be asserted. Real users are borrowed as
-- members (they are never modified).
-- Every read is `into strict` or aggregated, every check is `is distinct from`,
-- so a missing row or a NULL result raises instead of passing silently.
-- Each assertion block runs twice: pass 1 as the table owner with the JWT claims
-- set (get_my_open_work reads auth.uid()), pass 2 under `set local role
-- authenticated` so RLS applies to the fixture user.
-- Afterwards run scripts/sql/verify-query-items-leak.sql (separate call): it
-- proves nothing leaked out of the rolled-back transaction.
-- Section 14 (org 3) pins query_items / count_items assignee handling to
-- public.item_assignee_ids, including malformed and null people cells.
begin;

do $verify$
declare
  v_user uuid;
  v_other uuid;
  v_outsider uuid;
  v_org uuid := gen_random_uuid();
  v_org2 uuid := gen_random_uuid();
  v_org3 uuid := gen_random_uuid();
  v_ws3 uuid := gen_random_uuid();
  v_bc uuid := gen_random_uuid();
  v_gc uuid := gen_random_uuid();
  v_pc1 uuid := gen_random_uuid();
  v_pc2 uuid := gen_random_uuid();
  v_e1 uuid := gen_random_uuid();
  v_e2 uuid := gen_random_uuid();
  v_e3 uuid := gen_random_uuid();
  v_e4 uuid := gen_random_uuid();
  v_e5 uuid := gen_random_uuid();
  v_e6 uuid := gen_random_uuid();
  v_e7 uuid := gen_random_uuid();
  v_ws uuid := gen_random_uuid();
  v_ws2 uuid := gen_random_uuid();
  v_folder uuid := gen_random_uuid();
  v_ba uuid := gen_random_uuid();   -- board A (in folder)
  v_bb uuid := gen_random_uuid();   -- board B
  v_b2 uuid := gen_random_uuid();   -- board in org 2
  v_ga uuid := gen_random_uuid();
  v_ga_arch uuid := gen_random_uuid();
  v_gb uuid := gen_random_uuid();
  v_g2 uuid := gen_random_uuid();
  v_sa uuid := gen_random_uuid(); v_da uuid := gen_random_uuid(); v_pa uuid := gen_random_uuid();
  v_sb uuid := gen_random_uuid(); v_db uuid := gen_random_uuid(); v_pb uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid();
  -- items
  v_nodate uuid := gen_random_uuid();   -- B, nobody, open, no due, comment +3h
  v_later uuid := gen_random_uuid();    -- A, v_other, open, due 2026-12-01, comment +2h
  v_soon uuid := gen_random_uuid();     -- B, v_user + v_other, open, due 2026-11-16
  v_overdue uuid := gen_random_uuid();  -- A, v_user, open, due 2026-11-10, comment +1h
  v_donea uuid := gen_random_uuid();    -- A, v_user, done, no due
  v_doneb uuid := gen_random_uuid();    -- B, v_other, done, no due
  v_in_arch_group uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid();
  v_org2_item uuid := gen_random_uuid();
  nm text[];
  nm2 text[];
  want text[];
  want_done text[];
  want_any_updated text[];
  tmin int;
  tmax int;
  n int;
  r record;
  v_pass int;
  v_base timestamptz := now();
begin
  -- Borrow three distinct real users from the largest org.
  select array_agg(x.user_id) into strict nm
    from (select m.user_id from public.org_members m
           where m.org_id = (select org_id from public.org_members
                              group by org_id order by count(*) desc limit 1)
           order by m.user_id limit 3) x;
  if array_length(nm, 1) is distinct from 3 then
    raise exception 'need 3 borrowable users, got %', nm; end if;
  v_user := nm[1]::uuid; v_other := nm[2]::uuid; v_outsider := nm[3]::uuid;

  insert into public.organizations (id, name, slug, created_by) values
    (v_org, 'verify query_items org', 'verify-query-items-' || v_org, v_user),
    (v_org2, 'verify query_items org2', 'verify-query-items-' || v_org2, v_outsider);
  insert into public.org_members (org_id, user_id) values
    (v_org, v_user), (v_org, v_other), (v_org2, v_outsider);
  insert into public.workspaces (id, org_id, name, created_by) values
    (v_ws, v_org, 'verify query_items ws', v_user),
    (v_ws2, v_org2, 'verify query_items ws2', v_outsider);
  insert into public.folders (id, org_id, workspace_id, name) values
    (v_folder, v_org, v_ws, 'verify query_items folder');
  insert into public.boards (id, org_id, workspace_id, name, created_by, position) values
    (v_ba, v_org, v_ws, 'verify query_items A', v_user, 0),
    (v_bb, v_org, v_ws, 'verify query_items B', v_user, 1),
    (v_b2, v_org2, v_ws2, 'verify query_items other org', v_outsider, 0);
  insert into public.folder_boards (folder_id, board_id) values (v_folder, v_ba);
  -- v_other did not create the boards: RLS only lets them read via membership.
  insert into public.board_members (org_id, board_id, user_id, granted_by) values
    (v_org, v_ba, v_other, v_user), (v_org, v_bb, v_other, v_user);
  insert into public.groups (id, org_id, board_id, name, position) values
    (v_ga, v_org, v_ba, 'GA', 0), (v_gb, v_org, v_bb, 'GB', 0), (v_g2, v_org2, v_b2, 'G2', 0);
  insert into public.groups (id, org_id, board_id, name, position, archived_at) values
    (v_ga_arch, v_org, v_ba, 'GA archived', 1, now());
  insert into public.columns (id, org_id, board_id, name, kind, position, settings) values
    (v_sa, v_org, v_ba, 'Status', 'status', 1,
      '{"options":[{"id":"a","label":"Working","color":"#111111"},{"id":"b","label":"Done","color":"#222222"},{"id":"c","label":"Stuck","color":"#333333"}]}'),
    (v_da, v_org, v_ba, 'Due', 'date', 2, '{}'),
    (v_pa, v_org, v_ba, 'Owner', 'people', 3, '{}'),
    (v_sb, v_org, v_bb, 'Status', 'status', 1,
      '{"options":[{"id":"a","label":"Working","color":"#111111"},{"id":"b","label":"Done","color":"#222222"},{"id":"c","label":"Stuck","color":"#333333"}]}'),
    (v_db, v_org, v_bb, 'Due', 'date', 2, '{}'),
    (v_pb, v_org, v_bb, 'Owner', 'people', 3, '{}'),
    (v_p2, v_org2, v_b2, 'Owner', 'people', 1, '{}');

  -- Insertion order is the REVERSE of the expected due order, so a missing
  -- ORDER BY would surface the heap order and fail the ordered assertions.
  insert into public.items (id, org_id, board_id, group_id, name, position, created_by) values
    (v_nodate, v_org, v_bb, v_gb, 'qi nodate', 1, v_user),
    (v_later, v_org, v_ba, v_ga, 'qi later', 2, v_user),
    (v_soon, v_org, v_bb, v_gb, 'qi soon', 3, v_user),
    (v_overdue, v_org, v_ba, v_ga, 'qi overdue', 4, v_user),
    (v_donea, v_org, v_ba, v_ga, 'qi done a', 5, v_user),
    (v_doneb, v_org, v_bb, v_gb, 'qi done b', 6, v_user),
    (v_in_arch_group, v_org, v_ba, v_ga_arch, 'qi in archived group', 7, v_user),
    (v_org2_item, v_org2, v_b2, v_g2, 'qi org2 item', 1, v_outsider);
  insert into public.items (id, org_id, board_id, group_id, name, position, created_by, archived_at) values
    (v_archived, v_org, v_ba, v_ga, 'qi archived item', 8, v_user, now());

  insert into public.cell_values (org_id, board_id, item_id, column_id, value) values
    -- statuses (nodate has none)
    (v_org, v_ba, v_later, v_sa, '{"optionId":"a"}'),
    (v_org, v_bb, v_soon, v_sb, '{"optionId":"c"}'),
    (v_org, v_ba, v_overdue, v_sa, '{"optionId":"a"}'),
    (v_org, v_ba, v_donea, v_sa, '{"optionId":"b"}'),
    (v_org, v_bb, v_doneb, v_sb, '{"optionId":"b"}'),
    (v_org, v_ba, v_in_arch_group, v_sa, '{"optionId":"a"}'),
    (v_org, v_ba, v_archived, v_sa, '{"optionId":"a"}'),
    -- due dates
    (v_org, v_ba, v_later, v_da, '{"date":"2026-12-01"}'),
    (v_org, v_bb, v_soon, v_db, '{"date":"2026-11-16"}'),
    (v_org, v_ba, v_overdue, v_da, '{"date":"2026-11-10"}'),
    (v_org, v_ba, v_in_arch_group, v_da, '{"date":"2026-11-01"}'),
    (v_org, v_ba, v_archived, v_da, '{"date":"2026-11-02"}'),
    -- people (nodate has NO people cell at all)
    (v_org, v_ba, v_later, v_pa, jsonb_build_object('userIds', jsonb_build_array(v_other::text))),
    (v_org, v_bb, v_soon, v_pb, jsonb_build_object('userIds', jsonb_build_array(v_user::text, v_other::text))),
    (v_org, v_ba, v_overdue, v_pa, jsonb_build_object('userIds', jsonb_build_array(v_user::text))),
    (v_org, v_ba, v_donea, v_pa, jsonb_build_object('userIds', jsonb_build_array(v_user::text))),
    (v_org, v_bb, v_doneb, v_pb, jsonb_build_object('userIds', jsonb_build_array(v_other::text))),
    (v_org, v_ba, v_in_arch_group, v_pa, jsonb_build_object('userIds', jsonb_build_array(v_user::text))),
    (v_org, v_ba, v_archived, v_pa, jsonb_build_object('userIds', jsonb_build_array(v_user::text))),
    (v_org2, v_b2, v_org2_item, v_p2,
      jsonb_build_object('userIds', jsonb_build_array(v_user::text, v_outsider::text)));

  -- Every fixture timestamp so far is the transaction start. Comments dated in
  -- the future make last_change distinct and exactly known.
  -- Org 3: assignee-shape fixtures kept apart so the org 1 counts stay exact.
  insert into public.organizations (id, name, slug, created_by) values
    (v_org3, 'verify query_items org3', 'verify-query-items-' || v_org3, v_user);
  insert into public.org_members (org_id, user_id) values (v_org3, v_user);
  insert into public.workspaces (id, org_id, name, created_by) values
    (v_ws3, v_org3, 'verify query_items ws3', v_user);
  insert into public.boards (id, org_id, workspace_id, name, created_by, position) values
    (v_bc, v_org3, v_ws3, 'verify query_items C', v_user, 0);
  insert into public.groups (id, org_id, board_id, name, position) values
    (v_gc, v_org3, v_bc, 'GC', 0);
  insert into public.columns (id, org_id, board_id, name, kind, position, settings) values
    (v_pc1, v_org3, v_bc, 'Owner', 'people', 1, '{}'),
    (v_pc2, v_org3, v_bc, 'Reviewer', 'people', 2, '{}');
  insert into public.items (id, org_id, board_id, group_id, name, position, created_by) values
    (v_e1, v_org3, v_bc, v_gc, 'eq two columns', 1, v_user),
    (v_e2, v_org3, v_bc, v_gc, 'eq empty array', 2, v_user),
    (v_e3, v_org3, v_bc, v_gc, 'eq no cell', 3, v_user),
    (v_e4, v_org3, v_bc, v_gc, 'eq json null only', 4, v_user),
    (v_e5, v_org3, v_bc, v_gc, 'eq null and person', 5, v_user),
    (v_e6, v_org3, v_bc, v_gc, 'eq not an array', 6, v_user),
    (v_e7, v_org3, v_bc, v_gc, 'eq duplicate person', 7, v_user);
  insert into public.cell_values (org_id, board_id, item_id, column_id, value) values
    (v_org3, v_bc, v_e1, v_pc1, jsonb_build_object('userIds', jsonb_build_array(v_user::text))),
    (v_org3, v_bc, v_e1, v_pc2, jsonb_build_object('userIds', jsonb_build_array(v_other::text, v_user::text))),
    (v_org3, v_bc, v_e2, v_pc1, '{"userIds":[]}'),
    (v_org3, v_bc, v_e4, v_pc1, '{"userIds":[null]}'),
    (v_org3, v_bc, v_e5, v_pc1, jsonb_build_object('userIds', jsonb_build_array(null, v_other::text))),
    (v_org3, v_bc, v_e6, v_pc1, '{"userIds":"abc"}'),
    (v_org3, v_bc, v_e7, v_pc1, jsonb_build_object('userIds', jsonb_build_array(v_user::text, v_user::text)));

  insert into public.item_updates (org_id, board_id, item_id, author_id, body, body_text, created_at) values
    (v_org, v_bb, v_nodate, v_user, '{}', 'c3', v_base + interval '3 hours'),
    (v_org, v_ba, v_later, v_user, '{}', 'c2', v_base + interval '2 hours'),
    (v_org, v_ba, v_overdue, v_user, '{}', 'c1', v_base + interval '1 hour');

  -- Expected tie orders, computed from the ids (as owner, before any role switch).
  select array_agg(i.name order by i.id) into strict want_done
    from public.items i where i.id in (v_donea, v_doneb);
  select array['qi nodate', 'qi later', 'qi overdue']::text[]
         || array_agg(i.name order by i.id) into strict want_any_updated
    from public.items i where i.id in (v_soon, v_donea, v_doneb);

  for v_pass in 1..2 loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    if v_pass = 2 then set local role authenticated; end if;

    -- 1. default call: four open items, due order nulls last, total 4 on every row
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total), count(*)
      into nm, tmin, tmax, n from public.query_items(v_org) with ordinality t;
    if nm is distinct from array['qi overdue','qi soon','qi later','qi nodate']
       or tmin is distinct from 4 or tmax is distinct from 4 or n is distinct from 4 then
      raise exception '[pass %] 1. default: %, total %..%', v_pass, nm, tmin, tmax; end if;

    -- 1b. row shape for one item
    select * into strict r from public.query_items(v_org) q where q.item_id = v_soon;
    if r.item_name is distinct from 'qi soon' or r.board_id is distinct from v_bb
       or r.board_name is distinct from 'verify query_items B'
       or r.group_name is distinct from 'GB' or r.status_label is distinct from 'Stuck'
       or r.is_done is distinct from false or r.due_date is distinct from date '2026-11-16'
       or r.assignee_ids is distinct from jsonb_build_array(v_user::text, v_other::text)
       or r.last_change is distinct from v_base then
      raise exception '[pass %] 1b. row shape: %', v_pass, row_to_json(r); end if;
    select * into strict r from public.query_items(v_org) q where q.item_id = v_nodate;
    if r.assignee_ids is distinct from '[]'::jsonb or r.status_label is not null
       or r.due_date is not null or r.last_change is distinct from v_base + interval '3 hours' then
      raise exception '[pass %] 1c. nodate row shape: %', v_pass, row_to_json(r); end if;

    -- archived item / archived group item never appear in any state
    select count(*) into n from public.query_items(v_org, p_state => 'any') q
     where q.item_id in (v_archived, v_in_arch_group);
    if n is distinct from 0 then
      raise exception '[pass %] archived/archived-group item leaked (any): %', v_pass, n; end if;
    select count(*) into n from public.query_items(v_org, p_assignee => v_user, p_state => 'any') q
     where q.item_id in (v_archived, v_in_arch_group);
    if n is distinct from 0 then
      raise exception '[pass %] archived item leaked via assignee: %', v_pass, n; end if;

    -- 2. done: exactly the two done items, tie order by item_id, stable across calls
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total), count(*)
      into nm, tmin, tmax, n from public.query_items(v_org, p_state => 'done') with ordinality t;
    if nm is distinct from want_done or tmin is distinct from 2 or tmax is distinct from 2 then
      raise exception '[pass %] 2. done: % want %', v_pass, nm, want_done; end if;
    select array_agg(t.item_name order by t.ordinality) into nm2
      from public.query_items(v_org, p_state => 'done') with ordinality t;
    if nm2 is distinct from nm then raise exception '[pass %] 2b. unstable tie order', v_pass; end if;

    -- state any: all six live items
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax from public.query_items(v_org, p_state => 'any') with ordinality t;
    if array_length(nm, 1) is distinct from 6 or tmin is distinct from 6 or tmax is distinct from 6 then
      raise exception '[pass %] any: % total %..%', v_pass, nm, tmin, tmax; end if;

    -- 3. assignee
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax from public.query_items(v_org, p_assignee => v_other) with ordinality t;
    if nm is distinct from array['qi soon','qi later'] or tmin is distinct from 2 or tmax is distinct from 2 then
      raise exception '[pass %] 3. assignee other: %', v_pass, nm; end if;
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax from public.query_items(v_org, p_assignee => v_user) with ordinality t;
    if nm is distinct from array['qi overdue','qi soon'] or tmin is distinct from 2 or tmax is distinct from 2 then
      raise exception '[pass %] 3b. assignee user: %', v_pass, nm; end if;

    -- 4. unassigned: only the item with no people cell
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax from public.query_items(v_org, p_unassigned => true) with ordinality t;
    if nm is distinct from array['qi nodate'] or tmin is distinct from 1 or tmax is distinct from 1 then
      raise exception '[pass %] 4. unassigned: %', v_pass, nm; end if;

    -- 5. overdue window ending 2026-11-13: only the overdue item
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax from public.query_items(v_org, p_due_to => date '2026-11-13') with ordinality t;
    if nm is distinct from array['qi overdue'] or tmin is distinct from 1 or tmax is distinct from 1 then
      raise exception '[pass %] 5. due_to: %', v_pass, nm; end if;
    -- 5b. both bounds inclusive, undated excluded
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.query_items(v_org, p_due_from => date '2026-11-16', p_due_to => date '2026-11-16') with ordinality t;
    if nm is distinct from array['qi soon'] then
      raise exception '[pass %] 5b. due window: %', v_pass, nm; end if;
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.query_items(v_org, p_due_from => date '2026-11-11') with ordinality t;
    if nm is distinct from array['qi soon','qi later'] then
      raise exception '[pass %] 5c. due_from: %', v_pass, nm; end if;

    -- 6. folder: only board A
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax from public.query_items(v_org, p_folder_id => v_folder) with ordinality t;
    if nm is distinct from array['qi overdue','qi later'] or tmin is distinct from 2 or tmax is distinct from 2 then
      raise exception '[pass %] 6. folder: %', v_pass, nm; end if;
    -- board B alone
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.query_items(v_org, p_board_id => v_bb) with ordinality t;
    if nm is distinct from array['qi soon','qi nodate'] then
      raise exception '[pass %] 6b. board B: %', v_pass, nm; end if;
    -- group
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.query_items(v_org, p_group_id => v_ga) with ordinality t;
    if nm is distinct from array['qi overdue','qi later'] then
      raise exception '[pass %] 6c. group: %', v_pass, nm; end if;
    -- archived group: nothing, even when asked for explicitly
    select count(*) into n from public.query_items(v_org, p_group_id => v_ga_arch, p_state => 'any');
    if n is distinct from 0 then raise exception '[pass %] 6d. archived group: %', v_pass, n; end if;

    -- 7/8. paging
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax from public.query_items(v_org, p_limit => 1) with ordinality t;
    if nm is distinct from array['qi overdue'] or tmin is distinct from 4 or tmax is distinct from 4 then
      raise exception '[pass %] 7. limit 1: % total %', v_pass, nm, tmin; end if;
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax from public.query_items(v_org, p_limit => 1, p_offset => 1) with ordinality t;
    if nm is distinct from array['qi soon'] or tmin is distinct from 4 or tmax is distinct from 4 then
      raise exception '[pass %] 8. limit 1 offset 1: % total %', v_pass, nm, tmin; end if;
    select array_agg(t.item_name order by t.ordinality), min(t.total)
      into nm, tmin from public.query_items(v_org, p_limit => 2, p_offset => 2) with ordinality t;
    if nm is distinct from array['qi later','qi nodate'] or tmin is distinct from 4 then
      raise exception '[pass %] 8b. limit 2 offset 2: %', v_pass, nm; end if;
    -- offset beyond the set: zero rows
    select count(*) into n from public.query_items(v_org, p_offset => 10);
    if n is distinct from 0 then raise exception '[pass %] 8c. offset past end: %', v_pass, n; end if;
    -- limit is clamped to 50 and floored at 1
    select count(*) into n from public.query_items(v_org, p_limit => 0);
    if n is distinct from 1 then raise exception '[pass %] 8d. limit 0 clamps to 1: %', v_pass, n; end if;

    -- 9. sort by updated: the freshest comment first; ties by item_id
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.query_items(v_org, p_sort => 'updated') with ordinality t;
    if nm is distinct from array['qi nodate','qi later','qi overdue','qi soon'] then
      raise exception '[pass %] 9. sort updated: %', v_pass, nm; end if;
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.query_items(v_org, p_sort => 'updated', p_state => 'any') with ordinality t;
    if nm is distinct from want_any_updated then
      raise exception '[pass %] 9b. sort updated any: % want %', v_pass, nm, want_any_updated; end if;
    select array_agg(t.item_name order by t.ordinality) into nm2
      from public.query_items(v_org, p_sort => 'updated', p_state => 'any') with ordinality t;
    if nm2 is distinct from nm then raise exception '[pass %] 9c. unstable updated order', v_pass; end if;

    -- 10. updated_since
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax
      from public.query_items(v_org, p_updated_since => v_base - interval '1 hour') with ordinality t;
    if nm is distinct from array['qi overdue','qi soon','qi later','qi nodate'] or tmin is distinct from 4 then
      raise exception '[pass %] 10. updated_since -1h: %', v_pass, nm; end if;
    select array_agg(t.item_name order by t.ordinality), min(t.total), max(t.total)
      into nm, tmin, tmax
      from public.query_items(v_org, p_updated_since => v_base + interval '90 minutes') with ordinality t;
    if nm is distinct from array['qi later','qi nodate'] or tmin is distinct from 2 or tmax is distinct from 2 then
      raise exception '[pass %] 10b. updated_since +90m: % total %', v_pass, nm, tmin; end if;
    -- the cut-off is inclusive
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.query_items(v_org, p_updated_since => v_base + interval '3 hours') with ordinality t;
    if nm is distinct from array['qi nodate'] then
      raise exception '[pass %] 10c. updated_since +3h: %', v_pass, nm; end if;

    -- 11. count_items
    select count(*), sum(c.item_count) into n, tmax from public.count_items(v_org, 'board') c;
    if n is distinct from 2 or tmax is distinct from 4 then
      raise exception '[pass %] 11. count board: % rows sum %', v_pass, n, tmax; end if;
    select array_agg(c.label || '=' || c.item_count order by c.label) into nm
      from public.count_items(v_org, 'board') c;
    if nm is distinct from array['verify query_items A=2','verify query_items B=2'] then
      raise exception '[pass %] 11b. board counts: %', v_pass, nm; end if;
    select array_agg(c.key || '|' || c.label || '=' || c.item_count order by c.key) into nm
      from public.count_items(v_org, 'status') c;
    if nm is distinct from array['|No status=1','Stuck|Stuck=1','Working|Working=2'] then
      raise exception '[pass %] 11c. status counts: %', v_pass, nm; end if;
    select sum(c.item_count) into tmax from public.count_items(v_org, 'status') c;
    select min(q.total) into tmin from public.query_items(v_org) q;
    if tmax is distinct from tmin then
      raise exception '[pass %] 11d. status sum % <> query total %', v_pass, tmax, tmin; end if;
    select sum(c.item_count) into tmax from public.count_items(v_org, 'board') c;
    if tmax is distinct from tmin then
      raise exception '[pass %] 11e. board sum % <> query total %', v_pass, tmax, tmin; end if;
    -- same equality under a filter and under state any
    select sum(c.item_count) into tmax from public.count_items(v_org, 'status', p_state => 'any') c;
    select min(q.total) into tmin from public.query_items(v_org, p_state => 'any') q;
    if tmax is distinct from tmin or tmin is distinct from 6 then
      raise exception '[pass %] 11f. any sums % vs %', v_pass, tmax, tmin; end if;
    select sum(c.item_count) into tmax from public.count_items(v_org, 'board', p_folder_id => v_folder) c;
    if tmax is distinct from 2 then raise exception '[pass %] 11g. folder board count %', v_pass, tmax; end if;
    -- assignee counts: soon has two people, so the sum exceeds the item total
    select array_agg(c.key || '=' || c.item_count order by c.key) into nm
      from public.count_items(v_org, 'assignee') c;
    if nm is distinct from array['=1', v_other::text || '=2', v_user::text || '=2']::text[]
       and nm is distinct from (select array_agg(k order by split_part(k, '=', 1)) from unnest(
         array['=1', v_other::text || '=2', v_user::text || '=2']::text[]) k) then
      raise exception '[pass %] 11h. assignee counts: %', v_pass, nm; end if;
    select count(*) into n from public.count_items(v_org, 'assignee') c where c.key = '' and c.item_count = 1;
    if n is distinct from 1 then
      raise exception '[pass %] 11i. no unassigned bucket with key ''''', v_pass; end if;
    select count(*) into n from public.count_items(v_org, 'nonsense');
    if n is distinct from 0 then raise exception '[pass %] 11j. unknown count_by: %', v_pass, n; end if;

    -- 12. get_my_open_work as v_user, then as v_other
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.get_my_open_work(v_org) with ordinality t;
    if nm is distinct from array['qi overdue','qi soon'] then
      raise exception '[pass %] 12. my work (user): %', v_pass, nm; end if;
    select * into strict r from public.get_my_open_work(v_org) w where w.item_id = v_overdue;
    if r.board_name is distinct from 'verify query_items A' or r.group_name is distinct from 'GA'
       or r.due_date is distinct from '2026-11-10' or r.status_label is distinct from 'Working'
       or r.status_color is distinct from '#111111' then
      raise exception '[pass %] 12b. my work row: %', v_pass, row_to_json(r); end if;
    select count(*) into n from public.get_my_open_work(v_org, 1);
    if n is distinct from 1 then raise exception '[pass %] 12c. my work limit 1: %', v_pass, n; end if;
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.get_my_open_work(v_org, 1) with ordinality t;
    if nm is distinct from array['qi overdue'] then
      raise exception '[pass %] 12d. limit applies AFTER ordering: %', v_pass, nm; end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    select array_agg(t.item_name order by t.ordinality) into nm
      from public.get_my_open_work(v_org) with ordinality t;
    if nm is distinct from array['qi soon','qi later'] then
      raise exception '[pass %] 12e. my work (other): %', v_pass, nm; end if;

    -- 13. another org: zero rows from every function.
    -- 13a (both passes): an org id that does not exist, as the fixture user.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    select count(*) into n from public.query_items(gen_random_uuid(), p_state => 'any');
    if n is distinct from 0 then raise exception '[pass %] 13a. query_items unknown org: %', v_pass, n; end if;
    select count(*) into n from public.count_items(gen_random_uuid(), 'board', p_state => 'any');
    if n is distinct from 0 then raise exception '[pass %] 13b. count_items unknown org: %', v_pass, n; end if;
    select count(*) into n from public.query_items_base(gen_random_uuid(), p_state => 'any');
    if n is distinct from 0 then raise exception '[pass %] 13c. base unknown org: %', v_pass, n; end if;
    select count(*) into n from public.get_my_open_work(gen_random_uuid());
    if n is distinct from 0 then raise exception '[pass %] 13d. my work unknown org: %', v_pass, n; end if;
    -- a board of ANOTHER org with this org's id: nothing (org filter, not RLS, holds it)
    select count(*) into n from public.query_items(v_org, p_board_id => v_b2, p_state => 'any');
    if n is distinct from 0 then raise exception '[pass %] 13e. cross-org board leaked: %', v_pass, n; end if;
    select count(*) into n from public.count_items(v_org, 'board', p_board_id => v_b2, p_state => 'any');
    if n is distinct from 0 then raise exception '[pass %] 13f. cross-org board counted: %', v_pass, n; end if;

    -- 14. assignee handling must equal public.item_assignee_ids, shape by shape.
    select count(*), count(*) filter (
             where q.assignee_ids is distinct from public.item_assignee_ids(q.item_id))
      into n, tmax from public.query_items(v_org3, p_state => 'any') q;
    if n is distinct from 7 or tmax is distinct from 0 then
      raise exception '[pass %] 14. assignee_ids differ from item_assignee_ids: % rows, % differ',
        v_pass, n, tmax; end if;
    -- and the shapes are what we think they are (guards against both sides being wrong)
    select * into strict r from public.query_items(v_org3, p_state => 'any') q
     where q.item_id = v_e1;
    if r.assignee_ids is distinct from (select jsonb_agg(x order by x) from unnest(array[v_user::text, v_other::text]) x) then
      raise exception '[pass %] 14b. two people columns: %', v_pass, r.assignee_ids; end if;
    select * into strict r from public.query_items(v_org3, p_state => 'any') q
     where q.item_id = v_e5;
    if r.assignee_ids is distinct from jsonb_build_array(v_other::text) then
      raise exception '[pass %] 14c. null element excluded: %', v_pass, r.assignee_ids; end if;
    select * into strict r from public.query_items(v_org3, p_state => 'any') q
     where q.item_id = v_e7;
    if r.assignee_ids is distinct from jsonb_build_array(v_user::text) then
      raise exception '[pass %] 14d. duplicate collapsed: %', v_pass, r.assignee_ids; end if;
    select count(*) into n from public.query_items(v_org3, p_state => 'any') q
     where q.item_id in (v_e2, v_e3, v_e4, v_e6) and q.assignee_ids is distinct from '[]'::jsonb;
    if n is distinct from 0 then raise exception '[pass %] 14e. empty shapes not []: %', v_pass, n; end if;

    -- unassigned: [] / no cell / only JSON null / not an array are all unassigned
    select array_agg(t.item_name order by t.item_name), min(t.total), max(t.total)
      into nm, tmin, tmax from public.query_items(v_org3, p_unassigned => true, p_state => 'any') t;
    if nm is distinct from array['eq empty array','eq json null only','eq no cell','eq not an array']
       or tmin is distinct from 4 or tmax is distinct from 4 then
      raise exception '[pass %] 14f. unassigned set: % total %', v_pass, nm, tmin; end if;
    -- the same set the old per-row definition gives
    select array_agg(i.name order by i.name) into nm2 from public.items i
     where i.org_id = v_org3 and public.item_assignee_ids(i.id) = '[]'::jsonb;
    if nm2 is distinct from nm then
      raise exception '[pass %] 14g. unassigned differs from item_assignee_ids = []: % vs %', v_pass, nm, nm2; end if;
    -- an item with a person next to a JSON null is NOT unassigned
    select count(*) into n from public.query_items(v_org3, p_unassigned => true, p_state => 'any') t
     where t.item_id = v_e5;
    if n is distinct from 0 then raise exception '[pass %] 14h. null+person counted unassigned', v_pass; end if;

    -- assignee counts: '' once per unassigned item, a person once per item they
    -- appear on, ties broken by key.
    select array_agg(k.key || '=' || k.n order by k.n desc, k.key) into nm2
      from (values ('', 4), (v_user::text, 2), (v_other::text, 2)) k(key, n);
    select array_agg(t.key || '=' || t.item_count order by t.ordinality) into nm
      from public.count_items(v_org3, 'assignee', p_state => 'any') with ordinality t;
    if nm is distinct from nm2 then
      raise exception '[pass %] 14i. assignee counts (in returned order): % want %', v_pass, nm, nm2; end if;
    select count(*) into n from public.query_items(v_org3, p_assignee => v_other, p_state => 'any');
    if n is distinct from 2 then raise exception '[pass %] 14k. assignee filter: %', v_pass, n; end if;

    if v_pass = 2 then
      -- 13g (RLS only): org 2 holds an item assigned to v_user, but v_user is not
      -- a member of org 2, so every function must return nothing for them...
      select count(*) into n from public.query_items(v_org2, p_state => 'any');
      if n is distinct from 0 then raise exception 'RLS: query_items sees other org: %', n; end if;
      select count(*) into n from public.count_items(v_org2, 'board', p_state => 'any');
      if n is distinct from 0 then raise exception 'RLS: count_items sees other org: %', n; end if;
      select count(*) into n from public.query_items_base(v_org2, p_state => 'any');
      if n is distinct from 0 then raise exception 'RLS: base sees other org: %', n; end if;
      select count(*) into n from public.get_my_open_work(v_org2);
      if n is distinct from 0 then raise exception 'RLS: my work sees other org: %', n; end if;
      -- ...and the outsider (member of org 2 only) sees org 2 but NOT the fixture
      -- org. The positive reads prove the zeros above are RLS, not an empty org.
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
      select array_agg(t.item_name order by t.ordinality) into nm
        from public.query_items(v_org2, p_state => 'any') with ordinality t;
      if nm is distinct from array['qi org2 item'] then
        raise exception 'RLS control: outsider cannot read own org: %', nm; end if;
      select count(*) into n from public.count_items(v_org2, 'board', p_state => 'any');
      if n is distinct from 1 then raise exception 'RLS control: count_items own org: %', n; end if;
      select array_agg(t.item_name order by t.ordinality) into nm
        from public.get_my_open_work(v_org2) with ordinality t;
      if nm is distinct from array['qi org2 item'] then
        raise exception 'RLS control: my work own org: %', nm; end if;
      select count(*) into n from public.query_items(v_org, p_state => 'any');
      if n is distinct from 0 then raise exception 'RLS: outsider sees fixture org items: %', n; end if;
      select count(*) into n from public.count_items(v_org, 'board', p_state => 'any');
      if n is distinct from 0 then raise exception 'RLS: outsider counts fixture org: %', n; end if;
      select count(*) into n from public.get_my_open_work(v_org);
      if n is distinct from 0 then raise exception 'RLS: outsider my work fixture org: %', n; end if;
      reset role;
    end if;
  end loop;

  -- A role/claims mix-up must not survive the block.
  if current_user is distinct from session_user then
    raise exception 'role not restored: %', current_user; end if;

  raise notice 'verify-query-items: all checks passed';
end
$verify$;

rollback;

-- Visible pass marker (the MCP does not surface RAISE NOTICE; any failure above raises).
select 'verify-query-items: all checks passed' as result;
