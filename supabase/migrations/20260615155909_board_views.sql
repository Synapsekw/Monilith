-- Phase 3a: board_views — one row per board view (Table/Kanban). Mirrors
-- boards-core conventions: denormalized org_id, is_org_member RLS, board_in_org
-- write guard, set_updated_at trigger. Calendar/Timeline join the enum in 3b.

create type public.view_kind as enum ('table', 'kanban');

create table public.board_views (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  kind       public.view_kind not null,
  name       text not null check (char_length(name) between 1 and 100),
  config     jsonb not null default '{}'::jsonb,
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index board_views_board_id_idx on public.board_views (board_id);
create index board_views_org_id_idx on public.board_views (org_id);

create trigger board_views_set_updated_at
  before update on public.board_views
  for each row execute function public.set_updated_at();

alter table public.board_views enable row level security;

create policy "board_views: read if member" on public.board_views
  for select using (public.is_org_member(org_id));
create policy "board_views: insert if member" on public.board_views
  for insert with check (
    public.is_org_member(org_id) and public.board_in_org(board_id, org_id)
  );
create policy "board_views: update if member" on public.board_views
  for update using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id) and public.board_in_org(board_id, org_id)
  );
create policy "board_views: delete if member" on public.board_views
  for delete using (public.is_org_member(org_id));

-- Backfill: every existing board gets a default Table view at position 0.
insert into public.board_views (org_id, board_id, kind, name, config, position)
select b.org_id, b.id, 'table', 'Main Table', '{}'::jsonb, 0
from public.boards b
where not exists (
  select 1 from public.board_views v where v.board_id = b.id
);

-- Update create_board to also seed the default Table view. Body is identical to
-- the boards-core version with the board_views insert appended before `return`.
create or replace function public.create_board(p_workspace_id uuid, p_name text)
returns public.boards
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_board  public.boards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id into v_org_id from public.workspaces where id = p_workspace_id;
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
  values (v_org_id, v_board.id, 'Group 1', '#0073ea', 0);

  insert into public.columns (org_id, board_id, kind, name, settings, position)
  values
    (
      v_org_id, v_board.id, 'status', 'Status',
      jsonb_build_object('options', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Working on it', 'color', '#fdab3d'),
        jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Stuck',         'color', '#e2445c'),
        jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Done',          'color', '#00c875')
      )),
      0
    ),
    (v_org_id, v_board.id, 'people', 'Owner', '{}'::jsonb, 1),
    (v_org_id, v_board.id, 'date',   'Date',  '{}'::jsonb, 2);

  insert into public.board_views (org_id, board_id, kind, name, config, position)
  values (v_org_id, v_board.id, 'table', 'Main Table', '{}'::jsonb, 0);

  return v_board;
end; $$;

-- RPC: create_board_view — derive org_id from the board (membership-checked),
-- position = max+1. Mirrors create_item.
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

  select coalesce(max(position), -1) + 1 into v_pos
  from public.board_views where board_id = p_board_id;

  insert into public.board_views (org_id, board_id, kind, name, config, position)
  values (v_org_id, p_board_id, p_kind, p_name, coalesce(p_config, '{}'::jsonb), v_pos)
  returning * into v_row;
  return v_row;
end; $$;

grant execute on function public.create_board_view(uuid, public.view_kind, text, jsonb)
  to authenticated;
