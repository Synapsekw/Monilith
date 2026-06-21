-- Board access: re-require active org membership, and fix INSERT ... RETURNING.
--
-- 20260620100000_board_level_sharing rewrote board reads to per-board visibility
-- via can_read_board / can_edit_board (creator OR board_members grant). In doing
-- so it dropped the is_org_member(org_id) gate the old "boards: read if member"
-- policy had. Two consequences:
--
--   1. Security regression: a DEACTIVATED org member who created a board or holds
--      a board_members grant kept read (and, with an editor grant, write) access
--      to that board and every board-scoped table that reads via
--      can_read_board(board_id) — items, columns, cell_values, board_views,
--      attachments, board_members. Deactivation no longer revoked board access.
--
--   2. INSERT ... RETURNING on boards broke. PostgreSQL applies the SELECT policy
--      to rows returned by RETURNING. The policy called can_read_board(id), a
--      STABLE function that re-selects boards by id; the brand-new row is not in
--      that function's snapshot, so it returned false and the insert was rejected
--      with "new row violates row-level security policy for table boards" even
--      though the INSERT WITH CHECK passed. (The app creates boards via SECURITY
--      DEFINER RPCs and never hit this, but a direct authenticated insert().select()
--      is a legitimate RLS-correct operation and must round-trip.)
--
-- Fix:
--   * Restore the active-membership gate inside can_read_board / can_edit_board so
--     deactivation revokes access across ALL board-scoped tables at once. These
--     are SECURITY DEFINER and read boards/org_members/board_members with RLS
--     bypassed, so no policy recursion.
--   * Rewrite the boards table's OWN select policy to avoid re-reading boards:
--     check is_org_member(org_id) and created_by directly (both are columns on the
--     row, so they evaluate correctly during RETURNING) plus is_board_member(id),
--     a SECURITY DEFINER helper that reads only board_members (never boards), which
--     both survives RETURNING and avoids the "infinite recursion detected in policy
--     for relation boards" loop that a plain board_members subquery would trigger
--     (board_members' own "owner manages" policy reads boards).
--   Semantics for active members are unchanged: creator OR shared can read; creator
--   OR editor-grant can edit.

-- Definer membership check on board_members only (no boards read, no recursion).
create or replace function public.is_board_member(p_board_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.board_members m
    where m.board_id = p_board_id and m.user_id = (select auth.uid())
  );
$$;
grant execute on function public.is_board_member(uuid) to authenticated;

-- Re-require active org membership for per-board read/edit (used by every
-- board-scoped table except boards' own select policy below).
create or replace function public.can_read_board(p_board_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id
      and public.is_org_member(b.org_id)
      and (
        b.created_by = (select auth.uid())
        or exists (
          select 1 from public.board_members m
          where m.board_id = b.id and m.user_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function public.can_edit_board(p_board_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id
      and public.is_org_member(b.org_id)
      and (
        b.created_by = (select auth.uid())
        or exists (
          select 1 from public.board_members m
          where m.board_id = b.id and m.user_id = (select auth.uid())
            and m.access_level = 'editor'
        )
      )
  );
$$;

-- boards' own select policy: row-column checks + definer board_members check, so
-- it both round-trips INSERT ... RETURNING and gates on active membership.
drop policy "boards: read if can read" on public.boards;
create policy "boards: read if can read" on public.boards
  for select to authenticated using (
    public.is_org_member(org_id)
    and (
      created_by = (select auth.uid())
      or public.is_board_member(id)
    )
  );
