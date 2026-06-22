-- Realtime Authorization for the board presence channel.
-- Channel topic is `presence:board:<board_uuid>`; only users who can read the
-- board may receive (SELECT) or publish (INSERT) presence on it.
-- Reuses the existing can_read_board() SECURITY DEFINER function so presence
-- access == data-read access (one security boundary, org-scoped, no cross-tenant).
--
-- NO global project setting needed. A channel created with `private: true` is
-- ALWAYS authorized against these realtime.messages policies, independent of the
-- "Channel Restrictions / Allow public access" toggle. We deliberately LEAVE that
-- toggle on "allow public" so the app's existing PUBLIC channels (board:<id>,
-- notifications:<id>, item:<id> for postgres_changes) keep working untouched —
-- switching the project to "private only" would break those (they have no policies).
-- The non-member-denied integration test proves enforcement with the toggle left on.
-- (A same-named *public* presence:board:<id> channel is a separate channel and never
-- receives this private channel's traffic, so there is no bypass leak.)
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
