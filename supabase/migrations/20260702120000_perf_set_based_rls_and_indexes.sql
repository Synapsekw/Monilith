-- Performance: set-based RLS read policies + missing hot-path indexes.
--
-- WHAT THIS DOES
--   1. Adds pg_trgm + a GIN trigram index on items.name so the leading-wildcard
--      ilike '%term%' searches (cross-board item pickers) stop full-seq-scanning.
--   2. Introduces a set-returning read helper, public.readable_board_ids(), that
--      reproduces can_read_board()'s CURRENT semantics EXACTLY, and rewrites every
--      per-row SELECT policy that called can_read_board(board_id) into a semijoin
--      `board_id in (select public.readable_board_ids())`. Postgres evaluates the
--      subquery ONCE as a hashed InitPlan instead of invoking the STABLE function
--      once per returned row (thousands of calls on a board payload -> 1 call).
--   3. Rewrites every per-row SELECT policy that called is_org_member(org_id) into
--      `org_id in (select public.auth_user_orgs())` — same InitPlan win. auth_user_orgs()
--      already exists (unused until now) and is exactly the set form of is_org_member().
--   4. Adds composite/partial indexes matching the board-payload and time-card
--      read shapes (board_id + position/created_at; user_id + started_at on
--      completed timers).
--
-- READ-SEMANTICS PRESERVING. This migration changes ONLY SELECT (read) visibility
-- policies, and each rewrite is provably equivalent to the predicate it replaces
-- (see the mapping block below). It does NOT touch INSERT/UPDATE/DELETE policies,
-- table grants, the scalar helpers (can_read_board/can_edit_board/is_org_member —
-- still used by write policies and realtime authorization), or the boards table's
-- own SELECT policy (which is deliberately inline so INSERT ... RETURNING round-trips).
--
-- MUST BE APPLIED MANUALLY by the maintainer via `supabase db push` (this repo does
-- not auto-apply migrations to the cloud).

-- ============================================================================
-- (a) Trigram extension + search index
-- ----------------------------------------------------------------------------
-- Supabase keeps relocatable extensions in the `extensions` schema (pgcrypto,
-- uuid-ossp, pg_stat_statements all live there); the DB search_path includes it.
-- The operator class is schema-qualified so it resolves regardless of search_path.
-- ============================================================================
create extension if not exists pg_trgm with schema extensions;

create index if not exists items_name_trgm_idx
  on public.items using gin (name extensions.gin_trgm_ops);

-- ============================================================================
-- (b) Set-returning read helper — exact set form of can_read_board()
-- ----------------------------------------------------------------------------
-- can_read_board(id) (as of 20260621000000) is TRUE iff the board exists AND the
-- caller is an active org member of the board's org AND (caller created the board
-- OR caller holds a board_members grant). readable_board_ids() returns exactly the
-- set of ids for which that holds — same three conjuncts, same (select auth.uid())
-- idiom, same SECURITY DEFINER / search_path='' so RLS is bypassed with no recursion.
-- ============================================================================
create or replace function public.readable_board_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select b.id
  from public.boards b
  where public.is_org_member(b.org_id)
    and (
      b.created_by = (select auth.uid())
      or exists (
        select 1 from public.board_members m
        where m.board_id = b.id and m.user_id = (select auth.uid())
      )
    );
$$;

-- Match the locked-down grant posture of the other RLS helpers (authenticated +
-- service_role only; no PUBLIC, no anon).
revoke execute on function public.readable_board_ids() from public;
grant execute on function public.readable_board_ids() to authenticated, service_role;

-- ============================================================================
-- (c) Rewrite SELECT policies to semijoins
-- ----------------------------------------------------------------------------
-- SEMANTICS MAPPING (old per-row predicate  ->  new set-based predicate):
--
--   Board-scoped (14 policies), role = authenticated, unchanged predicate meaning:
--     using (can_read_board(board_id))
--       ->  using (board_id in (select public.readable_board_ids()))
--     Equivalent because id ∈ readable_board_ids()  <=>  can_read_board(id) is true,
--     and for a NULL/absent board_id both forms yield false.
--       attachments.attachments_select
--       automation_runs."automation_runs: read if can read"
--       automations."automations: read if can read"
--       board_members."board_members: read if can read board"
--       board_views."board_views: read if can read"
--       cell_values."cell_values: read if can read"
--       columns."columns: read if can read"
--       groups."groups: read if can read"
--       item_activities."item_activities: read if can read"
--       item_dependencies."item_dependencies: read if can read"
--       item_updates."item_updates: read if can read"
--       items."items: read if can read"
--       relation_links."relation_links: read if can read board"
--       time_entries.time_entries_select
--
--   Org-scoped (12 policies), roles preserved exactly (authenticated OR public):
--     using (is_org_member(org_id))
--       ->  using (org_id in (select public.auth_user_orgs()))
--     Equivalent because auth_user_orgs() = {org_id : is_org_member(org_id)} for the
--     caller; both helpers read org_members with RLS bypassed and share identical
--     EXECUTE grants, so the swap changes neither visibility nor callability.
--       organizations."organizations: read if member"      (col: id)    [authenticated]
--       org_members."org_members: read if member"                       [authenticated]
--       time_allocations."time_allocations: read if member"            [authenticated]
--       workspaces."workspaces: read if member"                        [authenticated]
--       dashboards."dashboards: read if member"                        [public]
--       dashboard_widgets."dashboard_widgets: read if member"          [public]
--       goals."goals: read if member"                                  [public]
--       goal_links."goal_links: read if member"                        [public]
--       member_capacity."member_capacity: read if member"             [public]
--       org_workload_settings."org_workload_settings: read if member" [public]
--       portfolios."portfolios: read if member"                        [public]
--       portfolio_boards."portfolio_boards: read if member"           [public]
--
--   NOT TOUCHED: boards."boards: read if can read" (inline, RETURNING-safe);
--   automation_date_fires / automation_webhook_deliveries read policies (they call
--   can_read_board over a correlated subquery, not a plain board_id column — left
--   as-is to avoid altering their NULL semantics); all INSERT/UPDATE/DELETE policies.
-- ============================================================================

-- ── board-scoped: can_read_board(board_id) -> semijoin ──────────────────────
drop policy "attachments_select" on public.attachments;
create policy "attachments_select" on public.attachments
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "automation_runs: read if can read" on public.automation_runs;
create policy "automation_runs: read if can read" on public.automation_runs
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "automations: read if can read" on public.automations;
create policy "automations: read if can read" on public.automations
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "board_members: read if can read board" on public.board_members;
create policy "board_members: read if can read board" on public.board_members
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "board_views: read if can read" on public.board_views;
create policy "board_views: read if can read" on public.board_views
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "cell_values: read if can read" on public.cell_values;
create policy "cell_values: read if can read" on public.cell_values
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "columns: read if can read" on public.columns;
create policy "columns: read if can read" on public.columns
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "groups: read if can read" on public.groups;
create policy "groups: read if can read" on public.groups
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "item_activities: read if can read" on public.item_activities;
create policy "item_activities: read if can read" on public.item_activities
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "item_dependencies: read if can read" on public.item_dependencies;
create policy "item_dependencies: read if can read" on public.item_dependencies
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "item_updates: read if can read" on public.item_updates;
create policy "item_updates: read if can read" on public.item_updates
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "items: read if can read" on public.items;
create policy "items: read if can read" on public.items
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "relation_links: read if can read board" on public.relation_links;
create policy "relation_links: read if can read board" on public.relation_links
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

drop policy "time_entries_select" on public.time_entries;
create policy "time_entries_select" on public.time_entries
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));

-- ── org-scoped (authenticated role): is_org_member(org_id) -> semijoin ──────
drop policy "organizations: read if member" on public.organizations;
create policy "organizations: read if member" on public.organizations
  for select to authenticated
  using (id in (select public.auth_user_orgs()));

drop policy "org_members: read if member" on public.org_members;
create policy "org_members: read if member" on public.org_members
  for select to authenticated
  using (org_id in (select public.auth_user_orgs()));

drop policy "time_allocations: read if member" on public.time_allocations;
create policy "time_allocations: read if member" on public.time_allocations
  for select to authenticated
  using (org_id in (select public.auth_user_orgs()));

drop policy "workspaces: read if member" on public.workspaces;
create policy "workspaces: read if member" on public.workspaces
  for select to authenticated
  using (org_id in (select public.auth_user_orgs()));

-- ── org-scoped (PUBLIC role — no TO clause, preserved from original): ───────
drop policy "dashboards: read if member" on public.dashboards;
create policy "dashboards: read if member" on public.dashboards
  for select
  using (org_id in (select public.auth_user_orgs()));

drop policy "dashboard_widgets: read if member" on public.dashboard_widgets;
create policy "dashboard_widgets: read if member" on public.dashboard_widgets
  for select
  using (org_id in (select public.auth_user_orgs()));

drop policy "goals: read if member" on public.goals;
create policy "goals: read if member" on public.goals
  for select
  using (org_id in (select public.auth_user_orgs()));

drop policy "goal_links: read if member" on public.goal_links;
create policy "goal_links: read if member" on public.goal_links
  for select
  using (org_id in (select public.auth_user_orgs()));

drop policy "member_capacity: read if member" on public.member_capacity;
create policy "member_capacity: read if member" on public.member_capacity
  for select
  using (org_id in (select public.auth_user_orgs()));

drop policy "org_workload_settings: read if member" on public.org_workload_settings;
create policy "org_workload_settings: read if member" on public.org_workload_settings
  for select
  using (org_id in (select public.auth_user_orgs()));

drop policy "portfolios: read if member" on public.portfolios;
create policy "portfolios: read if member" on public.portfolios
  for select
  using (org_id in (select public.auth_user_orgs()));

drop policy "portfolio_boards: read if member" on public.portfolio_boards;
create policy "portfolio_boards: read if member" on public.portfolio_boards
  for select
  using (org_id in (select public.auth_user_orgs()));

-- ============================================================================
-- (d) Composite / partial indexes for hot-path board-payload + time-card reads
-- ----------------------------------------------------------------------------
-- Board payload reads filter board_id then order by position/created_at ... limit,
-- but only single-column (board_id) indexes existed. The time-card completed-timer
-- read filters user_id + started_at range + ended_at is not null, which the only
-- user_id index (partial on ended_at IS NULL) could not serve.
-- ============================================================================
create index if not exists items_board_position_idx
  on public.items (board_id, position);

create index if not exists attachments_board_created_idx
  on public.attachments (board_id, created_at desc);

create index if not exists time_entries_board_created_idx
  on public.time_entries (board_id, created_at desc);

create index if not exists relation_links_board_position_idx
  on public.relation_links (board_id, position);

create index if not exists time_entries_user_started_idx
  on public.time_entries (user_id, started_at)
  where ended_at is not null;
