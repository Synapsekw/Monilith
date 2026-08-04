-- 20260804090229_seed_tier2_docked_private_thread.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds the ONE fixture row that makes the `visibility = 'board'` conjunct of
--   20260804031458_board_threads.sql's two new SELECT policies observable to
--   src/lib/ai/ask/board-threads.fixtures.test.ts.
--
--   NO SCHEMA CHANGES. Data only, additive, idempotent — same contract and same
--   PROD-safe no-op shape as 20260804084303_seed_tier2_board_thread_fixtures.sql.
--
-- WHY IT WAS NEEDED (the suite was blind without it)
--   The corpus had three Alpha conversations: (board_id null, private),
--   (shared board, 'board'), (off-limits board, 'board'). Evaluated on DEV as
--   gamma, the shipped predicate and the same predicate WITHOUT its visibility
--   conjunct returned identical verdicts on all three:
--
--     …0005  board_id null   private  ->  false / false   (first conjunct)
--     …0008  shared board    board    ->  true  / true    (can_read_board true)
--     …000c  off-limits      board    ->  false / false   (can_read_board false)
--
--   So `visibility = 'board'` could have been deleted from either policy and
--   every assertion in the suite would still have passed. This row breaks that
--   tie: same board as …0008, same owner, same org, ONE column different.
--
--     …000e  shared board    private  ->  false / TRUE
--
-- WHY THIS ROW CLASS IS THE DANGEROUS ONE
--   `visibility` is NOT NULL DEFAULT 'private' and nothing couples it to
--   `board_id`, so a thread docked to a board and not yet shared lands in
--   (board_id set, visibility private) BY DEFAULT. That is the row the board
--   dock creates most often, it holds private conversation content, and the
--   visibility conjunct is the only thing protecting it from every member of
--   that board.
--
-- IDEMPOTENT. Fixed UUIDs + `on conflict (id) do nothing`. The same UUIDs are
-- spelled in src/test/tenant-fixtures.ts; a unit test
-- (src/test/tenant-fixtures.test.ts) fails if the two ever drift.

do $$
declare
  v_user_a uuid;
begin
  select id into v_user_a from auth.users
    where lower(email) = 'pulse-tier2-fixture-a@example.com';

  if v_user_a is null then
    raise notice 'tier-2 fixture accounts absent — skipping docked-private seed (expected off DEV)';
    return;
  end if;

  -- Docked to the board gamma HOLDS, deliberately left unshared. `visibility`
  -- is spelled explicitly rather than relying on the column default, so the
  -- intent survives a future change to that default.
  insert into public.ai_conversations (id, org_id, user_id, workspace_id, board_id, visibility, title)
  values (
    'aaaa0000-0000-4000-8000-00000000000e',
    'aaaa0000-0000-4000-8000-000000000001',
    v_user_a,
    'aaaa0000-0000-4000-8000-000000000002',
    'aaaa0000-0000-4000-8000-000000000003',
    'private',
    'Alpha docked unshared thread'
  )
  on conflict (id) do nothing;

  -- ai_messages has no visibility column of its own — its policy reaches through
  -- the parent conversation — so the mirror assertion needs a real turn here.
  insert into public.ai_messages (id, conversation_id, role, content)
  values (
    'aaaa0000-0000-4000-8000-00000000000f',
    'aaaa0000-0000-4000-8000-00000000000e',
    'user',
    'Draft notes I have not shared with this board yet.'
  )
  on conflict (id) do nothing;
end
$$;
