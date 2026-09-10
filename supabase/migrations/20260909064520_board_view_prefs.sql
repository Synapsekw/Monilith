-- 20260909064520_board_view_prefs.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds per-user, per-board view arrangement (collapsed groups, expanded
--   sub-item rows, last active view, last filter/sort) plus the upsert RPC the
--   board page's debounced writer calls.

-- Per-user, per-board view arrangement: which groups are collapsed, which
-- sub-item rows are expanded, the last active view, and the last filter/sort.
--
-- One row per (user, board). The primary key is the only index the feature
-- needs: every read is a point lookup on it and every write is an upsert on it.
--
-- `state` is a jsonb blob whose shape is owned by app code (Zod, see
-- src/lib/validations/view-prefs.ts) so adding a remembered field needs no
-- migration. The DB only bounds the row's existence and its tenancy.
--
-- org_id is denormalised from the board so the write policy can assert org
-- membership without a join, and so the row dies with the org.
create table public.board_view_prefs (
  user_id    uuid not null references auth.users (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  org_id     uuid not null references public.organizations (id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

comment on table public.board_view_prefs is
  'Per-user, per-board view arrangement (collapsed groups, expanded rows, active view, filter). Never shared between users.';

alter table public.board_view_prefs enable row level security;

-- Default-deny. Every policy is scoped to the caller's own row; there is no
-- policy under which one user can see or write another user's arrangement.
-- Writes additionally require live org membership.
create policy "board_view_prefs: select own"
  on public.board_view_prefs for select
  using (user_id = (select auth.uid()));

create policy "board_view_prefs: insert own"
  on public.board_view_prefs for insert
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));

create policy "board_view_prefs: update own"
  on public.board_view_prefs for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));

create policy "board_view_prefs: delete own"
  on public.board_view_prefs for delete
  using (user_id = (select auth.uid()));

-- Upsert helper. Resolves org_id from the board in SQL so the write costs one
-- round trip instead of a read-then-write. SECURITY INVOKER (the default) is
-- load-bearing: the board lookup runs under the caller's RLS, so a user who
-- cannot see the board cannot create a prefs row for it.
create or replace function public.save_board_view_prefs(
  p_board_id uuid,
  p_state jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select b.org_id into v_org_id from public.boards b where b.id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found';
  end if;

  insert into public.board_view_prefs (user_id, board_id, org_id, state, updated_at)
  values ((select auth.uid()), p_board_id, v_org_id, p_state, now())
  on conflict (user_id, board_id) do update
    set state = excluded.state,
        updated_at = now();
end;
$$;

comment on function public.save_board_view_prefs (uuid, jsonb) is
  'Upsert the calling user''s view arrangement for a board. Security invoker: the board lookup is RLS-filtered.';
