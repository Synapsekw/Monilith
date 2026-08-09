-- 20260809164720_report_builder_v2_rollups_templates.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Report Builder v2 — a report stops being exactly one board.
--
--   1. `reports.board_id` becomes NULLABLE and demotes to a *home board* pointer:
--      it still routes /boards/<id>/reports and keeps the single-board fast path,
--      but it is no longer the source of truth for membership.
--   2. New `report_boards` join table IS that source of truth, and is backfilled
--      for every existing report so no read path needs a board_id fallback.
--   3. New `reports.scope` names the binding explicitly
--      ('board' | 'boards' | 'portfolio' | 'template') with a check constraint that
--      makes an inconsistent row unrepresentable, plus `reports.portfolio_id` for
--      portfolio-bound roll-ups that auto-follow the portfolio's boards.
--   4. 'template' rows are the org report-template gallery: config only, no boards.
--
--   RLS stays the house pattern for board-derived tables: org-scoped in the
--   database, board-level (owner/editor/viewer) refinement in the action layer
--   (src/lib/reports/access.ts). Writes gain cross-org confinement conjuncts so a
--   report in org A can never reference a board or portfolio in org B
--   (mirrors 20260709090000_write_confinement_cross_org_guards.sql).

-- ── Parent-org-consistency helper ────────────────────────────────────────────
-- Mirrors board_in_org / portfolio_in_org (SECURITY DEFINER: bypasses RLS so the
-- policy cannot recurse; stable; empty search_path).
create or replace function public.report_in_org(p_report_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.reports where id = p_report_id and org_id = p_org_id);
$$;
revoke execute on function public.report_in_org(uuid, uuid) from public, anon;
grant execute on function public.report_in_org(uuid, uuid) to authenticated;

comment on function public.report_in_org(uuid, uuid) is
  'True when the report belongs to the given org. Write-confinement helper for report_boards policies.';

-- ── 1. reports: nullable home board, explicit scope, portfolio binding ───────
alter table public.reports alter column board_id drop not null;

alter table public.reports
  add column if not exists scope text not null default 'board',
  add column if not exists portfolio_id uuid references public.portfolios (id) on delete set null;

-- Separate from the add so a re-run does not stack duplicate constraints.
alter table public.reports drop constraint if exists reports_scope_ck;
alter table public.reports add constraint reports_scope_ck
  check (scope in ('board', 'boards', 'portfolio', 'template'));

-- The binding columns must agree with the scope, or a read path has to guess.
alter table public.reports drop constraint if exists reports_scope_binding_ck;
alter table public.reports add constraint reports_scope_binding_ck check (
  (scope = 'board'     and board_id is not null and portfolio_id is null)
  or (scope = 'boards'     and board_id is null     and portfolio_id is null)
  or (scope = 'portfolio'  and board_id is null     and portfolio_id is not null)
  or (scope = 'template'   and board_id is null     and portfolio_id is null)
);

comment on column public.reports.board_id is
  'Home board for scope=''board'' reports — routing + the single-board fast path. NULL for roll-ups and templates; report_boards is the source of truth for membership.';
comment on column public.reports.scope is
  'board = one home board · boards = explicit report_boards set · portfolio = auto-follows portfolio_boards · template = org gallery entry, no boards.';

-- The /reports index lists an org newest-first; the gallery filters on scope.
create index if not exists reports_org_updated_idx on public.reports (org_id, updated_at desc);
create index if not exists reports_org_scope_idx on public.reports (org_id, scope);
-- Advisor: unindexed foreign key.
create index if not exists reports_portfolio_id_idx on public.reports (portfolio_id)
  where portfolio_id is not null;

-- ── 2. report_boards — canonical membership ─────────────────────────────────
create table if not exists public.report_boards (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  report_id  uuid not null references public.reports (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  unique (report_id, board_id)
);

create index if not exists report_boards_report_id_idx on public.report_boards (report_id);
create index if not exists report_boards_board_id_idx on public.report_boards (board_id);
create index if not exists report_boards_org_id_idx on public.report_boards (org_id);

comment on table public.report_boards is
  'Boards a report renders. Populated for scope=''board'' (one row) and scope=''boards'' (N rows). scope=''portfolio'' resolves through portfolio_boards instead; scope=''template'' has none.';

-- ── 3. Backfill every existing report into the join table ───────────────────
-- Every pre-v2 report is single-board, so membership is exactly its board_id.
-- Running this before the new read paths ship means no reader needs a fallback.
insert into public.report_boards (org_id, report_id, board_id, position)
select r.org_id, r.id, r.board_id, 0
from public.reports r
where r.board_id is not null
on conflict (report_id, board_id) do nothing;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
alter table public.report_boards enable row level security;

-- Read: org-scoped, set-based (the 20260702120000 perf form). Board-level
-- refinement is enforced in the action layer, same as reports itself.
create policy "report_boards_select_member" on public.report_boards
  for select to authenticated
  using (org_id in (select public.auth_user_orgs()));

-- Writes: org member AND both parents pinned to the SAME org, so a membership
-- row can never straddle two tenants.
create policy "report_boards_insert_member" on public.report_boards
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.report_in_org(report_id, org_id)
    and public.board_in_org(board_id, org_id)
  );

create policy "report_boards_update_member" on public.report_boards
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and public.report_in_org(report_id, org_id)
    and public.board_in_org(board_id, org_id)
  );

create policy "report_boards_delete_member" on public.report_boards
  for delete to authenticated
  using (public.is_org_member(org_id));

-- ── 5. reports write policies gain the same confinement ─────────────────────
-- board_id/portfolio_id are now nullable and portfolio_id is new, so both write
-- policies must pin whichever parent is present to the report's own org.
drop policy if exists "reports_insert_member" on public.reports;
create policy "reports_insert_member" on public.reports
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and (board_id is null or public.board_in_org(board_id, org_id))
    and (portfolio_id is null or public.portfolio_in_org(portfolio_id, org_id))
  );

drop policy if exists "reports_update_member" on public.reports;
create policy "reports_update_member" on public.reports
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and (board_id is null or public.board_in_org(board_id, org_id))
    and (portfolio_id is null or public.portfolio_in_org(portfolio_id, org_id))
  );
