-- Security hardening: close four cross-tenant WRITE-confinement gaps — the
-- same class already fixed for relation_links in 20260704113000_relation_links
-- _cross_org_guard.sql. Each table's INSERT/UPDATE gate never confined org_id
-- and/or FK parents to the caller's org, so an org-A user could inject rows
-- that carry org_id = org B (visible to org B via the org-scoped read policy)
-- or FKs pointing at org B's rows — cross-tenant POLLUTION (read paths
-- re-gate, so no exfiltration). Fix pattern (cell_values-style): add
-- *_in_org(<fk>, org_id) conjuncts and pin org_id to the parent row's org.
--
-- NOTE on policy provenance: 20260702120000_perf_set_based_rls_and_indexes.sql
-- only rewrote the SELECT ("read if member") policies of these tables; the
-- write policies below are still the originals from 20260621071929_portfolios
-- .sql, 20260621160000_goals.sql, 20260622160000_workload.sql and
-- 20260623123519_time_allocations.sql — recreate those with the added
-- conjuncts. Legitimate writes are unaffected: the app's SECURITY DEFINER
-- RPCs (add_portfolio_board, set_goal_links) already derive org_id from the
-- parent row, and direct same-org writes satisfy every new conjunct.

-- ── Parent-org-consistency helpers ───────────────────────────────────────────
-- portfolios/goals had no *_in_org helper; mirror board_in_org/item_in_org
-- from 20260615061747_boards_core.sql (SECURITY DEFINER: bypass RLS, no
-- recursion; stable; empty search_path).
create or replace function public.portfolio_in_org(p_portfolio_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.portfolios where id = p_portfolio_id and org_id = p_org_id);
$$;
revoke execute on function public.portfolio_in_org(uuid, uuid) from public, anon;
grant execute on function public.portfolio_in_org(uuid, uuid) to authenticated;

create or replace function public.goal_in_org(p_goal_id uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.goals where id = p_goal_id and org_id = p_org_id);
$$;
revoke execute on function public.goal_in_org(uuid, uuid) from public, anon;
grant execute on function public.goal_in_org(uuid, uuid) to authenticated;

-- ── 1) portfolio_boards ──────────────────────────────────────────────────────
-- Was: WITH CHECK (can_edit_portfolio(portfolio_id)) — org_id and board_id
-- unvalidated, so an editor of their OWN portfolio could stamp the row with
-- another org's org_id and/or point board_id at another org's board.
-- Now: pin org_id to the parent portfolio's org, and confine board_id (and
-- the nullable done_column_id — same-class cross-org FK) to that org.
drop policy if exists "portfolio_boards: insert if editor" on public.portfolio_boards;
create policy "portfolio_boards: insert if editor" on public.portfolio_boards
  for insert with check (
    public.can_edit_portfolio(portfolio_id)
    and public.portfolio_in_org(portfolio_id, org_id)
    and public.board_in_org(board_id, org_id)
    and (done_column_id is null or public.column_in_org(done_column_id, org_id))
  );

drop policy if exists "portfolio_boards: update if editor" on public.portfolio_boards;
create policy "portfolio_boards: update if editor" on public.portfolio_boards
  for update using (public.can_edit_portfolio(portfolio_id))
  with check (
    public.can_edit_portfolio(portfolio_id)
    and public.portfolio_in_org(portfolio_id, org_id)
    and public.board_in_org(board_id, org_id)
    and (done_column_id is null or public.column_in_org(done_column_id, org_id))
  );

-- ── 2) goal_links ────────────────────────────────────────────────────────────
-- Was: FOR ALL USING/WITH CHECK (can_edit_goal(goal_id)) — same gap, same fix.
drop policy if exists "goal_links: write if editor" on public.goal_links;
create policy "goal_links: write if editor" on public.goal_links
  for all using (public.can_edit_goal(goal_id))
  with check (
    public.can_edit_goal(goal_id)
    and public.goal_in_org(goal_id, org_id)
    and public.board_in_org(board_id, org_id)
    and (done_column_id is null or public.column_in_org(done_column_id, org_id))
  );

-- ── 3) member_capacity ───────────────────────────────────────────────────────
-- Helper gap: can_edit_member_capacity(org_id, user_id) returned true for ANY
-- authenticated user whenever user_id = auth.uid(), with no membership check
-- on org_id — so any user could write capacity rows into an arbitrary org.
-- Add is_org_member(p_org_id) to the self branch. The org owner/admin branch
-- (has_org_role) already implies caller membership in p_org_id and is kept
-- as-is so admins can still manage other members' capacity. CREATE OR REPLACE
-- only — the existing policies reference this helper and stay unchanged, and
-- execute grants (incl. the 20260704114000 public/anon revoke) persist.
create or replace function public.can_edit_member_capacity(p_org_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select (
    (p_user_id = (select auth.uid()) and public.is_org_member(p_org_id))
    or public.has_org_role(p_org_id, array['owner', 'admin']::public.org_role[])
  );
$$;

-- ── 4) time_allocations ──────────────────────────────────────────────────────
-- Was: WITH CHECK (is_org_member(org_id) and user_id = auth.uid()) — org_id is
-- confined to the caller's own org, but the nullable item_id/board_id FKs
-- could reference another org's rows. Confine both (null-safe: category rows
-- carry neither). The delete policy has no WITH CHECK and is left as-is.
drop policy if exists "time_allocations: insert self" on public.time_allocations;
create policy "time_allocations: insert self" on public.time_allocations
  for insert to authenticated with check (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
    and (board_id is null or public.board_in_org(board_id, org_id))
    and (item_id is null or public.item_in_org(item_id, org_id))
  );

drop policy if exists "time_allocations: update self" on public.time_allocations;
create policy "time_allocations: update self" on public.time_allocations
  for update to authenticated
  using (public.is_org_member(org_id) and user_id = (select auth.uid()))
  with check (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
    and (board_id is null or public.board_in_org(board_id, org_id))
    and (item_id is null or public.item_in_org(item_id, org_id))
  );
