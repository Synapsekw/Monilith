-- Phase 4a (Collaboration): item_updates (human comments) + item_activities
-- (append-only audit log written ONLY by triggers). Mirrors Phase-2 RLS:
-- denormalized org_id, is_org_member() reads, *_in_org() write guards, and
-- SECURITY DEFINER trigger fns with set search_path = ''.

-- ── Updates ──────────────────────────────────────────────────────────────
create table public.item_updates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  author_id  uuid not null references auth.users (id),
  body       jsonb not null,            -- { "text": string } in 4a (marks later)
  body_text  text not null default '',  -- denormalized plaintext (search / 4b mentions)
  edited_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index item_updates_item_id_idx  on public.item_updates (item_id, created_at desc);
create index item_updates_board_id_idx on public.item_updates (board_id);
create index item_updates_org_id_idx   on public.item_updates (org_id);

create trigger item_updates_set_updated_at
  before update on public.item_updates
  for each row execute function public.set_updated_at();

-- ── Activity log (append-only; never capped; only triggers insert) ─────────
create type public.activity_action as enum (
  'item_created', 'item_renamed', 'item_moved', 'item_deleted',
  'cell_changed', 'update_added'
);
create table public.item_activities (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  actor_id   uuid references auth.users (id),                     -- null = system
  action     public.activity_action not null,
  column_id  uuid references public.columns (id) on delete set null,
  old_value  jsonb,
  new_value  jsonb,
  created_at timestamptz not null default now()
);
create index item_activities_item_id_idx  on public.item_activities (item_id, created_at desc);
create index item_activities_board_id_idx on public.item_activities (board_id, created_at desc);
create index item_activities_org_id_idx   on public.item_activities (org_id);

-- ── Trigger fns (SECURITY DEFINER → bypass RLS to write the log) ───────────
create or replace function public.tg_log_item_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, new_value)
    values (new.org_id, new.board_id, new.id, (select auth.uid()), 'item_created',
            jsonb_build_object('name', new.name));
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.name is distinct from old.name) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, old_value, new_value)
      values (new.org_id, new.board_id, new.id, (select auth.uid()), 'item_renamed',
              to_jsonb(old.name), to_jsonb(new.name));
    end if;
    if (new.group_id is distinct from old.group_id) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, old_value, new_value)
      values (new.org_id, new.board_id, new.id, (select auth.uid()), 'item_moved',
              to_jsonb(old.group_id), to_jsonb(new.group_id));
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, old_value)
    values (old.org_id, old.board_id, old.id, (select auth.uid()), 'item_deleted',
            jsonb_build_object('name', old.name));
    return old;
  end if;
  return null;
end; $$;

create or replace function public.tg_log_cell_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, new_value)
    values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, new.value);
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.value is distinct from old.value) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value, new_value)
      values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, old.value, new.value);
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value)
    values (old.org_id, old.board_id, old.item_id, (select auth.uid()), 'cell_changed', old.column_id, old.value);
    return old;
  end if;
  return null;
end; $$;

create or replace function public.tg_log_update_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.item_activities (org_id, board_id, item_id, actor_id, action, new_value)
  values (new.org_id, new.board_id, new.item_id, new.author_id, 'update_added',
          jsonb_build_object('update_id', new.id));
  return new;
end; $$;

create trigger items_log_activity
  after insert or update or delete on public.items
  for each row execute function public.tg_log_item_activity();
create trigger cell_values_log_activity
  after insert or update or delete on public.cell_values
  for each row execute function public.tg_log_cell_activity();
create trigger item_updates_log_activity
  after insert on public.item_updates
  for each row execute function public.tg_log_update_activity();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.item_updates    enable row level security;
alter table public.item_activities enable row level security;

-- item_updates: read if member; author writes own; author-or-admin edit/delete.
create policy "item_updates: read if member" on public.item_updates
  for select to authenticated using (public.is_org_member(org_id));
create policy "item_updates: insert if member+author" on public.item_updates
  for insert to authenticated with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.item_in_org(item_id, org_id)
    and author_id = (select auth.uid())
  );
create policy "item_updates: update if author/admin" on public.item_updates
  for update to authenticated using (
    public.is_org_member(org_id)
    and (author_id = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  ) with check (public.is_org_member(org_id));
create policy "item_updates: delete if author/admin" on public.item_updates
  for delete to authenticated using (
    public.is_org_member(org_id)
    and (author_id = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  );

-- item_activities: read-only to members. NO insert/update/delete policy →
-- clients can never write; only the SECURITY DEFINER triggers above can.
create policy "item_activities: read if member" on public.item_activities
  for select to authenticated using (public.is_org_member(org_id));

-- ── Grants — RLS is the boundary. Activities: select only. ──────────────────
grant select, insert, update, delete on public.item_updates to authenticated;
grant select on public.item_activities to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.item_updates;
alter publication supabase_realtime add table public.item_activities;
