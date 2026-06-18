-- Phase 5a: automations storage + RLS. Per-board When/Then rules evaluated by an
-- in-DB trigger (see the engine migration). trigger/actions are jsonb (validated
-- by Zod at the Server Action boundary), mirroring columns.settings. RLS + the
-- board_in_org write-guard mirror public.columns exactly.
create table public.automations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  board_id    uuid not null references public.boards (id) on delete cascade,
  name        text,
  enabled     boolean not null default true,
  trigger     jsonb not null,
  actions     jsonb not null default '[]'::jsonb,
  created_by  uuid references auth.users (id),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index automations_board_idx on public.automations (board_id, position);
create index automations_org_idx on public.automations (org_id);
create index automations_trigger_col_idx
  on public.automations (board_id, (trigger->>'columnId')) where enabled;

create trigger automations_set_updated_at
  before update on public.automations
  for each row execute function public.set_updated_at();

alter table public.automations enable row level security;

create policy "automations: read if member" on public.automations
  for select to authenticated using (public.is_org_member(org_id));
create policy "automations: insert if member" on public.automations
  for insert to authenticated
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "automations: update if member" on public.automations
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "automations: delete if member" on public.automations
  for delete to authenticated using (public.is_org_member(org_id));

grant select, insert, update, delete on public.automations to authenticated;

-- notifications: new kind + optional rule reference for inbox labelling.
-- (ADD VALUE is safe here: we do not USE the new value in DML in this migration.)
alter type public.notification_kind add value if not exists 'automation';
alter table public.notifications
  add column automation_id uuid references public.automations (id) on delete set null;
