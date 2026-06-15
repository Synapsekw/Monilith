-- Phase 2a — Boards core
-- boards → groups → items → columns → cell_values (EAV).
-- org_id is DENORMALIZED on every table so each RLS policy is a single
-- is_org_member(org_id) check — no joins, no recursion. Ordering uses
-- position float8 (midpoint reorder). Reuses the Phase 1 SECURITY DEFINER
-- helpers (is_org_member / has_org_role) verbatim — they are NOT redefined here.

-- ============================================================================
-- Enums
-- ============================================================================
create type public.column_kind as enum (
  'text', 'status', 'people', 'date', 'numbers', 'dropdown'
);

-- ============================================================================
-- Tables
-- ============================================================================

-- boards: top-level container under a workspace.
create table public.boards (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 100),
  description  text,
  position     double precision not null default 0,
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index boards_workspace_id_idx on public.boards (workspace_id);
create index boards_org_id_idx on public.boards (org_id);

-- groups: Monday-style colored row-bands within a board.
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  color      text not null default '#0073ea',
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index groups_board_id_idx on public.groups (board_id);
create index groups_org_id_idx on public.groups (org_id);

-- items: a row in a group. `name` is the built-in primary/title column.
-- parent_id stays null in Phase 2 (flat); Phase 6 subitems reuse it.
create table public.items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  parent_id  uuid references public.items (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 255),
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_board_id_idx on public.items (board_id);
create index items_group_id_idx on public.items (group_id);
create index items_org_id_idx on public.items (org_id);

-- columns: configurable column definitions (the six EAV kinds).
create table public.columns (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  kind       public.column_kind not null,
  name       text not null check (char_length(name) between 1 and 100),
  settings   jsonb not null default '{}'::jsonb,
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index columns_board_id_idx on public.columns (board_id);
create index columns_org_id_idx on public.columns (org_id);

-- cell_values: EAV. A missing row = empty cell. PK (item_id, column_id).
create table public.cell_values (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  column_id  uuid not null references public.columns (id) on delete cascade,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (item_id, column_id)
);
create index cell_values_item_id_idx on public.cell_values (item_id);
create index cell_values_org_id_idx on public.cell_values (org_id);

-- ============================================================================
-- Triggers — keep updated_at fresh (reuses Phase 1 public.set_updated_at).
-- ============================================================================
create trigger boards_set_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();
create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();
create trigger columns_set_updated_at
  before update on public.columns
  for each row execute function public.set_updated_at();
create trigger cell_values_set_updated_at
  before update on public.cell_values
  for each row execute function public.set_updated_at();

-- ============================================================================
-- RPC: create_board — atomic auto-seed (board + Group 1 + Status/Owner/Date).
-- Derives org_id from the workspace (membership-checked). Mirrors
-- create_organization (SECURITY DEFINER, set search_path = '').
-- ============================================================================
create or replace function public.create_board(p_workspace_id uuid, p_name text)
returns public.boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_board  public.boards;
  v_group  public.groups;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Derive org_id from the workspace and enforce membership.
  select org_id into v_org_id
  from public.workspaces
  where id = p_workspace_id;

  if v_org_id is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.boards (org_id, workspace_id, name, position, created_by)
  values (v_org_id, p_workspace_id, p_name, 0, v_uid)
  returning * into v_board;

  insert into public.groups (org_id, board_id, name, color, position)
  values (v_org_id, v_board.id, 'Group 1', '#0073ea', 0)
  returning * into v_group;

  insert into public.columns (org_id, board_id, kind, name, settings, position)
  values
    (v_org_id, v_board.id, 'status', 'Status', '{"options": []}'::jsonb, 0),
    (v_org_id, v_board.id, 'people', 'Owner',  '{}'::jsonb,              1),
    (v_org_id, v_board.id, 'date',   'Date',   '{}'::jsonb,              2);

  return v_board;
end;
$$;

-- ============================================================================
-- RPC: create_item — derive org_id/board_id from the group, position = max+1.
-- ============================================================================
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

  select coalesce(max(position), 0) + 1 into v_pos
  from public.items
  where group_id = p_group_id;

  insert into public.items (org_id, board_id, group_id, name, position)
  values (v_org_id, v_board_id, p_group_id, p_name, v_pos)
  returning * into v_item;

  return v_item;
end;
$$;

-- ============================================================================
-- Row Level Security — enable + default-deny on all five tables.
-- ============================================================================
alter table public.boards      enable row level security;
alter table public.groups      enable row level security;
alter table public.items       enable row level security;
alter table public.columns     enable row level security;
alter table public.cell_values enable row level security;

-- boards --------------------------------------------------------------------
create policy "boards: read if member"
  on public.boards for select to authenticated
  using (public.is_org_member(org_id));
create policy "boards: insert if member"
  on public.boards for insert to authenticated
  with check (public.is_org_member(org_id) and created_by = (select auth.uid()));
create policy "boards: update if member"
  on public.boards for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "boards: delete if owner/admin"
  on public.boards for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- groups --------------------------------------------------------------------
create policy "groups: read if member"
  on public.groups for select to authenticated
  using (public.is_org_member(org_id));
create policy "groups: insert if member"
  on public.groups for insert to authenticated
  with check (public.is_org_member(org_id));
create policy "groups: update if member"
  on public.groups for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "groups: delete if member"
  on public.groups for delete to authenticated
  using (public.is_org_member(org_id));

-- items ---------------------------------------------------------------------
create policy "items: read if member"
  on public.items for select to authenticated
  using (public.is_org_member(org_id));
create policy "items: insert if member"
  on public.items for insert to authenticated
  with check (public.is_org_member(org_id));
create policy "items: update if member"
  on public.items for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "items: delete if member"
  on public.items for delete to authenticated
  using (public.is_org_member(org_id));

-- columns -------------------------------------------------------------------
create policy "columns: read if member"
  on public.columns for select to authenticated
  using (public.is_org_member(org_id));
create policy "columns: insert if member"
  on public.columns for insert to authenticated
  with check (public.is_org_member(org_id));
create policy "columns: update if member"
  on public.columns for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "columns: delete if member"
  on public.columns for delete to authenticated
  using (public.is_org_member(org_id));

-- cell_values ---------------------------------------------------------------
create policy "cell_values: read if member"
  on public.cell_values for select to authenticated
  using (public.is_org_member(org_id));
create policy "cell_values: insert if member"
  on public.cell_values for insert to authenticated
  with check (public.is_org_member(org_id));
create policy "cell_values: update if member"
  on public.cell_values for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "cell_values: delete if member"
  on public.cell_values for delete to authenticated
  using (public.is_org_member(org_id));

-- ============================================================================
-- Grants — RLS is the boundary; grant DML + RPC execute to authenticated.
-- ============================================================================
grant select, insert, update, delete
  on public.boards, public.groups, public.items,
     public.columns, public.cell_values
  to authenticated;

grant execute on function public.create_board(uuid, text) to authenticated;
grant execute on function public.create_item(uuid, text) to authenticated;

-- ============================================================================
-- Realtime — add the five tables to the supabase_realtime publication
-- (slice 2b subscribes; provisioning now keeps the migration history clean).
-- ============================================================================
alter publication supabase_realtime add table public.boards;
alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.columns;
alter publication supabase_realtime add table public.cell_values;
