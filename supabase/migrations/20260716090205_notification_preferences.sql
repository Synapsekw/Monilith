-- 20260716090205_notification_preferences.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- Notification preferences: per-user, per-kind, per-channel opt-out.
-- Opt-out model: a row exists ONLY to record a DISABLED preference; absence =
-- enabled. Zero backfill => existing users keep current behavior.

create type public.notification_channel as enum ('in_app', 'email');

create table public.notification_preferences (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       public.notification_kind    not null,
  channel    public.notification_channel not null,
  enabled    boolean not null default false check (enabled = false),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, channel)
);

comment on table public.notification_preferences is
  'Opt-out only: a row means the (kind, channel) is DISABLED for user_id. No row = enabled.';

alter table public.notification_preferences enable row level security;

create policy "notif prefs: read own" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notif prefs: write own" on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.notification_preferences to authenticated;

-- In-app gating choke point: skip the notification row when the recipient has a
-- disabled (kind, 'in_app') preference. SECURITY DEFINER so it can read the
-- RECIPIENT's prefs (the actor inserting is a different user). Covers every
-- insert path incl. the service-client digest/feedback fan-outs.
create or replace function public.gate_notification_by_pref()
returns trigger language plpgsql security definer stable
set search_path = '' as $$
begin
  if exists (
    select 1 from public.notification_preferences p
    where p.user_id = new.recipient_id
      and p.kind    = new.kind
      and p.channel = 'in_app'
  ) then
    return null;  -- opted out: skip this row
  end if;
  return new;
end;
$$;

create trigger gate_notification_by_pref
  before insert on public.notifications
  for each row execute function public.gate_notification_by_pref();
