-- Board-level sharing — per-board visibility on the org spine.
-- Adds board_members grants + can_read_board/can_edit_board, rewrites READ
-- policies on every board-scoped table to per-board visibility, hardens the 6
-- user-callable write RPCs against viewers, and back-fills existing boards so
-- nothing disappears at rollout.
-- Spec: docs/superpowers/specs/2026-06-20-board-level-sharing-design.md

-- ============================================================================
-- Part A: enum, table, helpers, board_members RLS
-- ============================================================================
create type public.board_access as enum ('viewer', 'editor');

create table public.board_members (
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null references public.boards (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  access_level public.board_access not null default 'viewer',
  granted_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index board_members_user_id_idx on public.board_members (user_id);
create index board_members_org_id_idx  on public.board_members (org_id);

create or replace function public.can_read_board(p_board_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id and b.created_by = (select auth.uid())
  ) or exists (
    select 1 from public.board_members m
    where m.board_id = p_board_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_board(p_board_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id and b.created_by = (select auth.uid())
  ) or exists (
    select 1 from public.board_members m
    where m.board_id = p_board_id and m.user_id = (select auth.uid())
      and m.access_level = 'editor'
  );
$$;

grant execute on function public.can_read_board(uuid) to authenticated;
grant execute on function public.can_edit_board(uuid) to authenticated;

alter table public.board_members enable row level security;

create policy "board_members: read if can read board" on public.board_members
  for select to authenticated using (public.can_read_board(board_id));
create policy "board_members: owner manages" on public.board_members
  for all to authenticated
  using (
    exists (select 1 from public.boards b
            where b.id = board_id and b.created_by = (select auth.uid()))
  )
  with check (
    public.is_org_member(org_id)
    and exists (select 1 from public.boards b
                where b.id = board_id and b.created_by = (select auth.uid()))
  );

grant select, insert, update, delete on public.board_members to authenticated;

alter publication supabase_realtime add table public.board_members;

-- ============================================================================
-- Part B: rewrite RLS on the core 5 tables
-- ============================================================================
-- ── boards ─────────────────────────────────────────────────────────────────
drop policy "boards: read if member"        on public.boards;
drop policy "boards: update if member"      on public.boards;
drop policy "boards: delete if owner/admin" on public.boards;
-- (insert policy "boards: insert if member" is unchanged: create your own board)
create policy "boards: read if can read" on public.boards
  for select to authenticated using (public.can_read_board(id));
create policy "boards: update if can edit" on public.boards
  for update to authenticated
  using (public.can_edit_board(id))
  with check (public.is_org_member(org_id) and public.can_edit_board(id));
create policy "boards: delete if owner" on public.boards
  for delete to authenticated using (created_by = (select auth.uid()));

-- ── groups ─────────────────────────────────────────────────────────────────
drop policy "groups: read if member"   on public.groups;
drop policy "groups: insert if member" on public.groups;
drop policy "groups: update if member" on public.groups;
drop policy "groups: delete if member" on public.groups;
create policy "groups: read if can read" on public.groups
  for select to authenticated using (public.can_read_board(board_id));
create policy "groups: insert if can edit" on public.groups
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
  );
create policy "groups: update if can edit" on public.groups
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
  );
create policy "groups: delete if can edit" on public.groups
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── items ──────────────────────────────────────────────────────────────────
drop policy "items: read if member"   on public.items;
drop policy "items: insert if member" on public.items;
drop policy "items: update if member" on public.items;
drop policy "items: delete if member" on public.items;
create policy "items: read if can read" on public.items
  for select to authenticated using (public.can_read_board(board_id));
create policy "items: insert if can edit" on public.items
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.group_in_org(group_id, org_id)
  );
create policy "items: update if can edit" on public.items
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.group_in_org(group_id, org_id)
  );
create policy "items: delete if can edit" on public.items
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── columns ────────────────────────────────────────────────────────────────
drop policy "columns: read if member"   on public.columns;
drop policy "columns: insert if member" on public.columns;
drop policy "columns: update if member" on public.columns;
drop policy "columns: delete if member" on public.columns;
create policy "columns: read if can read" on public.columns
  for select to authenticated using (public.can_read_board(board_id));
create policy "columns: insert if can edit" on public.columns
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
  );
create policy "columns: update if can edit" on public.columns
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id)
  );
create policy "columns: delete if can edit" on public.columns
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── cell_values ────────────────────────────────────────────────────────────
drop policy "cell_values: read if member"   on public.cell_values;
drop policy "cell_values: insert if member" on public.cell_values;
drop policy "cell_values: update if member" on public.cell_values;
drop policy "cell_values: delete if member" on public.cell_values;
create policy "cell_values: read if can read" on public.cell_values
  for select to authenticated using (public.can_read_board(board_id));
create policy "cell_values: insert if can edit" on public.cell_values
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id)
    and public.column_in_org(column_id, org_id)
  );
create policy "cell_values: update if can edit" on public.cell_values
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id)
    and public.column_in_org(column_id, org_id)
  );
create policy "cell_values: delete if can edit" on public.cell_values
  for delete to authenticated using (public.can_edit_board(board_id));

-- ============================================================================
-- Part C: rewrite RLS on the satellite tables
-- ============================================================================
-- ── board_views ──
drop policy "board_views: read if member"   on public.board_views;
drop policy "board_views: insert if member" on public.board_views;
drop policy "board_views: update if member" on public.board_views;
drop policy "board_views: delete if member" on public.board_views;
create policy "board_views: read if can read" on public.board_views
  for select to authenticated using (public.can_read_board(board_id));
create policy "board_views: insert if can edit" on public.board_views
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "board_views: update if can edit" on public.board_views
  for update to authenticated using (public.can_edit_board(board_id))
  with check (public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "board_views: delete if can edit" on public.board_views
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── item_dependencies ──
drop policy "item_dependencies: read if member"   on public.item_dependencies;
drop policy "item_dependencies: insert if member" on public.item_dependencies;
drop policy "item_dependencies: delete if member" on public.item_dependencies;
create policy "item_dependencies: read if can read" on public.item_dependencies
  for select to authenticated using (public.can_read_board(board_id));
create policy "item_dependencies: insert if can edit" on public.item_dependencies
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "item_dependencies: delete if can edit" on public.item_dependencies
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── automations ──
drop policy "automations: read if member"   on public.automations;
drop policy "automations: insert if member" on public.automations;
drop policy "automations: update if member" on public.automations;
drop policy "automations: delete if member" on public.automations;
create policy "automations: read if can read" on public.automations
  for select to authenticated using (public.can_read_board(board_id));
create policy "automations: insert if can edit" on public.automations
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "automations: update if can edit" on public.automations
  for update to authenticated using (public.can_edit_board(board_id))
  with check (public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id));
create policy "automations: delete if can edit" on public.automations
  for delete to authenticated using (public.can_edit_board(board_id));

-- ── item_updates (comments) ──
drop policy "item_updates: read if member"          on public.item_updates;
drop policy "item_updates: insert if member+author" on public.item_updates;
drop policy "item_updates: update if author/admin"  on public.item_updates;
drop policy "item_updates: delete if author/admin"  on public.item_updates;
create policy "item_updates: read if can read" on public.item_updates
  for select to authenticated using (public.can_read_board(board_id));
create policy "item_updates: insert if editor+author" on public.item_updates
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id)
    and author_id = (select auth.uid()));
create policy "item_updates: update if author" on public.item_updates
  for update to authenticated using (
    author_id = (select auth.uid()) or public.can_edit_board(board_id))
  with check (
    author_id = (select auth.uid()) or public.can_edit_board(board_id));
create policy "item_updates: delete if author or editor" on public.item_updates
  for delete to authenticated using (
    author_id = (select auth.uid()) or public.can_edit_board(board_id));

-- ── item_activities (append-only feed; SELECT only) ──
drop policy "item_activities: read if member" on public.item_activities;
create policy "item_activities: read if can read" on public.item_activities
  for select to authenticated using (public.can_read_board(board_id));

-- ── attachments ──
drop policy attachments_select on public.attachments;
drop policy attachments_insert on public.attachments;
drop policy attachments_delete on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated using (public.can_read_board(board_id));
create policy attachments_insert on public.attachments
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id));
create policy attachments_delete on public.attachments
  for delete to authenticated using (
    uploaded_by = (select auth.uid()) or public.can_edit_board(board_id));

-- ── time_entries ──
drop policy time_entries_select on public.time_entries;
drop policy time_entries_insert on public.time_entries;
drop policy time_entries_update on public.time_entries;
drop policy time_entries_delete on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated using (public.can_read_board(board_id));
create policy time_entries_insert on public.time_entries
  for insert to authenticated with check (
    public.is_org_member(org_id) and public.can_edit_board(board_id)
    and public.board_in_org(board_id, org_id) and public.item_in_org(item_id, org_id)
    and user_id = (select auth.uid()));
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (public.can_edit_board(board_id) and user_id = (select auth.uid()))
  with check (public.can_edit_board(board_id) and user_id = (select auth.uid()));
create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (public.can_edit_board(board_id) and user_id = (select auth.uid()));

-- ── automation log tables (SELECT-only; date_fires/webhook lack board_id, so
--    scope via the automation's board) ──
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('automation_runs','automation_date_fires','automation_webhook_deliveries')
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "automation_runs: read if can read" on public.automation_runs
  for select to authenticated using (public.can_read_board(board_id));
create policy "automation_date_fires: read if can read" on public.automation_date_fires
  for select to authenticated using (
    public.can_read_board((select a.board_id from public.automations a where a.id = automation_id)));
-- webhook deliveries link to a run (run_id), and runs carry board_id directly.
create policy "automation_webhook_deliveries: read if can read" on public.automation_webhook_deliveries
  for select to authenticated using (
    public.can_read_board((select r.board_id from public.automation_runs r where r.id = run_id)));

-- ============================================================================
-- Part D: harden the 6 user-callable write RPCs against viewers
-- ============================================================================
-- ── create_item (boards_core.sql) — v_board_id from the group ──
create or replace function public.create_item(p_group_id uuid, p_name text)
returns public.items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org_id   uuid;
  v_board_id uuid;
  v_pos      double precision;
  v_item     public.items;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id, board_id into v_org_id, v_board_id
  from public.groups
  where id = p_group_id;

  if v_org_id is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not public.can_edit_board(v_board_id) then
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;

  select coalesce(max(position), 0) + 1 into v_pos
  from public.items
  where group_id = p_group_id;

  insert into public.items (org_id, board_id, group_id, name, position)
  values (v_org_id, v_board_id, p_group_id, p_name, v_pos)
  returning * into v_item;

  return v_item;
end;
$$;

grant execute on function public.create_item(uuid, text) to authenticated;

-- ── create_board_view (board_views.sql) — board id is p_board_id ──
create or replace function public.create_board_view(
  p_board_id uuid,
  p_kind public.view_kind,
  p_name text,
  p_config jsonb default '{}'::jsonb
) returns public.board_views
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_pos    double precision;
  v_row    public.board_views;
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
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;

  select coalesce(max(position), -1) + 1 into v_pos
  from public.board_views where board_id = p_board_id;

  insert into public.board_views (org_id, board_id, kind, name, config, position)
  values (v_org_id, p_board_id, p_kind, p_name, coalesce(p_config, '{}'::jsonb), v_pos)
  returning * into v_row;
  return v_row;
end; $$;

grant execute on function public.create_board_view(uuid, public.view_kind, text, jsonb)
  to authenticated;

-- ── delete_board_view (delete_board_view_rpc.sql) — v_board_id from the view ──
create or replace function public.delete_board_view(p_view_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_board_id uuid;
  v_org_id   uuid;
  v_count    int;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select board_id, org_id into v_board_id, v_org_id
  from public.board_views where id = p_view_id;
  if v_board_id is null then
    raise exception 'view not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not public.can_edit_board(v_board_id) then
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;
  -- Lock all of this board's view rows so two concurrent deletes can't both
  -- observe count > 1 and delete the last two.
  select count(*) into v_count
  from public.board_views where board_id = v_board_id for update;
  if v_count <= 1 then
    raise exception 'a board must keep at least one view' using errcode = 'P0001';
  end if;
  delete from public.board_views where id = p_view_id;
end; $$;

grant execute on function public.delete_board_view(uuid) to authenticated;

-- ── create_item_dependency (timeline_dependencies.sql) — v_board_id from the
--    predecessor item (both items share the same board) ──
create or replace function public.create_item_dependency(
  p_predecessor uuid, p_successor uuid
) returns public.item_dependencies
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := (select auth.uid());
  v_board_id   uuid;
  v_org_id     uuid;
  v_succ_board uuid;
  v_row        public.item_dependencies;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_predecessor = p_successor then
    raise exception 'an item cannot depend on itself' using errcode = 'P0001';
  end if;

  select board_id, org_id into v_board_id, v_org_id
  from public.items where id = p_predecessor;
  if v_board_id is null then
    raise exception 'predecessor not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not public.can_edit_board(v_board_id) then
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;

  select board_id into v_succ_board from public.items where id = p_successor;
  if v_succ_board is null or v_succ_board <> v_board_id then
    raise exception 'items must be on the same board' using errcode = 'P0001';
  end if;

  -- Cycle check: does p_successor already reach p_predecessor?
  if exists (
    with recursive reach (node) as (
      select successor_id from public.item_dependencies where predecessor_id = p_successor
      union
      select d.successor_id
      from public.item_dependencies d
      join reach r on d.predecessor_id = r.node
    )
    select 1 from reach where node = p_predecessor
  ) then
    raise exception 'this would create a dependency cycle' using errcode = 'P0001';
  end if;

  insert into public.item_dependencies (org_id, board_id, predecessor_id, successor_id, type)
  values (v_org_id, v_board_id, p_predecessor, p_successor, 'FS')
  returning * into v_row;
  return v_row;
end; $$;

grant execute on function public.create_item_dependency(uuid, uuid) to authenticated;

-- ── delete_column_option (files_column_and_option_delete.sql) — v_board_id
--    added to the column lookup ──
create or replace function public.delete_column_option(
  p_column_id uuid,
  p_option_id text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id   uuid;
  v_board_id uuid;
  v_kind     public.column_kind;
  v_count    integer := 0;
begin
  select org_id, board_id, kind into v_org_id, v_board_id, v_kind
  from public.columns where id = p_column_id;
  if v_org_id is null then
    raise exception 'Column not found';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'Not authorized';
  end if;
  if not public.can_edit_board(v_board_id) then
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;

  if v_kind = 'status' then
    -- count, then delete referencing cells (clearing = remove the row,
    -- matching clearCell semantics).
    select count(*) into v_count
    from public.cell_values
    where column_id = p_column_id and value->>'optionId' = p_option_id;

    delete from public.cell_values
    where column_id = p_column_id and value->>'optionId' = p_option_id;

  elsif v_kind = 'dropdown' then
    select count(*) into v_count
    from public.cell_values
    where column_id = p_column_id and value->'optionIds' ? p_option_id;

    -- strip the id from each array
    update public.cell_values
    set value = jsonb_set(
      value, '{optionIds}',
      coalesce((
        select jsonb_agg(e)
        from jsonb_array_elements_text(value->'optionIds') e
        where e <> p_option_id
      ), '[]'::jsonb)
    )
    where column_id = p_column_id and value->'optionIds' ? p_option_id;

    -- drop now-empty cells
    delete from public.cell_values
    where column_id = p_column_id and value->'optionIds' = '[]'::jsonb;

  else
    raise exception 'Column kind % has no options', v_kind;
  end if;

  -- remove the option from settings.options
  update public.columns
  set settings = jsonb_set(
    settings, '{options}',
    coalesce((
      select jsonb_agg(o)
      from jsonb_array_elements(settings->'options') o
      where o->>'id' <> p_option_id
    ), '[]'::jsonb)
  )
  where id = p_column_id;

  return v_count;
end;
$$;

revoke all on function public.delete_column_option(uuid, text) from public;
grant execute on function public.delete_column_option(uuid, text) to authenticated;

-- ── start_timer (time_entries.sql) — v_board_id from the item ──
create or replace function public.start_timer(
  p_item_id uuid,
  p_column_id uuid
) returns setof public.time_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := (select auth.uid());
  v_org_id   uuid;
  v_board_id uuid;
  v_kind     public.column_kind;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select org_id, board_id into v_org_id, v_board_id
  from public.items where id = p_item_id;
  if v_org_id is null then raise exception 'Item not found'; end if;
  if not public.is_org_member(v_org_id) then raise exception 'Not authorized'; end if;
  if not public.can_edit_board(v_board_id) then
    raise exception 'no edit access to this board' using errcode = '42501';
  end if;

  select kind into v_kind from public.columns
  where id = p_column_id and board_id = v_board_id;
  if v_kind is null then raise exception 'Column not found'; end if;
  if v_kind <> 'time_tracking' then raise exception 'Not a time tracking column'; end if;

  -- Stop the caller's currently-running timer (one per user) BEFORE inserting,
  -- so the partial-unique index is never transiently violated.
  return query
    update public.time_entries
       set ended_at = now(),
           duration_secs = greatest(0, floor(extract(epoch from (now() - started_at))))::int
     where user_id = v_uid and ended_at is null
     returning *;

  return query
    insert into public.time_entries (org_id, board_id, item_id, column_id, user_id, started_at)
         values (v_org_id, v_board_id, p_item_id, p_column_id, v_uid, now())
      returning *;
end;
$$;

revoke all on function public.start_timer(uuid, uuid) from public;
grant execute on function public.start_timer(uuid, uuid) to authenticated;

-- ============================================================================
-- Part E: share/unshare RPCs + back-fill
-- ============================================================================
-- ── Sharing RPCs (owner-only; SECURITY DEFINER) ──
create or replace function public.share_board(
  p_board_id uuid, p_user_id uuid, p_access public.board_access)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid;
begin
  select org_id into v_org from public.boards
    where id = p_board_id and created_by = v_uid;
  if v_org is null then
    raise exception 'not the board owner' using errcode = '42501';
  end if;
  if not public.is_org_member_of(v_org, p_user_id) then
    raise exception 'target is not a member of this org' using errcode = '42501';
  end if;
  insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
  values (v_org, p_board_id, p_user_id, p_access, v_uid)
  on conflict (board_id, user_id)
  do update set access_level = excluded.access_level, granted_by = excluded.granted_by;
end;
$$;

create or replace function public.unshare_board(p_board_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.boards
                 where id = p_board_id and created_by = v_uid) then
    raise exception 'not the board owner' using errcode = '42501';
  end if;
  delete from public.board_members where board_id = p_board_id and user_id = p_user_id;
end;
$$;

-- membership check for an arbitrary user (the existing is_org_member checks the
-- CALLER; here we validate the TARGET). SECURITY DEFINER, no recursion.
create or replace function public.is_org_member_of(p_org_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.org_members
                 where org_id = p_org_id and user_id = p_user_id);
$$;

grant execute on function public.share_board(uuid, uuid, public.board_access) to authenticated;
grant execute on function public.unshare_board(uuid, uuid) to authenticated;
grant execute on function public.is_org_member_of(uuid, uuid) to authenticated;

-- ── Back-fill: preserve today's "everyone in the org sees every board" for
--    boards that already exist. New boards (created after this migration) are
--    private-by-default. Grant editor to every current org member except the
--    board's creator (who already owns it). ──
insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
select b.org_id, b.id, m.user_id, 'editor'::public.board_access, b.created_by
from public.boards b
join public.org_members m on m.org_id = b.org_id and m.user_id <> b.created_by
on conflict (board_id, user_id) do nothing;
