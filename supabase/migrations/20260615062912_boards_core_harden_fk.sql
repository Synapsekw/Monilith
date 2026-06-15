-- Phase 2a — harden boards-core inserts/updates against cross-org FK poisoning,
-- and fix cell_values indexing. RLS is the real tenant boundary, so enforce
-- parent-org consistency in WITH CHECK (the RPCs already derive org_id safely,
-- but direct table writes must be constrained too).

-- ----------------------------------------------------------------------------
-- SECURITY DEFINER helpers: does parent row X belong to org O? (bypass RLS, no
-- recursion). Mirror the Phase 1 helper style: set search_path = '', stable.
-- ----------------------------------------------------------------------------
create or replace function public.board_in_org(p_board_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.boards where id = p_board_id and org_id = p_org_id);
$$;
create or replace function public.group_in_org(p_group_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.groups where id = p_group_id and org_id = p_org_id);
$$;
create or replace function public.item_in_org(p_item_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.items where id = p_item_id and org_id = p_org_id);
$$;
create or replace function public.column_in_org(p_column_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.columns where id = p_column_id and org_id = p_org_id);
$$;

grant execute on function public.board_in_org(uuid, uuid)  to authenticated;
grant execute on function public.group_in_org(uuid, uuid)  to authenticated;
grant execute on function public.item_in_org(uuid, uuid)   to authenticated;
grant execute on function public.column_in_org(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Recreate insert + update policies with parent-org consistency in WITH CHECK.
-- ----------------------------------------------------------------------------
-- groups: parent board must be same org
drop policy "groups: insert if member" on public.groups;
create policy "groups: insert if member"
  on public.groups for insert to authenticated
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
drop policy "groups: update if member" on public.groups;
create policy "groups: update if member"
  on public.groups for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));

-- items: parent board AND group must be same org
drop policy "items: insert if member" on public.items;
create policy "items: insert if member"
  on public.items for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.group_in_org(group_id, org_id)
  );
drop policy "items: update if member" on public.items;
create policy "items: update if member"
  on public.items for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.group_in_org(group_id, org_id)
  );

-- columns: parent board must be same org
drop policy "columns: insert if member" on public.columns;
create policy "columns: insert if member"
  on public.columns for insert to authenticated
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
drop policy "columns: update if member" on public.columns;
create policy "columns: update if member"
  on public.columns for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));

-- cell_values: parent board, item, AND column must be same org
drop policy "cell_values: insert if member" on public.cell_values;
create policy "cell_values: insert if member"
  on public.cell_values for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.item_in_org(item_id, org_id)
    and public.column_in_org(column_id, org_id)
  );
drop policy "cell_values: update if member" on public.cell_values;
create policy "cell_values: update if member"
  on public.cell_values for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.item_in_org(item_id, org_id)
    and public.column_in_org(column_id, org_id)
  );

-- ----------------------------------------------------------------------------
-- cell_values indexing: drop the redundant item_id index (PK covers it),
-- add a column_id index for cascade deletes + by-column queries.
-- ----------------------------------------------------------------------------
drop index if exists public.cell_values_item_id_idx;
create index cell_values_column_id_idx on public.cell_values (column_id);
