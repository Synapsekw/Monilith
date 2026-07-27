-- 20260727094033_seed_tier2_tenant_fixtures.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Seeds the two PERMANENT tenants that the Tier-2 tenant-isolation suite
--   (src/lib/supabase/tenant-isolation.fixtures.test.ts, `pnpm test:fixtures`)
--   asserts against. Two users, two orgs that share nothing — so cross-tenant
--   isolation between LOGGED-IN users becomes a READ-ONLY assertion instead of
--   needing a provisioning run and a destructive purge.
--
--   NO SCHEMA CHANGES. Data only.
--
-- WHY THIS IS SAFE TO CARRY TO PRODUCTION
--   It never creates an auth user. Every insert hangs off
--   `select id from auth.users where lower(email) = '<fixture address>'`, so
--   where those accounts do not exist — which is everywhere except DEV — the
--   whole migration is a clean no-op. Same pattern as
--   20260619210000_seed_platform_admin_info.sql.
--
--   The accounts themselves are created out-of-band, DEV-only, by
--   supabase/fixtures/tier2-fixture-users.dev-only.sql, which is deliberately
--   NOT in supabase/migrations/ so `supabase db push` can never carry it.
--
-- IDEMPOTENT. Fixed UUIDs + `on conflict ... do nothing` throughout, so
-- re-applying repairs a partially-deleted fixture rather than duplicating it.
-- The same UUIDs are spelled in src/test/tenant-fixtures.ts; a unit test
-- (src/test/tenant-fixtures.test.ts) fails if the two ever drift.

do $$
declare
  v_user_a uuid;
  v_user_b uuid;
begin
  select id into v_user_a from auth.users
    where lower(email) = 'pulse-tier2-fixture-a@example.com';
  select id into v_user_b from auth.users
    where lower(email) = 'pulse-tier2-fixture-b@example.com';

  if v_user_a is null or v_user_b is null then
    raise notice 'tier-2 fixture accounts absent — skipping seed (expected off DEV)';
    return;
  end if;

  -- Organizations ---------------------------------------------------------
  insert into public.organizations (id, name, slug, created_by)
  values
    ('aaaa0000-0000-4000-8000-000000000001', 'Tier-2 Fixture Alpha', 'tier2-fixture-alpha', v_user_a),
    ('bbbb0000-0000-4000-8000-000000000001', 'Tier-2 Fixture Beta',  'tier2-fixture-beta',  v_user_b)
  on conflict (id) do nothing;

  -- Memberships: each user owns exactly ONE org and belongs to no other.
  -- That disjointness is the entire premise of the isolation assertions.
  insert into public.org_members (org_id, user_id, role)
  values
    ('aaaa0000-0000-4000-8000-000000000001', v_user_a, 'owner'),
    ('bbbb0000-0000-4000-8000-000000000001', v_user_b, 'owner')
  on conflict do nothing;

  -- Workspaces ------------------------------------------------------------
  insert into public.workspaces (id, org_id, name, created_by)
  values
    ('aaaa0000-0000-4000-8000-000000000002', 'aaaa0000-0000-4000-8000-000000000001', 'Alpha Fixture Workspace', v_user_a),
    ('bbbb0000-0000-4000-8000-000000000002', 'bbbb0000-0000-4000-8000-000000000001', 'Beta Fixture Workspace',  v_user_b)
  on conflict (id) do nothing;

  -- Boards + groups. `items` is deliberately NOT seeded: its insert triggers
  -- enqueue an embedding job and run automations, which are side effects a
  -- permanent read-only fixture has no business causing.
  insert into public.boards (id, org_id, workspace_id, name, created_by)
  values
    ('aaaa0000-0000-4000-8000-000000000003', 'aaaa0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000002', 'Alpha Fixture Board', v_user_a),
    ('bbbb0000-0000-4000-8000-000000000003', 'bbbb0000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000002', 'Beta Fixture Board',  v_user_b)
  on conflict (id) do nothing;

  insert into public.groups (id, org_id, board_id, name)
  values
    ('aaaa0000-0000-4000-8000-000000000004', 'aaaa0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000003', 'Alpha Fixture Group'),
    ('bbbb0000-0000-4000-8000-000000000004', 'bbbb0000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000003', 'Beta Fixture Group')
  on conflict (id) do nothing;

  -- Ask Pulse threads ------------------------------------------------------
  insert into public.ai_conversations (id, org_id, user_id, workspace_id, title)
  values
    ('aaaa0000-0000-4000-8000-000000000005', 'aaaa0000-0000-4000-8000-000000000001', v_user_a, 'aaaa0000-0000-4000-8000-000000000002', 'Alpha fixture thread'),
    ('bbbb0000-0000-4000-8000-000000000005', 'bbbb0000-0000-4000-8000-000000000001', v_user_b, 'bbbb0000-0000-4000-8000-000000000002', 'Beta fixture thread')
  on conflict (id) do nothing;

  -- Tenant A's thread carries a Phase-2 `proposedActions` trace. Proposal and
  -- outcome rows ride in ai_messages.tool_trace — no new table, no new policy —
  -- so its invisibility to a non-owner IS the Phase-2 isolation guarantee. That
  -- assertion shipped in July 2026 and had never executed, because its suite is
  -- a Tier-1 integration test that always skipped.
  insert into public.ai_messages (id, conversation_id, role, content, tool_trace)
  values
    ('aaaa0000-0000-4000-8000-000000000006', 'aaaa0000-0000-4000-8000-000000000005', 'user',
     'Add a task for shipping v2.', null),
    ('aaaa0000-0000-4000-8000-000000000007', 'aaaa0000-0000-4000-8000-000000000005', 'assistant',
     'I''ll create that —',
     '{"proposedActions":[{"kind":"create_item","boardId":"aaaa0000-0000-4000-8000-000000000003","groupId":"aaaa0000-0000-4000-8000-000000000004","name":"Ship v2","summary":"Create task Ship v2 in Alpha Fixture Group","warnings":[]}]}'::jsonb),
    ('bbbb0000-0000-4000-8000-000000000006', 'bbbb0000-0000-4000-8000-000000000005', 'user',
     'What is on my board?', null)
  on conflict (id) do nothing;
end
$$;
