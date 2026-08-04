-- 20260804084303_seed_tier2_board_thread_fixtures.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Extends the permanent Tier-2 fixture corpus
--   (20260727094033_seed_tier2_tenant_fixtures.sql) with the rows that
--   src/lib/ai/ask/board-threads.fixtures.test.ts needs to prove the board-thread
--   RLS widening added by 20260804031458_board_threads.sql.
--
--   NO SCHEMA CHANGES. Data only. Purely ADDITIVE: it never updates or deletes
--   an existing row, and it does not touch the two pre-existing fixture threads —
--   the private one is the regression subject and must stay exactly as seeded.
--
-- WHY A THIRD PRINCIPAL EXISTS
--   `public.can_read_board()` requires ACTIVE ORG MEMBERSHIP *and*
--   creator-or-board-member. Fixture tenants A and B share no org, so neither can
--   ever satisfy it for the other's board — "a board member can read a shared
--   thread" is unprovable with two disjoint tenants. Fixture C ("gamma") is a
--   second, NON-OWNING active member of A's org, granted A's board. It owns
--   nothing and holds no elevated role.
--
-- WHY TWO BOARDS
--   `visibility = 'board'` must not degrade into `visibility = 'org'`. The second
--   Alpha board ("Alpha Off-Limits Board") is created by A and granted to nobody,
--   so gamma — same org, active, but not a board member and not the creator — is
--   the negative control that separates can_read_board()'s board check from its
--   org check.
--
-- WHY THIS IS SAFE TO CARRY TO PRODUCTION
--   It never creates an auth user. Every insert hangs off
--   `select id from auth.users where lower(email) = '<fixture address>'`, so where
--   those accounts do not exist — which is everywhere except DEV — the whole
--   migration is a clean no-op. The accounts themselves are created out-of-band,
--   DEV-only, by supabase/fixtures/tier2-fixture-users.dev-only.sql, which is
--   deliberately NOT in supabase/migrations/ so `supabase db push` can never
--   carry it.
--
-- IDEMPOTENT. Fixed UUIDs + `on conflict ... do nothing` throughout. The same
-- UUIDs are spelled in src/test/tenant-fixtures.ts; a unit test
-- (src/test/tenant-fixtures.test.ts) fails if the two ever drift.

do $$
declare
  v_user_a uuid;
  v_user_c uuid;
begin
  select id into v_user_a from auth.users
    where lower(email) = 'pulse-tier2-fixture-a@example.com';
  select id into v_user_c from auth.users
    where lower(email) = 'pulse-tier2-fixture-c@example.com';

  if v_user_a is null or v_user_c is null then
    raise notice 'tier-2 fixture accounts absent — skipping board-thread seed (expected off DEV)';
    return;
  end if;

  -- Gamma joins Alpha's org as an ordinary member. `deactivated_at` stays null:
  -- is_org_member() (and therefore can_read_board()) requires an ACTIVE row.
  insert into public.org_members (org_id, user_id, role)
  values ('aaaa0000-0000-4000-8000-000000000001', v_user_c, 'member')
  on conflict do nothing;

  -- Gamma is granted the EXISTING Alpha fixture board. This grant is the only
  -- reason the shared-thread read succeeds; delete it and the positive case
  -- flips to a negative.
  insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
  values (
    'aaaa0000-0000-4000-8000-000000000001',
    'aaaa0000-0000-4000-8000-000000000003',
    v_user_c,
    'viewer',
    v_user_a
  )
  on conflict do nothing;

  -- A second Alpha board that gamma is deliberately NOT a member of.
  insert into public.boards (id, org_id, workspace_id, name, created_by)
  values (
    'aaaa0000-0000-4000-8000-00000000000b',
    'aaaa0000-0000-4000-8000-000000000001',
    'aaaa0000-0000-4000-8000-000000000002',
    'Alpha Off-Limits Board',
    v_user_a
  )
  on conflict (id) do nothing;

  -- The two board-scoped threads. Both are owned by A and both are
  -- visibility = 'board'; they differ ONLY in which board they hang off, which
  -- is what makes the pair a clean experiment on can_read_board().
  insert into public.ai_conversations (id, org_id, user_id, workspace_id, board_id, visibility, title)
  values
    (
      'aaaa0000-0000-4000-8000-000000000008',
      'aaaa0000-0000-4000-8000-000000000001',
      v_user_a,
      'aaaa0000-0000-4000-8000-000000000002',
      'aaaa0000-0000-4000-8000-000000000003',
      'board',
      'Alpha shared board thread'
    ),
    (
      'aaaa0000-0000-4000-8000-00000000000c',
      'aaaa0000-0000-4000-8000-000000000001',
      v_user_a,
      'aaaa0000-0000-4000-8000-000000000002',
      'aaaa0000-0000-4000-8000-00000000000b',
      'board',
      'Alpha off-limits board thread'
    )
  on conflict (id) do nothing;

  -- Turns. ai_messages carries no board column of its own — its policy reaches
  -- through the parent conversation — so a shared thread needs real rows for
  -- "the non-owner sees the messages too" to mean anything.
  insert into public.ai_messages (id, conversation_id, role, content)
  values
    (
      'aaaa0000-0000-4000-8000-000000000009',
      'aaaa0000-0000-4000-8000-000000000008',
      'user',
      'What is blocking this board?'
    ),
    (
      'aaaa0000-0000-4000-8000-00000000000a',
      'aaaa0000-0000-4000-8000-000000000008',
      'assistant',
      'Three items are overdue.'
    ),
    (
      'aaaa0000-0000-4000-8000-00000000000d',
      'aaaa0000-0000-4000-8000-00000000000c',
      'assistant',
      'Nothing here is visible off this board.'
    )
  on conflict (id) do nothing;
end
$$;
