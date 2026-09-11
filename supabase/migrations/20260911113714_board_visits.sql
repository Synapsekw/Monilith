-- 20260911113714_board_visits.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds board_visits — one row per (board, user) recording when that user
--   last had the board open — plus the upsert RPC the board client calls when
--   the tab is hidden or unmounted. Feeds the "changed since" chip of Board
--   Intelligence Phase 1 (docs/superpowers/specs/2026-09-11-board-intelligence-design.md §3.4).

create table public.board_visits (
  board_id     uuid not null references public.boards (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

comment on table public.board_visits is
  'When each user last had a board open. Own rows only; drives the "changed since" intelligence signal.';

alter table public.board_visits enable row level security;

-- Default-deny. Every verb is the caller's OWN row on a board the caller can
-- read — can_read_board is the existing org-membership + board-grant predicate,
-- so a row can never be read or written across orgs or for a board the user
-- has no access to.
create policy "board_visits: select own"
  on public.board_visits for select
  using (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_visits: insert own"
  on public.board_visits for insert
  with check (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_visits: update own"
  on public.board_visits for update
  using (user_id = (select auth.uid()) and public.can_read_board(board_id))
  with check (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_visits: delete own"
  on public.board_visits for delete
  using (user_id = (select auth.uid()));

-- Upsert helper: one round trip per visit. SECURITY INVOKER (the default) is
-- load-bearing — the insert runs under the caller's RLS, so a user who cannot
-- read the board cannot stamp a visit on it.
create or replace function public.touch_board_visit(p_board_id uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.board_visits (board_id, user_id, last_seen_at)
  values (p_board_id, (select auth.uid()), now())
  on conflict (board_id, user_id) do update
    set last_seen_at = now();
$$;

comment on function public.touch_board_visit (uuid) is
  'Upsert the calling user''s last_seen_at for a board. Security invoker: the insert is RLS-filtered.';

-- Postgres grants EXECUTE to PUBLIC on every new function, which anon inherits.
-- Lock it down in the same migration (the anon-reachability conformance probe
-- fails otherwise — see 20260909070508_board_view_prefs_execute_lockdown.sql).
revoke execute on function public.touch_board_visit (uuid) from public, anon;
grant execute on function public.touch_board_visit (uuid) to authenticated;
