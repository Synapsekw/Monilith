-- Phase 4b hardening (final-review #1): tighten the notifications insert policy
-- to the org-integrity guards the spec mandates. The original policy only checked
-- is_org_member(org_id) + actor_id = auth.uid(), so a member could write a row
-- whose recipient/board/item pointed at users or rows outside the org (nuisance
-- inbox rows / dead deep-links). Add: recipient must be a member of org_id, and
-- board_id/item_id (when set) must belong to org_id. Recipient-gated reads already
-- limit blast radius; this closes the write surface + matches the Phase-2 pattern.

-- Membership check parameterized by user (the existing is_org_member only checks
-- auth.uid()). SECURITY DEFINER to bypass org_members RLS, like the sibling guards.
create or replace function public.is_member_of(p_user uuid, p_org_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.org_members
    where user_id = p_user and org_id = p_org_id
  );
$$;
grant execute on function public.is_member_of(uuid, uuid) to authenticated;

drop policy "notifications: insert as member+actor" on public.notifications;
create policy "notifications: insert as member+actor" on public.notifications
  for insert to authenticated with check (
    public.is_org_member(org_id)
    and actor_id = (select auth.uid())
    and public.is_member_of(recipient_id, org_id)
    and (board_id is null or public.board_in_org(board_id, org_id))
    and (item_id is null or public.item_in_org(item_id, org_id))
  );
