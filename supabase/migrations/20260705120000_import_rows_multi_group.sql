-- import_rows_into_board (multi-group): the Import Wizard's Structure step lets
-- a user distribute imported rows across MULTIPLE groups (a mix of existing
-- board groups and freshly-created ones). This replaces the single-group
-- resolution of 20260703110000: the payload now carries a `groups` array and
-- each item/subitem carries its own `groupId`. New groups (existingGroupId
-- null) are created appended after the board's existing groups; referenced
-- existing groups are validated to belong to the board. All other behavior
-- (membership/edit guards, append positions, subitem-parent + cell-column
-- confinement) is preserved.
--
-- Payload shape:
-- {
--   "groups": [{"id","existingGroupId"|null,"name","color","position"}],
--   "newColumns": [{"id","kind","name","settings","position"}],
--   "optionAdditions": [{"columnId","options":[{"id","label","color"}]}],
--   "items": [{"id","groupId","name","position","cells":[{"columnId","value"}]}],
--   "subitems": [{"id","parentId","groupId","name","position","cells":[...]}]
-- }
create or replace function public.import_rows_into_board(
  p_board_id uuid,
  p_payload  jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_max_group_pos double precision;
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
  if not public.can_edit_board(p_board_id) then
    raise exception 'not authorized to edit this board' using errcode = '42501';
  end if;

  -- Validate reused existing groups belong to this board.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'groups', '[]'::jsonb)) as g
    where (g->>'existingGroupId') is not null
      and not exists (
        select 1 from public.groups
        where id = (g->>'existingGroupId')::uuid and board_id = p_board_id
      )
  ) then
    raise exception 'group not found' using errcode = 'P0002';
  end if;

  -- Every item/subitem groupId must be one of the payload's group ids.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
    where (i->>'groupId') not in (
      select g->>'id' from jsonb_array_elements(coalesce(p_payload->'groups','[]'::jsonb)) as g
    )
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
    where (s->>'groupId') not in (
      select g->>'id' from jsonb_array_elements(coalesce(p_payload->'groups','[]'::jsonb)) as g
    )
  ) then
    raise exception 'row group not in payload' using errcode = '22023';
  end if;

  -- Subitem parents must be items minted in this same payload.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
    where s->>'parentId' not in (
      select i->>'id' from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
    )
  ) then
    raise exception 'subitem parent not in payload' using errcode = '22023';
  end if;

  -- 1. Create new groups (existingGroupId null), appended after the board's
  --    current max group position, preserving payload order.
  select coalesce(max(position), -1) into v_max_group_pos
  from public.groups where board_id = p_board_id;

  insert into public.groups (id, org_id, board_id, name, color, position)
  select
    (g->>'id')::uuid,
    v_org_id, p_board_id,
    g->>'name',
    coalesce(g->>'color', '#0073ea'),
    v_max_group_pos + row_number() over (order by (g->>'position')::double precision)
  from jsonb_array_elements(coalesce(p_payload->'groups', '[]'::jsonb)) as g
  where (g->>'existingGroupId') is null;

  -- Confine every item/subitem to a group that belongs to THIS board: either a
  -- group just created in Step 1, or a validated reused existing group. This is
  -- the authoritative group confinement (NULL-safe positive check) — it also
  -- closes the reused-group id≠existingGroupId hole. Mirrors finding #5 in
  -- 20260704112000_create_board_from_template_confine_payload.sql.
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
    where not exists (
      select 1 from public.groups
      where id = (i->>'groupId')::uuid and board_id = p_board_id
    )
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
    where not exists (
      select 1 from public.groups
      where id = (s->>'groupId')::uuid and board_id = p_board_id
    )
  ) then
    raise exception 'row group not on board' using errcode = '22023';
  end if;

  -- 2. New columns (unchanged from the single-group version).
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

  -- 3. Option additions (unchanged).
  update public.columns col
  set settings = jsonb_set(
    col.settings, '{options}',
    coalesce(col.settings->'options', '[]'::jsonb) || coalesce(oa->'options', '[]'::jsonb)
  )
  from jsonb_array_elements(coalesce(p_payload->'optionAdditions', '[]'::jsonb)) as oa
  where col.id = (oa->>'columnId')::uuid and col.board_id = p_board_id;

  -- 4. Items into their OWN group, appended after that group's existing
  --    top-level items, offset by the payload position.
  insert into public.items (id, org_id, board_id, group_id, name, position)
  select
    (i->>'id')::uuid,
    v_org_id, p_board_id, (i->>'groupId')::uuid,
    i->>'name',
    (select coalesce(max(position) + 1, 0) from public.items
       where group_id = (i->>'groupId')::uuid and parent_id is null)
      + (i->>'position')::double precision
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i;

  -- 5. Subitems, parented to their payload parentId, in their own group.
  insert into public.items (id, org_id, board_id, group_id, parent_id, name, position)
  select
    (s->>'id')::uuid,
    v_org_id, p_board_id, (s->>'groupId')::uuid,
    (s->>'parentId')::uuid,
    s->>'name',
    (select coalesce(max(position) + 1, 0) from public.items
       where parent_id = (s->>'parentId')::uuid)
      + (s->>'position')::double precision
  from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s;

  -- Every cell must reference a column of THIS board (unchanged).
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

  -- 6. Cell values for every item + subitem (unchanged).
  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org_id, p_board_id, (i->>'id')::uuid, (cell->>'columnId')::uuid, cell->'value'
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) as i
  cross join lateral jsonb_array_elements(coalesce(i->'cells', '[]'::jsonb)) as cell
  union all
  select v_org_id, p_board_id, (s->>'id')::uuid, (cell->>'columnId')::uuid, cell->'value'
  from jsonb_array_elements(coalesce(p_payload->'subitems', '[]'::jsonb)) as s
  cross join lateral jsonb_array_elements(coalesce(s->'cells', '[]'::jsonb)) as cell;
end; $$;

-- Preserve the definer-execution hygiene from 20260704114000: authenticated
-- may execute; anon/public may not.
revoke execute on function public.import_rows_into_board(uuid, jsonb) from public, anon;
grant execute on function public.import_rows_into_board(uuid, jsonb) to authenticated;
