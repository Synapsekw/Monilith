-- Realtime Authorization for the board presence channel.
-- Channel topic is `presence:board:<board_uuid>`; only users who can read the
-- board may receive (SELECT) or publish (INSERT) presence on it.
-- Reuses the existing can_read_board() SECURITY DEFINER function so presence
-- access == data-read access (one security boundary, org-scoped, no cross-tenant).
--
-- PREREQUISITE (manual, not SQL): Realtime "Allow public access" must be OFF for
-- the project (dashboard → Realtime settings) or private channels are not enforced.
-- Proven by the non-member-denied integration test in this phase.
--
-- RLS is already enabled on realtime.messages by default — do NOT enable it here.
-- extension is gated on both 'presence' AND 'broadcast' (supabase-js Presence rides
-- the broadcast transport). (select ...) wraps the helpers for RLS initplan caching.

-- Receive presence on a board presence topic.
create policy "presence: read if can read board"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'presence:board:%'
    and (
      select public.can_read_board(
        (split_part((select realtime.topic()), ':', 3))::uuid
      )
    )
  );

-- Publish (track) presence on a board presence topic.
create policy "presence: write if can read board"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'presence:board:%'
    and (
      select public.can_read_board(
        (split_part((select realtime.topic()), ':', 3))::uuid
      )
    )
  );
