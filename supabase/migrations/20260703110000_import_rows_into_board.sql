-- import_rows_into_board: append-only import RPC for the Import Wizard v2 flow
-- (Task 13). Ingests a fully-resolved payload — an optional new group (or an
-- existing target groupId), new columns, option additions onto an existing
-- column's settings, items, subitems, and their cell values — into an
-- EXISTING board in one transaction. The caller (import wizard server
-- action) mints all client-facing uuids and shapes cell values; this
-- function only enforces membership, resolves/validates the target group,
-- computes append positions server-side, and inserts. Mirrors
-- create_board_from_template (SECURITY DEFINER, search_path = '',
-- auth.uid()/is_org_member guards) but appends to an existing board instead
-- of minting one.
--
-- Payload shape:
-- {
--   "newGroup": {"id","name","color"}      -- optional
--   "groupId": "..."                       -- target group when newGroup absent
--   "newColumns": [{"id","kind","name","settings","position"}]
--   "optionAdditions": [{"columnId","options":[{"id","label","color"}]}]
--   "items": [{"id","name","position","cells":[{"columnId","value"}]}]
--   "subitems": [{"id","parentId","name","position","cells":[...]}]
-- }
--
-- All inserted rows derive org_id from v_org_id and board_id from
-- p_board_id server-side — client-supplied ids are used only as the primary
-- keys of the freshly-minted rows, never to source org/board scoping.
create or replace function public.import_rows_into_board(
  p_board_id uuid,
  p_payload  jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org_id   uuid;
  v_group_id uuid;
  v_pos      double precision;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  -- Board-level write guard: SECURITY DEFINER bypasses the per-table RLS
  -- write policies (which all check can_edit_board), so enforce the same
  -- board-level edit check explicitly — org membership alone must not grant
  -- append rights to a private/viewer-shared board (see
  -- 20260620100000_board_level_sharing.sql).
  if not public.can_edit_board(p_board_id) then
    raise exception 'not authorized to edit this board' using errcode = '42501';
  end if;

  -- 1. Resolve the target group: mint a new one appended after the board's
  --    existing groups, or validate that an existing groupId belongs to
  --    this board.
  if p_payload ? 'newGroup' then
    select coalesce(max(position) + 1, 0) into v_pos
    from public.groups where board_id = p_board_id;

    insert into public.groups (id, org_id, board_id, name, color, position)
    values (
      (p_payload->'newGroup'->>'id')::uuid,
      v_org_id, p_board_id,
      p_payload->'newGroup'->>'name',
      coalesce(p_payload->'newGroup'->>'color', '#0073ea'),
      v_pos
    )
    returning id into v_group_id;
  else
    v_group_id := (p_payload->>'groupId')::uuid;
    if not exists (
      select 1 from public.groups
      where id = v_group_id and board_id = p_board_id
    ) then
      raise exception 'group not found' using errcode = 'P0002';
    end if;
  end if;

  -- Guard: every subitem must parent an item minted in this same payload.
  -- SECURITY DEFINER bypasses the RLS insert policies that confined
  -- client-supplied parent ids in the v1 flow, so confine explicitly here.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
    where s->>'parentId' not in (
      select i->>'id'
      from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
    )
  ) then
    raise exception 'subitem parent not in payload' using errcode = '22023';
  end if;

  -- 2. New columns, appended sequentially after the board's existing max
  --    position, ordered by the payload's own position field.
  insert into public.columns (id, org_id, board_id, kind, name, settings, position)
  select
    (c->>'id')::uuid,
    v_org_id, p_board_id,
    (c->>'kind')::public.column_kind,
    c->>'name',
    coalesce(c->'settings', '{}'::jsonb),
    (select coalesce(max(position), 0) from public.columns where board_id = p_board_id)
      + row_number() over (order by (c->>'position')::double precision)
  from jsonb_array_elements(coalesce(p_payload->'newColumns', '[]'::jsonb)) as c;

  -- 3. Option additions: append new options onto an existing column's
  --    settings->options array. Set-based — one statement covers every
  --    optionAdditions entry.
  update public.columns col
  set settings = jsonb_set(
    col.settings,
    '{options}',
    coalesce(col.settings->'options', '[]'::jsonb) || coalesce(oa->'options', '[]'::jsonb)
  )
  from jsonb_array_elements(coalesce(p_payload->'optionAdditions', '[]'::jsonb)) as oa
  where col.id = (oa->>'columnId')::uuid
    and col.board_id = p_board_id;

  -- 4. Items into the resolved group, appended after the group's existing
  --    top-level items (parent_id is null), offset by the payload position.
  insert into public.items (id, org_id, board_id, group_id, name, position)
  select
    (i->>'id')::uuid,
    v_org_id, p_board_id, v_group_id,
    i->>'name',
    (select coalesce(max(position) + 1, 0) from public.items
       where group_id = v_group_id and parent_id is null)
      + (i->>'position')::double precision
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i;

  -- 5. Subitems, parented to their payload parentId, in the same resolved
  --    group as the items just inserted above. Position appended per-parent
  --    the same way (offset by that parent's existing max child position).
  insert into public.items (id, org_id, board_id, group_id, parent_id, name, position)
  select
    (s->>'id')::uuid,
    v_org_id, p_board_id, v_group_id,
    (s->>'parentId')::uuid,
    s->>'name',
    (select coalesce(max(position) + 1, 0) from public.items
       where parent_id = (s->>'parentId')::uuid)
      + (s->>'position')::double precision
  from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s;

  -- Guard: every cell must reference a column of THIS board (including the
  -- newColumns inserted above). Same rationale as the subitem-parent guard:
  -- definer mode means RLS no longer confines client-supplied column ids.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
    cross join lateral jsonb_array_elements(coalesce(i->'cells', '[]'::jsonb)) as cell
    where not exists (
      select 1 from public.columns c
      where c.id = (cell->>'columnId')::uuid and c.board_id = p_board_id
    )
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
    cross join lateral jsonb_array_elements(coalesce(s->'cells', '[]'::jsonb)) as cell
    where not exists (
      select 1 from public.columns c
      where c.id = (cell->>'columnId')::uuid and c.board_id = p_board_id
    )
  ) then
    raise exception 'cell column not on board' using errcode = '22023';
  end if;

  -- 6. Cell values for every item + subitem just inserted.
  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org_id, p_board_id, (i->>'id')::uuid, (cell->>'columnId')::uuid, cell->'value'
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
  cross join lateral jsonb_array_elements(coalesce(i->'cells', '[]'::jsonb)) as cell
  union all
  select v_org_id, p_board_id, (s->>'id')::uuid, (cell->>'columnId')::uuid, cell->'value'
  from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
  cross join lateral jsonb_array_elements(coalesce(s->'cells', '[]'::jsonb)) as cell;
end; $$;

grant execute on function public.import_rows_into_board(uuid, jsonb) to authenticated;
