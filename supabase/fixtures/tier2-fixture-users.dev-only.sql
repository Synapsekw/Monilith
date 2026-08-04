-- ===========================================================================
-- DEV-ONLY. NOT A MIGRATION. Never run this against production.
-- ===========================================================================
--
-- Creates the PERMANENT Tier-2 fixture identities that
-- src/lib/supabase/tenant-isolation.fixtures.test.ts and
-- src/lib/ai/ask/board-threads.fixtures.test.ts sign in as.
--
-- A and B own one org each and share nothing — that disjointness is the premise
-- of every cross-tenant isolation assertion. C ("gamma") is deliberately the
-- opposite: a second, NON-OWNING member of A's org, granted one of A's boards.
-- public.can_read_board() requires ACTIVE ORG MEMBERSHIP *and*
-- creator-or-board-member, so the board-thread widening cannot be proven by A or
-- B at all — no principal in another org can ever satisfy it. C exists solely so
-- "a board member CAN read a shared thread" is a real assertion rather than a
-- vacuous one. C owns nothing and holds no elevated role.
--
-- It lives in `supabase/fixtures/`, NOT `supabase/migrations/`, on purpose:
-- `supabase db push` and `/sync-prod` read `migrations/` only, so this file can
-- never be carried to PROD by the normal promotion path. Production must never
-- grow accounts whose password is committed to the repo. The companion
-- migrations (`*_seed_tier2_tenant_fixtures.sql`,
-- `*_seed_tier2_board_thread_fixtures.sql`) only ATTACH rows to accounts that
-- already exist, so they are a clean no-op wherever these three are absent —
-- the same pattern as 20260619210000_seed_platform_admin_info.sql.
--
-- Run it once, by hand, against DEV (supabase-dev MCP `execute_sql`), then apply
-- the seed migration. Idempotent: re-running is a no-op.
--
-- Why these accounts are safe on DEV: they hold no elevated role, are not
-- platform admins, and RLS confines them to their own fixture org — which
-- contains nothing but fixture rows. The DEV anon key required to use them is
-- not committed.

-- The four token columns MUST be '' and not NULL. GoTrue scans them into
-- non-nullable Go strings, so a NULL turns every sign-in into the famously
-- opaque "Database error querying schema" — which looks like a broken project,
-- not a broken row. (Reproduced here before it was fixed.)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaa0000-0000-4000-8000-0000000000a1',
    'authenticated', 'authenticated',
    'pulse-tier2-fixture-a@example.com',
    extensions.crypt('Tier2-Fixture-Read-Only-2026!', extensions.gen_salt('bf')),
    now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Tier-2 Fixture A"}'::jsonb,
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbb0000-0000-4000-8000-0000000000b1',
    'authenticated', 'authenticated',
    'pulse-tier2-fixture-b@example.com',
    extensions.crypt('Tier2-Fixture-Read-Only-2026!', extensions.gen_salt('bf')),
    now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Tier-2 Fixture B"}'::jsonb,
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaa0000-0000-4000-8000-0000000000c1',
    'authenticated', 'authenticated',
    'pulse-tier2-fixture-c@example.com',
    extensions.crypt('Tier2-Fixture-Read-Only-2026!', extensions.gen_salt('bf')),
    now(),
    '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Tier-2 Fixture C"}'::jsonb,
    now(), now()
  )
on conflict (id) do nothing;

-- Repair path for accounts created before the '' columns were understood.
update auth.users
   set confirmation_token = coalesce(confirmation_token, ''),
       recovery_token = coalesce(recovery_token, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change = coalesce(email_change, '')
 where email in (
   'pulse-tier2-fixture-a@example.com',
   'pulse-tier2-fixture-b@example.com',
   'pulse-tier2-fixture-c@example.com'
 );

-- GoTrue expects a matching `email` identity row alongside the user.
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at,
  created_at, updated_at
)
select
  gen_random_uuid(),
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(), now(), now()
from auth.users u
where u.email in (
  'pulse-tier2-fixture-a@example.com',
  'pulse-tier2-fixture-b@example.com',
  'pulse-tier2-fixture-c@example.com'
)
  and not exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  );
