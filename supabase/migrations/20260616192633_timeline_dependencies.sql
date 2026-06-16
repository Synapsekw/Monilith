-- Phase 3b (Timeline slice): add the 'timeline' view kind + the item_dependencies
-- model (finish-to-start) with a cycle-safe RPC. 'calendar' was added earlier.
-- ALTER TYPE ADD VALUE is additive and not used as a value within this migration.
alter type public.view_kind add value if not exists 'timeline';

create table public.item_dependencies (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  board_id       uuid not null references public.boards (id) on delete cascade,
  predecessor_id uuid not null references public.items (id) on delete cascade,
  successor_id   uuid not null references public.items (id) on delete cascade,
  type           text not null default 'FS' check (type in ('FS')),
  created_at     timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);
create index item_dependencies_board_id_idx     on public.item_dependencies (board_id);
create index item_dependencies_org_id_idx        on public.item_dependencies (org_id);
create index item_dependencies_predecessor_idx   on public.item_dependencies (predecessor_id);
create index item_dependencies_successor_idx     on public.item_dependencies (successor_id);

alter table public.item_dependencies enable row level security;

create policy "item_dependencies: read if member" on public.item_dependencies
  for select using (public.is_org_member(org_id));
create policy "item_dependencies: insert if member" on public.item_dependencies
  for insert with check (
    public.is_org_member(org_id) and public.board_in_org(board_id, org_id)
  );
create policy "item_dependencies: delete if member" on public.item_dependencies
  for delete using (public.is_org_member(org_id));

-- RPC: create_item_dependency — same-board + self-link + cycle guards, then insert.
-- Cycle = successor can already reach predecessor through existing edges.
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
