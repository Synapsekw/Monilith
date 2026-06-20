-- Phase 6c: time tracking sessions. One row per logged session; a running
-- timer is a row with ended_at IS NULL. Org-scoped RLS mirrors attachments.
create table public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  board_id      uuid not null references public.boards (id)        on delete cascade,
  item_id       uuid not null references public.items (id)         on delete cascade,
  column_id     uuid not null references public.columns (id)       on delete cascade,
  user_id       uuid not null references auth.users (id),
  started_at    timestamptz not null,
  ended_at      timestamptz,                 -- NULL ⇒ running timer
  duration_secs integer,                     -- set on stop / for manual entries; NULL while running
  created_at    timestamptz not null default now(),
  -- a completed entry has both ended_at and duration_secs; a running one has neither
  check ((ended_at is null) = (duration_secs is null)),
  check (duration_secs is null or duration_secs >= 0)
);

-- one running timer per user, ever (auto-stop relies on this)
create unique index time_entries_one_running_per_user
  on public.time_entries (user_id) where ended_at is null;

-- per-cell derivation + board-payload first-paint query
create index time_entries_item_column_idx on public.time_entries (item_id, column_id);
create index time_entries_board_idx       on public.time_entries (board_id);

alter table public.time_entries enable row level security;

-- read: any org member
create policy time_entries_select on public.time_entries
  for select to authenticated using (public.is_org_member(org_id));

-- insert: member, parent-consistent, self as user (manual entries go through here)
create policy time_entries_insert on public.time_entries
  for insert to authenticated with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.item_in_org(item_id, org_id)
    and user_id = (select auth.uid())
  );

-- update/delete: own rows only (v1; org-admin override deferred)
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (public.is_org_member(org_id) and user_id = (select auth.uid()))
  with check (public.is_org_member(org_id) and user_id = (select auth.uid()));

create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (public.is_org_member(org_id) and user_id = (select auth.uid()));

grant select, insert, update, delete on public.time_entries to authenticated;
-- NOTE: intentionally NOT added to supabase_realtime (v1 = optimistic + revalidate).

-- Atomic start: stop the caller's running timer (anywhere), then start a new one.
-- Returns the stopped row(s) + the new running row so the client cache reconciles both.
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
