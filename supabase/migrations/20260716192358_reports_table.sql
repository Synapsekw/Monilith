-- 20260716192358_reports_table.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds the reports table backing the per-board PDF Report Builder. Each row is a
--   saved report configuration (a config JSONB blob) scoped to an org + board.
--   Org-scoped RLS: any member of the owning org can read/write the board's reports;
--   board-level (owner/editor/viewer) refinement is enforced in the action layer.

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  board_id    uuid not null references public.boards (id) on delete cascade,
  name        text not null default 'Status Report',
  config      jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index reports_org_board_idx on public.reports (org_id, board_id);

alter table public.reports enable row level security;

-- Org-scoped: any member of the owning org can read/write the board's reports.
-- Board-level (owner/editor/viewer) refinement is enforced in the action layer.
create policy "reports_select_member" on public.reports
  for select using (public.is_org_member(org_id));
create policy "reports_insert_member" on public.reports
  for insert with check (public.is_org_member(org_id));
create policy "reports_update_member" on public.reports
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "reports_delete_member" on public.reports
  for delete using (public.is_org_member(org_id));
