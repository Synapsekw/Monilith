-- Phase 6d-1: relation links. One row per (owning item, relation column, linked
-- target item). board_id is the OWNING item's board (denormalized like
-- time_entries) so RLS keys off can_read_board/can_edit_board directly.
create table public.relation_links (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  board_id       uuid not null references public.boards (id)        on delete cascade,
  item_id        uuid not null references public.items (id)         on delete cascade,
  column_id      uuid not null references public.columns (id)       on delete cascade,
  linked_item_id uuid not null references public.items (id)         on delete cascade,
  position       int  not null default 0,
  created_at     timestamptz not null default now(),
  unique (item_id, column_id, linked_item_id),
  check (item_id <> linked_item_id)
);

create index relation_links_item_column_idx on public.relation_links (item_id, column_id);
create index relation_links_board_idx       on public.relation_links (board_id);
create index relation_links_linked_idx      on public.relation_links (linked_item_id);

alter table public.relation_links enable row level security;

-- Read/write gate on the OWNING board (the linked-item name is RLS-filtered
-- separately when the client joins relation_links → items for the chip label).
create policy "relation_links: read if can read board" on public.relation_links
  for select to authenticated using (public.can_read_board(board_id));
create policy "relation_links: write if can edit board" on public.relation_links
  for all to authenticated
  using (public.can_edit_board(board_id))
  with check (public.is_org_member(org_id) and public.can_edit_board(board_id));

grant select, insert, update, delete on public.relation_links to authenticated;
-- intentionally NOT added to supabase_realtime (v1 = optimistic + revalidate).

-- Atomic replace: validate the column + target board, enforce allow_multiple,
-- delete the cell's existing links, insert the new set with position = index.
create or replace function public.set_relation_links(
  p_item_id uuid,
  p_column_id uuid,
  p_linked_item_ids uuid[]
) returns setof public.relation_links
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_org_id    uuid;
  v_board_id  uuid;
  v_kind      public.column_kind;
  v_settings  jsonb;
  v_target    uuid;
  v_multiple  boolean;
  v_ids       uuid[];
  v_id        uuid;
  v_pos       int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select org_id, board_id into v_org_id, v_board_id
  from public.items where id = p_item_id;
  if v_org_id is null then raise exception 'Item not found'; end if;
  if not public.can_edit_board(v_board_id) then raise exception 'Not authorized'; end if;

  select kind, settings into v_kind, v_settings from public.columns
  where id = p_column_id and board_id = v_board_id;
  if v_kind is null then raise exception 'Column not found'; end if;
  if v_kind <> 'relation' then raise exception 'Not a relation column'; end if;

  v_target   := (v_settings ->> 'target_board_id')::uuid;
  v_multiple := coalesce((v_settings ->> 'allow_multiple')::boolean, true);
  if v_target is null then raise exception 'Relation column has no target board'; end if;

  -- de-dup while preserving first-seen order
  select array_agg(x order by ord) into v_ids
  from (
    select x, min(ord) as ord
    from unnest(p_linked_item_ids) with ordinality as u(x, ord)
    group by x
  ) d;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  if not v_multiple and array_length(v_ids, 1) > 1 then
    raise exception 'This relation allows only a single linked item';
  end if;

  -- every linked id must be a real item on the target board, and not self
  if exists (
    select 1 from unnest(v_ids) as u(x)
    where u.x = p_item_id
       or not exists (
         select 1 from public.items i
         where i.id = u.x and i.board_id = v_target
       )
  ) then
    raise exception 'Linked item is not on the target board';
  end if;

  delete from public.relation_links
   where item_id = p_item_id and column_id = p_column_id;

  foreach v_id in array v_ids loop
    insert into public.relation_links
      (org_id, board_id, item_id, column_id, linked_item_id, position)
      values (v_org_id, v_board_id, p_item_id, p_column_id, v_id, v_pos);
    v_pos := v_pos + 1;
  end loop;

  return query
    select * from public.relation_links
    where item_id = p_item_id and column_id = p_column_id
    order by position;
end;
$$;

revoke all on function public.set_relation_links(uuid, uuid, uuid[]) from public;
grant execute on function public.set_relation_links(uuid, uuid, uuid[]) to authenticated;
