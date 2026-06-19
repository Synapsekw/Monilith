-- Phase 6a subitems. `items.parent_id` already exists (boards_core, reserved for
-- this). Add an index for child lookups + the single-level invariant guard.

create index if not exists items_parent_id_idx on public.items (parent_id);

-- Enforce single-level nesting: a subitem's parent must be a top-level item on
-- the same board; an item that already has subitems may not become a subitem.
-- Defense-in-depth — the Server Action also sets these fields correctly.
create or replace function public.tg_items_single_level()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_parent uuid;
  v_parent_board  uuid;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'An item cannot be its own parent';
    end if;

    select i.parent_id, i.board_id
      into v_parent_parent, v_parent_board
      from public.items i
     where i.id = new.parent_id;

    if not found then
      raise exception 'Parent item % not found', new.parent_id;
    end if;
    if v_parent_parent is not null then
      raise exception 'Subitems cannot be nested (single-level only)';
    end if;
    if v_parent_board <> new.board_id then
      raise exception 'Subitem must belong to the same board as its parent';
    end if;
    if exists (select 1 from public.items c where c.parent_id = new.id) then
      raise exception 'An item with subitems cannot become a subitem';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists items_single_level on public.items;
create trigger items_single_level
  before insert or update on public.items
  for each row execute function public.tg_items_single_level();
