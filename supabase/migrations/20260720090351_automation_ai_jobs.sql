-- 20260720090351_automation_ai_jobs.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Phase 10 · E5 · Task A1 — async-hop substrate):
--   Adds the `automation_ai_jobs` ledger that backs F13's "AI action step". When
--   `_automation_run` hits an `ai_step` action it cannot call a model inline (it
--   runs in the mutating transaction, synchronously, as a definer), so it INSERTs
--   a job row + fires a non-blocking `net.http_post` to a signed service endpoint
--   (mirrors the existing webhook path exactly). This table is the audit + the
--   idempotency ledger for that async hop (status pending -> done|skipped|error),
--   plus a minute cron that times out wedged jobs. RLS: read-only to org members;
--   NO client insert/update path (the engine + the service endpoint own writes).

create table public.automation_ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id) on delete cascade,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  board_id      uuid not null references public.boards (id) on delete cascade,
  item_id       uuid references public.items (id) on delete set null,
  config        jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending','done','skipped','error')),
  error         text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- Sweep index for the reconcile cron (partial: only the rows it scans).
create index automation_ai_jobs_pending_idx on public.automation_ai_jobs (created_at) where status = 'pending';
-- Org-scoped recency lookup for audit surfaces.
create index automation_ai_jobs_org_idx on public.automation_ai_jobs (org_id, created_at desc);

alter table public.automation_ai_jobs enable row level security;
-- Read-only to org members; NO client insert/update (engine + service endpoint
-- only — the AI never gets a raw write path). is_member_of(p_user, p_org_id):
-- user first, org second (20260617102000_notifications_insert_org_integrity).
create policy automation_ai_jobs_select on public.automation_ai_jobs
  for select to authenticated
  using (public.is_member_of((select auth.uid()), org_id));

-- Timeout reconcile: a job pending > 10 min is marked error so nothing wedges
-- (same discipline as automation_webhook_deliveries' minute reconcile).
create or replace function public._automation_ai_reconcile() returns void
language sql security definer set search_path = '' as $$
  update public.automation_ai_jobs
     set status = 'error', error = 'timeout', resolved_at = now()
   where status = 'pending' and created_at < now() - interval '10 minutes';
$$;
revoke execute on function public._automation_ai_reconcile() from public, anon, authenticated;

-- cron.schedule upserts by job name => this migration stays re-runnable.
select cron.schedule('automation-ai-reconcile', '* * * * *',
  $cron$ select public._automation_ai_reconcile() $cron$);
