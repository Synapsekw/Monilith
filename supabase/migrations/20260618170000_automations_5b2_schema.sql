-- Phase 5b-2: schema for date-based automation triggers.

-- (a) Org timezone (IANA name). Default UTC; existing rows backfill via the default.
alter table public.organizations
  add column if not exists timezone text not null default 'UTC';

-- Timezone validity is enforced at the app boundary (Zod isValidTimeZone) — a CHECK
-- constraint cannot hold the required subquery against pg_timezone_names, and the sweep
-- (20260618170001) is defensive per-org so a bad value can never abort the whole run.

-- Allow org owners/admins to update their org (e.g. timezone). Reuses has_org_role.
drop policy if exists "organizations: update if admin" on public.organizations;
create policy "organizations: update if admin"
  on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner','admin']::public.org_role[]));

-- (b) Once-only fire ledger. PK gives idempotency; rows written only by the sweep (definer).
create table if not exists public.automation_date_fires (
  automation_id uuid not null references public.automations (id) on delete cascade,
  item_id       uuid not null references public.items (id) on delete cascade,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  fire_date     date not null,
  fired_at      timestamptz not null default now(),
  primary key (automation_id, item_id, fire_date)
);

alter table public.automation_date_fires enable row level security;

-- Org-scoped read only (for a future 5c run-history). No client write policy:
-- inserts happen exclusively via the SECURITY DEFINER sweep.
drop policy if exists "date_fires: read if member" on public.automation_date_fires;
create policy "date_fires: read if member"
  on public.automation_date_fires for select to authenticated
  using (public.is_org_member(org_id));

-- (c) Indexes.
-- Partial index for the per-org date_reached rule lookup (mirrors the item_created index).
create index if not exists automations_date_reached_idx
  on public.automations (board_id)
  where enabled and (trigger ->> 'type') = 'date_reached';

-- Functional index so the per-rule date-cell match is indexed, not a scan.
create index if not exists cell_values_date_idx
  on public.cell_values (column_id, (value ->> 'date'));
