-- Feedback: user-submitted bugs & feature requests, triaged by the platform admin.

create table public.feedback (
  id             uuid primary key default gen_random_uuid(),
  submitted_by   uuid not null references auth.users (id),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  kind           text not null check (kind in ('bug', 'feature_request')),
  title          text not null,
  body           text not null,
  status         text not null default 'new'
                   check (status in ('new','triaged','planned','in_progress','resolved','declined')),
  admin_response text,
  responded_by   uuid references auth.users (id),
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index feedback_status_created_idx on public.feedback (status, created_at desc);
create index feedback_submitter_created_idx on public.feedback (submitted_by, created_at desc);

alter table public.feedback enable row level security;

-- Submitter reads only their own rows; the platform admin reads all.
create policy feedback_select on public.feedback
  for select to authenticated
  using (submitted_by = (select auth.uid()) or public.is_platform_admin());

-- Any active org member may submit, self-authored, within their own org.
create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and public.is_org_member(org_id)
  );

-- Only the platform admin may change status / response.
create policy feedback_update on public.feedback
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy feedback_delete on public.feedback
  for delete to authenticated
  using (public.is_platform_admin());

-- Notifications: a new kind + a link column so the submitter is notified on triage.
alter type public.notification_kind add value if not exists 'feedback_response';

alter table public.notifications
  add column feedback_id uuid references public.feedback (id) on delete cascade;
