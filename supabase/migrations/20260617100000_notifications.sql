-- Phase 4b: per-user notification fan-out rows. RLS: you only see/modify your
-- own (recipient_id = auth.uid()); any org member may insert as themselves
-- (the fan-out path in addUpdate / upsertCell).
create type public.notification_kind as enum ('mention', 'assigned', 'update_on_item');

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  actor_id     uuid references auth.users (id),
  kind         public.notification_kind not null,
  board_id     uuid references public.boards (id) on delete cascade,
  item_id      uuid references public.items (id) on delete cascade,
  update_id    uuid references public.item_updates (id) on delete cascade,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;
create index notifications_org_id_idx on public.notifications (org_id);

alter table public.notifications enable row level security;

create policy "notifications: read own" on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));
create policy "notifications: insert as member+actor" on public.notifications
  for insert to authenticated with check (
    public.is_org_member(org_id) and actor_id = (select auth.uid())
  );
create policy "notifications: update own" on public.notifications
  for update to authenticated using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

grant select, insert, update on public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications;
