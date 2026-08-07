-- An invitation names exactly one recipient, but until now only org admins
-- could read org_invitations — invitees reached theirs solely through the
-- SECURITY DEFINER RPC my_pending_invitations. That left no way to PUSH an
-- invite: Realtime evaluates RLS per subscriber, so with no SELECT policy the
-- recipient is never sent the row, and an invite surfaced only on their next
-- full page load. Policies are permissive, so this widens the invitee's read
-- without touching the three existing admin policies.
create policy "org_invitations: read own by email"
  on public.org_invitations
  for select
  to authenticated
  using (lower(email) = lower((select auth.jwt() ->> 'email')));

-- Deliver INSERT (invite sent) and UPDATE (revoked/accepted/declined) to the
-- recipient. Every status transition in the app is an UPDATE, never a DELETE
-- (revokeInvite sets status='revoked'; accept_invitation / decline_invitation
-- set 'accepted' / 'declined'), so default replica identity is sufficient and
-- no DELETE payload is ever emitted.
alter publication supabase_realtime add table public.org_invitations;
