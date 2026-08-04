# Board Thread Org Coupling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible for an `ai_conversations` row to carry a `board_id` whose board lives
in a different org than the row's own `org_id`, without making `board_id IS NULL` illegal.

**Architecture:** One migration replaces the single-column FK `ai_conversations.board_id → boards(id)`
with a composite FK `(board_id, org_id) → boards(id, org_id)`, referencing a new unique constraint
`boards_id_org_key`, using the PostgreSQL 15+ column-list delete action
`ON DELETE SET NULL (board_id)` so a board purge still nulls only the board pointer. A widened
projection in `createConversation` turns the constraint into an unreachable backstop for the app
path by returning a sentence instead of a SQLSTATE. Proof lives in the Tier-2 fixtures suite, which
actually executes against DEV, not in a Tier-1 suite, which does not.

**Tech Stack:** PostgreSQL 17.6 (Supabase DEV `hjqcahbbbdaknbbnfnvl`), Supabase RLS, Next.js 16
Server Actions, Zod, Vitest (projects: `unit`, `conformance`, `fixtures`), `supabase-dev` MCP.

**Spec:** `docs/superpowers/specs/2026-08-04-board-thread-org-coupling-design.md`

## Global Constraints

- **The production deployment runs the DEV database.** `www.monolith.works` (`main` on Vercel) is
  wired to Supabase DEV `hjqcahbbbdaknbbnfnvl`. Every statement in this plan that touches DEV
  touches live, user-facing data. No destructive experiments. Read
  `vault/decisions/2026-08-02-decision-32-production-runs-the-dev-database.md` before Task 4.
- **Migrations are minted only by `scripts/new-migration.sh <slug>`.** Never hand-invent a version
  stamp. Slug for this work: `board_thread_org_coupling`.
- **gotcha-55 is not a contingency, it is a step.** The `supabase-dev` MCP `apply_migration` stamps
  its **own** `now()`-based version even when handed the full stamped filename as `name`. It fired
  on **4 of 4** migrations in the 2026-08-04 session. Task 4 budgets
  `scripts/reconcile-migration-version.sh` and `pnpm db:ledger-check` as mandatory steps, not as
  error handling. ADR:
  `vault/decisions/2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file.md`.
- **`pnpm db:types` must never be run from a worktree.** The script pipes `supabase gen types`
  stdout straight into `src/types/database.types.ts`, so an "unlinked project" error — which is what
  a worktree produces — **empties the file**. Task 4 uses the MCP `generate_typescript_types` tool
  plus an explicit size check instead. If you fall back to `pnpm db:types`, run it in the **main
  checkout** `C:\Users\D\Monilith` and copy the result in.
- **`board_id IS NULL` must stay legal.** Every `/ask` thread and every scheduled briefing
  (`writeBriefingThread` sets `board_id: null` by construction) depends on it. It is asserted, not
  assumed — Task 5, case 3.
- **`ON DELETE SET NULL` must stay the delete action, in its column-list form.**
  `20260804093518_board_thread_board_fk_set_null.sql` softened this FK from `CASCADE` on purpose:
  `purgeBoard` is an owner-only hard delete and other members' _private_ threads hang off the board.
  A composite FK with a **bare** `on delete set null` nulls `org_id` too, which is `NOT NULL` — every
  board purge would start failing. Only `on delete set null (board_id)` is acceptable.
- **Exact new identifiers** (spelled identically everywhere):
  - `boards_id_org_key` — `unique (id, org_id)` on `public.boards`
  - `ai_conversations_board_org_fkey` — the composite FK
  - user-facing copy, verbatim: `This board is in a different organization. Switch to it to chat here.`
- **Commit identity:** `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage explicitly by path —
  never `git add -A`. Commit subjects lowercase after `type(scope):`, with a descriptive body and
  the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Worktree:** `C:\Users\D\Monilith\.claude\worktrees\dock-org-check`, branch
  `task/dock-org-check`. Do not touch the main checkout except where Task 4 explicitly allows it.

---

## File Structure

| File                                                        | Change | Responsibility                                                            |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `supabase/migrations/<stamp>_board_thread_org_coupling.sql` | Create | The invariant: unique constraint + composite FK (+ remediation if needed) |
| `src/lib/ai/ask/board-threads.schema.test.ts`               | Modify | Static shape assertions over the migration corpus (unit project)          |
| `src/lib/ai/ask/conversation-actions.ts`                    | Modify | `readableBoard()` + the org-mismatch guard + the now-false docblock       |
| `src/lib/ai/ask/conversation-actions.test.ts`               | Modify | Mocked unit coverage of the guard                                         |
| `src/lib/ai/ask/board-org-coupling.fixtures.test.ts`        | Create | Tier-2 proof against live DEV — the discriminator                         |
| `src/types/database.types.ts`                               | Modify | Regenerated `Relationships` after the FK swap                             |
| `vault/decisions/2026-08-04-decision-34-*.md`               | Create | ADR: why an FK and not a trigger, and what it does not claim              |

---

## Execution DAG (working agreement #6)

**Dependency graph**

```
T1 (audit, read-only)
 ├─> T2 (migration file + schema-shape tests)      [needs T1's remediation verdict]
 │    └─> T4 (apply to DEV + ledger + types)       [needs T2's committed file]
 │         └─> T5 (Tier-2 fixtures suite)          [needs the constraint LIVE on DEV]
 │              └─> T6 (full gates + ADR)          [needs everything]
 └─> T3 (app guard + unit tests)                   [independent of T1/T2 — no DB, no shared file]
      └─> T6
```

**Parallel batches**

| Batch | Tasks      | Why they can share a wave                                                                                                 |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1     | **T1**     | Sequential head: the migration's content depends on what the audit finds                                                  |
| 2     | **T2, T3** | Disjoint files (`supabase/migrations/` + a test file vs. `conversation-actions.*`); T3 needs no database and no migration |
| 3     | **T4**     | Serialised by design — a single writer against the live DEV ledger                                                        |
| 4     | **T5**     | Needs the constraint applied; nothing else is in flight                                                                   |
| 5     | **T6**     | Whole-branch gates and the ADR                                                                                            |

**Critical path:** T1 → T2 → T4 → T5 → T6 (five links). T3 is free wall-clock — it rides alongside
T2 and is the only genuine concurrency available here. With ≥2 tasks in batch 2, dispatch them with
`superpowers:dispatching-parallel-agents`. They edit disjoint files inside the same worktree, so no
additional worktree is needed for this batch.

---

### Task 1: Pre-flight drift audit against DEV

**Files:**

- Modify: `docs/superpowers/plans/2026-08-04-board-thread-org-coupling.md` (the § Audit log below)

**Interfaces:**

- Consumes: nothing.
- Produces: **`REMEDIATION_NEEDED: yes | no`** — the verdict Task 2 branches on, plus the recorded
  row counts.

Read-only. This task runs SQL against the database the production deployment serves; it must not
write. Use the `supabase-dev` MCP `execute_sql` tool.

- [ ] **Step 1: Count the corpus, so a zero result is not vacuous**

A `join` that returns no rows proves nothing if there are no docked rows at all. Run:

```sql
select
  count(*)                                                      as total_rows,
  count(*) filter (where c.board_id is null)                    as boardless_rows,
  count(*) filter (where c.board_id is not null)                as docked_rows,
  count(*) filter (where c.board_id is not null and b.id is null)
                                                                as orphan_board_refs,
  count(*) filter (where b.id is not null and b.org_id <> c.org_id)
                                                                as drifted_rows
from public.ai_conversations c
left join public.boards b on b.id = c.board_id;
```

Expected shape: `docked_rows > 0` (otherwise the audit is uninformative and you must say so),
`orphan_board_refs = 0`, and `drifted_rows` is the number that matters.

- [ ] **Step 2: List every offending row, with enough context to judge it**

```sql
select
  c.id            as conversation_id,
  c.user_id,
  c.org_id        as conversation_org,
  c.board_id,
  b.org_id        as board_org,
  c.visibility,
  c.created_at
from public.ai_conversations c
join public.boards b on b.id = c.board_id
where b.org_id is distinct from c.org_id
order by c.created_at;
```

- [ ] **Step 3: Confirm the delete-action syntax is available**

`on delete set null (<column>)` is PostgreSQL **15+**. Confirm the server is at or above it:

```sql
select version(), current_setting('server_version_num');
```

Expected: `server_version_num >= 150000`. Measured 2026-08-04: `170006` (PostgreSQL 17.6). If this
ever came back below 150000, **stop** — the composite FK would null `org_id` on board delete and
the whole mechanism changes to a trigger.

- [ ] **Step 4: Record the verdict in this plan**

Append the numbers to § Audit log below, with the date and the project ref, and write the verdict
line `REMEDIATION_NEEDED: yes` or `REMEDIATION_NEEDED: no`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-08-04-board-thread-org-coupling.md
git commit -m "docs(plan): record the dev drift audit for board-thread org coupling"
```

#### Audit log

| Date             | Project                    | total | boardless | docked | orphan | **drifted** |
| ---------------- | -------------------------- | ----- | --------- | ------ | ------ | ----------- |
| 2026-08-04 spec  | DEV `hjqcahbbbdaknbbnfnvl` | 12    | 8         | 4      | 0      | **0**       |
| 2026-08-04 build | DEV `hjqcahbbbdaknbbnfnvl` | 12    | 8         | 4      | 0      | **0**       |

`server_version_num = 170006` (PostgreSQL 17.6), re-verified at build time. The step-2 offending-row
listing returned **zero rows** on both runs. `REMEDIATION_NEEDED: no`.

**Re-run steps 1–2 at the start of Task 4** and update this table; the value that governs the
migration is the one measured immediately before it is applied.

---

### Task 2: The migration file and its shape tests

**Files:**

- Create: `supabase/migrations/<stamp>_board_thread_org_coupling.sql` (stamp minted by the script)
- Modify: `src/lib/ai/ask/board-threads.schema.test.ts`

**Interfaces:**

- Consumes: `REMEDIATION_NEEDED` from Task 1.
- Produces: constraint names `boards_id_org_key` and `ai_conversations_board_org_fkey`, and a
  migration filename ending in `_board_thread_org_coupling.sql` (Task 4 applies it; the schema test
  finds it by that suffix).

This task is test-first: the new assertions fail because the migration file does not exist yet
(`readMigrationNamed` throws `No migration file ending in "…" found`), then pass once it does.

- [ ] **Step 1: Rewrite the FK block in the schema test**

Open `src/lib/ai/ask/board-threads.schema.test.ts`. The existing `describe("board_id degrades
rather than cascades")` block pins `ai_conversations_board_id_fkey` **by name** and asserts that the
last word on it across the whole corpus is `on delete set null`. This task drops that constraint, so
those regexes must be **rewritten deliberately**, not deleted — the ordering property they protect
is still the point, it just moves to the new constraint name.

Replace the second test of that block (`"leaves the LAST word on that FK as set null across the
whole corpus"`) with a version scoped to the migration that still owns the claim, and add the new
block after it:

```ts
    it("leaves the LAST word on the OLD FK as set null before it is superseded", () => {
      // Scoped to the fk-fix migration itself. The corpus-wide ordering claim
      // now belongs to ai_conversations_board_org_fkey (next describe block):
      // the board_org_coupling migration DROPS this constraint, so a corpus-wide
      // regex for it would match the drop statement and mean nothing.
      expect(fkFix).toMatch(
        /add constraint\s+ai_conversations_board_id_fkey[\s\S]{0,200}?on delete set null/i,
      );
      expect(fkFix).not.toMatch(/on delete cascade/i);
    });
  });

  // ── the board's org IS the thread's org ─────────────────────────────────
  describe("board_id is coupled to org_id by a composite foreign key", () => {
    const coupling = readMigrationNamed("_board_thread_org_coupling.sql");

    it("makes boards (id, org_id) addressable by a foreign key", () => {
      // A foreign key must reference a UNIQUE INDEX over exactly its referenced
      // column list. boards.id is already unique, but (id, org_id) is not
      // addressable without this.
      expect(coupling).toMatch(
        /add constraint\s+boards_id_org_key\s+unique\s*\(\s*id\s*,\s*org_id\s*\)/i,
      );
    });

    it("replaces the single-column board FK rather than adding a second one", () => {
      // Two FKs from ai_conversations to boards would make PostgREST embeds
      // ambiguous and fire two RI actions per board delete for one guarantee.
      expect(coupling).toMatch(
        /drop constraint\s+ai_conversations_board_id_fkey/i,
      );
      expect(coupling).toMatch(
        /add constraint\s+ai_conversations_board_org_fkey[\s\S]{0,240}?foreign key\s*\(\s*board_id\s*,\s*org_id\s*\)\s*references\s+public\.boards\s*\(\s*id\s*,\s*org_id\s*\)/i,
      );
    });

    it("nulls ONLY board_id on board delete, never the NOT NULL org_id", () => {
      expect(coupling).toMatch(/on delete set null\s*\(\s*board_id\s*\)/i);
    });

    it("never uses the bare SET NULL form, which would null org_id", () => {
      // THE failure this file exists to prevent: a bare `on delete set null` on
      // a COMPOSITE key nulls every referencing column. org_id is NOT NULL, so
      // purgeBoard would start failing with a not-null violation on every purge
      // of a board that has docked threads.
      const bare = [...coupling.matchAll(/on delete set null(?!\s*\()/gi)];
      expect(
        bare.map((m) => m[0]),
        "a bare `on delete set null` on the composite FK would null org_id",
      ).toEqual([]);
    });

    it("never lets a later migration drop the coupling", () => {
      expect(corpus).not.toMatch(
        /drop constraint\s+ai_conversations_board_org_fkey/i,
      );
      expect(corpus).not.toMatch(/drop constraint\s+boards_id_org_key/i);
    });

    it("never re-adds a single-column boards(id) FK afterwards", () => {
      // Ordering, not presence: what protects the invariant is that nothing
      // after this migration re-weakens it back to board_id alone.
      const idx = corpus.indexOf("ai_conversations_board_org_fkey");
      expect(idx).toBeGreaterThan(-1);
      expect(corpus.slice(idx)).not.toMatch(
        /add constraint\s+ai_conversations_board_id_fkey[\s\S]{0,240}?foreign key\s*\(\s*board_id\s*\)/i,
      );
    });
  });
```

`readMigrationSources()` sorts filenames before concatenating, so `corpus` is in migration order and
the `slice(idx)` check really does mean "afterwards".

- [ ] **Step 2: Run the test and watch it fail for the right reason**

```bash
pnpm vitest run --project unit src/lib/ai/ask/board-threads.schema.test.ts
```

Expected: FAIL with `No migration file ending in "_board_thread_org_coupling.sql" found`. If it
fails with anything else, fix that first — a test that fails for the wrong reason proves nothing.

- [ ] **Step 3: Mint the migration file**

```bash
scripts/new-migration.sh board_thread_org_coupling
```

Note the exact stamped filename it prints. Do **not** rename it and do not hand-edit the stamp.

- [ ] **Step 4: Write the migration**

Paste this into the new file, keeping the header comment block the script generated:

```sql
-- What this migration does:
--   Couples ai_conversations.board_id to ai_conversations.org_id, so a thread
--   can only be docked to a board that lives in the SAME org the thread is
--   stamped with.
--
--   This is NOT a tenant escape being closed — RLS already bounds who can read
--   a docked thread (ai_conversations_select_board_shared requires
--   can_read_board(board_id), which requires active membership of the BOARD's
--   org). What drifts is ATTRIBUTION: createConversation resolves board_id from
--   the board (whichever of the caller's orgs that is) and org_id from the
--   pulse_active_org cookie, and nothing reconciled the two. A multi-org user
--   with the cookie on org B, opening a board in org A, produced a thread
--   stamped B sitting in A's dock. No attack required.
--
-- WHY A COMPOSITE FK AND NOT A CHECK OR A TRIGGER
--   A CHECK cannot subquery, and CHECK(board_in_org(...)) is a footgun: a CHECK
--   is required to be IMMUTABLE and is never re-evaluated when the referenced
--   row changes. A trigger would work but is hand-written PL/pgSQL with its own
--   search_path hardening, its own ACL, and its own `if new.board_id is null
--   then return new` line that a future edit can lose. The referential-integrity
--   machinery gives the same guarantee declaratively, for every role including
--   service_role (which bypasses RLS but never a constraint).
--
-- WHY board_id IS NULL STAYS LEGAL
--   A composite FK defaults to MATCH SIMPLE: if ANY referencing column is null
--   the constraint is satisfied with no lookup. org_id is NOT NULL and board_id
--   is nullable, so every /ask thread and every scheduled briefing (board_id is
--   null by construction) passes trivially. That legality is a property of the
--   constraint class, not of a line somebody must remember not to delete.
--
-- WHY THE COLUMN-LIST DELETE ACTION IS LOAD-BEARING
--   20260804093518_board_thread_board_fk_set_null.sql softened this FK from
--   CASCADE because purgeBoard is an OWNER-ONLY hard delete and other members'
--   PRIVATE docked threads hang off the board. A bare `on delete set null` on a
--   COMPOSITE key nulls every referencing column — including the NOT NULL
--   org_id — so every purge of a board with docked threads would fail. The
--   PostgreSQL 15+ column list `on delete set null (board_id)` expresses the
--   existing intent exactly: the board pointer degrades, the org attribution
--   survives. DEV runs PostgreSQL 17.6 (verified 2026-08-04).
--
-- LIVE-DATA SAFETY
--   The production deployment runs this database. Audited 2026-08-04 before
--   writing this file: 12 conversations, 4 docked, 0 orphaned board refs,
--   0 drifted rows. The constraint is therefore added VALIDATED in one step.

-- boards.id is already unique (PK); this makes the PAIR addressable by an FK.
alter table public.boards
  add constraint boards_id_org_key unique (id, org_id);

-- Replace, do not add alongside: the composite FK strictly subsumes the
-- single-column one (org_id is NOT NULL, so MATCH SIMPLE never short-circuits
-- on it), and two FKs to the same table would make PostgREST embeds ambiguous.
alter table public.ai_conversations
  drop constraint ai_conversations_board_id_fkey;

alter table public.ai_conversations
  add constraint ai_conversations_board_org_fkey
    foreign key (board_id, org_id)
    references public.boards (id, org_id)
    on delete set null (board_id);
```

**No new index on `ai_conversations`.** The delete-side RI probe is
`where board_id = $1 and org_id = $2`, which the existing partial index
`ai_conversations_board_updated_idx (board_id, updated_at desc) where board_id is not null` already
serves. Add a covering index only if the Supabase advisor flags an unindexed FK in Task 4.

- [ ] **Step 5: If and only if `REMEDIATION_NEEDED: yes`, prepend the repair**

Insert this **above** the `add constraint` statements, so no window exists in which the constraint
is present and the data does not satisfy it:

```sql
-- Degrade drifted rows to plain /ask threads. Same graceful degradation the
-- ON DELETE SET NULL action already performs, and it fails CLOSED: the
-- shared-read policy's first conjunct is `board_id is not null`, so a nulled row
-- drops out of every board member's view immediately. visibility is reset
-- alongside because setThreadVisibility already refuses visibility='board' on a
-- boardless thread as a lie — leaving it would paint a "Shared" chip on a thread
-- no board member can read.
--
-- DELIBERATELY NOT the other direction. Rewriting c.org_id = b.org_id looks
-- tidier and silently moves a user's private conversation content into another
-- tenant's ledger — org_id is what the insert policy validated, what an org
-- export and an account deletion key off, and what AI usage is scoped by.
update public.ai_conversations c
set board_id = null,
    visibility = 'private'
from public.boards b
where b.id = c.board_id
  and b.org_id is distinct from c.org_id;
```

If `REMEDIATION_NEEDED: no`, skip this step entirely — do not ship a no-op `update` against a live
table.

- [ ] **Step 6: Run the schema tests and watch them pass**

```bash
pnpm vitest run --project unit src/lib/ai/ask/board-threads.schema.test.ts
```

Expected: PASS, with a **count**, not a skip. Read the number of tests reported.

- [ ] **Step 7: Prove the bare-SET-NULL test discriminates**

Temporarily change `on delete set null (board_id)` to `on delete set null` in the migration and
re-run. Expected: the `"never uses the bare SET NULL form"` case FAILS. Revert the edit and re-run
to green. A guard you have never seen fire is a guard you do not know you have.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/<stamp>_board_thread_org_coupling.sql src/lib/ai/ask/board-threads.schema.test.ts
git commit -m "feat(db): couple a docked thread's board to its org via a composite fk"
```

---

### Task 3: The app-level guard in `createConversation`

**Files:**

- Modify: `src/lib/ai/ask/conversation-actions.ts:42-65` (`readableBoardId` → `readableBoard`),
  `:85-93` (the board block), `:105-107` (after `resolveActiveOrg`), `:120` (the insert)
- Test: `src/lib/ai/ask/conversation-actions.test.ts`

**Interfaces:**

- Consumes: nothing. No database, no migration — runs and passes before the constraint exists.
- Produces: `readableBoard(boardId: string): Promise<{ id: string; orgId: string } | null>`, and
  the exact user-facing string
  `"This board is in a different organization. Switch to it to chat here."`

Runs in parallel with Task 2. **Do not touch `readableBoardId`'s fail-closed semantics** — its
single ambiguous "Board not found." for both "not yours" and "not there" is what keeps it from being
a board-membership oracle, and it is the fix for the real cross-tenant hole found on 2026-08-04. The
new comparison runs strictly _after_ it, only for a board the caller has already proven they may
read.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe("createConversation — board threads")` block in
`src/lib/ai/ask/conversation-actions.test.ts`. Note the file's mocks: `resolveActiveOrg` returns
`{ id: "org1", … }`, so the board's org must be `"org1"` for the happy path.

```ts
// ── the board's org IS the thread's org ──────────────────────────────────
const OTHER_ORG_ID = "77777777-7777-4777-8777-777777777777";

it("refuses a board that lives in a different org than the active one", async () => {
  // Reachable with no attack: the board page does not reconcile the
  // pulse_active_org cookie, so a multi-org user viewing org A's board with
  // the cookie on org B lands here. The DB constraint refuses this row; this
  // guard is what turns a SQLSTATE into a sentence.
  maybeSingleBoard.mockResolvedValue({
    data: { id: BOARD_ID, org_id: OTHER_ORG_ID },
    error: null,
  });
  const res = await createConversation({
    firstMessage: "hi",
    boardId: BOARD_ID,
  });
  expect(res).toEqual({
    ok: false,
    error:
      "This board is in a different organization. Switch to it to chat here.",
  });
  expect(insertConv).not.toHaveBeenCalled();
  expect(insertMsg).not.toHaveBeenCalled();
});

it("still answers 'Board not found.' for an unreadable board, org or no org", async () => {
  // Ordering: the unreadable-board check runs FIRST and keeps its single
  // ambiguous message. If the org mismatch were reported for a board the
  // caller cannot read, the pair would become a membership oracle.
  maybeSingleBoard.mockResolvedValue({ data: null, error: null });
  const res = await createConversation({
    firstMessage: "hi",
    boardId: FOREIGN_BOARD_ID,
  });
  expect(res).toEqual({ ok: false, error: "Board not found." });
});

it("accepts a board in the active org and stamps that org on the thread", async () => {
  maybeSingleBoard.mockResolvedValue({
    data: { id: BOARD_ID, org_id: "org1" },
    error: null,
  });
  const res = await createConversation({
    firstMessage: "hi",
    boardId: BOARD_ID,
  });
  expect(res.ok).toBe(true);
  expect(insertConv).toHaveBeenCalledWith(
    expect.objectContaining({ org_id: "org1", board_id: BOARD_ID }),
  );
});

it("does not read boards at all when no boardId is given", async () => {
  // /ask must keep behaving exactly as before: no board read, no org
  // comparison, and it still revalidates.
  const res = await createConversation({ firstMessage: "hi" });
  expect(res.ok).toBe(true);
  expect(maybeSingleBoard).not.toHaveBeenCalled();
  expect(revalidatePath).toHaveBeenCalledWith("/ask");
});
```

Then update the block's `beforeEach` so the default board mock carries the active org — otherwise
every pre-existing case in the block starts failing the new guard:

```ts
// `boards` is RLS-scoped to what the caller can read, so the default here is
// "the caller is on this board, and it is in the org they are acting as".
maybeSingleBoard.mockResolvedValue({
  data: { id: BOARD_ID, org_id: "org1" },
  error: null,
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm vitest run --project unit src/lib/ai/ask/conversation-actions.test.ts
```

Expected: the "refuses a board that lives in a different org" case FAILS (it currently succeeds and
inserts). The other three should already pass — that is fine and expected; only the first is the new
behaviour.

- [ ] **Step 3: Widen the board read**

In `src/lib/ai/ask/conversation-actions.ts`, replace `readableBoardId` with:

```ts
/** A board the caller may read, together with the org it lives in. */
type ReadableBoard = { id: string; orgId: string };

/**
 * Resolve a board the CALLER can read, or null.
 *
 * `boards`' SELECT policy is `is_org_member(org_id) AND (created_by =
 * auth.uid() OR is_board_member(id))` — exactly the predicate
 * `can_read_board()` evaluates — so an RLS-scoped read through the user client
 * fails closed identically, and the check and the query are one statement. Same
 * shape as `ownedAgentId` above, and for the same reason: a uuid-SHAPED board id
 * is not a board the caller may write to.
 *
 * `org_id` rides along on the SAME single-row lookup — no extra round-trip — so
 * the caller can check that the board's org is the org this request is acting
 * as. Since 2026-08-04 the database enforces that coupling too:
 * `ai_conversations_board_org_fkey` is a composite FK `(board_id, org_id) ->
 * boards (id, org_id)`, so a mismatched pair is refused by Postgres even if this
 * guard is ever bypassed. The guard exists to make the refusal a sentence rather
 * than a SQLSTATE; the constraint is the invariant.
 */
async function readableBoard(boardId: string): Promise<ReadableBoard | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("boards")
    .select("id, org_id")
    .eq("id", boardId)
    .maybeSingle();
  return data ? { id: data.id, orgId: data.org_id } : null;
}
```

The old docblock ended with "Nothing downstream closes this — `ai_conversations` has no trigger and
no CHECK coupling `board_id` to `org_id` […]". That sentence is now false and is **replaced**, not
left standing, by the paragraph above.

- [ ] **Step 4: Add the guard**

In `createConversation`, change the board block from `let boardId: string | null = null` to:

```ts
let board: ReadableBoard | null = null;
if (input.boardId !== undefined) {
  const b = idSchema.safeParse(input.boardId);
  if (!b.success) return fail("Invalid board.");
  board = await readableBoard(b.data);
  // Fails CLOSED, and with one message for both "not yours" and "not there" —
  // distinguishing them would make this a board-membership oracle.
  if (!board) return fail("Board not found.");
}
```

then, immediately after `if (!org) return fail("No organization.");`:

```ts
// The thread's org attribution must be the board's org. Reachable only for a
// board the caller has already proven they may read, so naming the mismatch
// leaks nothing readableBoard did not already concede.
//
// Deliberately NOT "derive org_id from the board instead": /api/ask/route.ts
// independently resolves resolveActiveOrg() for requireAiEntitlement() and for
// usage recording on EVERY turn, so deriving here would stamp the thread org A
// while every turn in it is billed to org B — an attribution drift traded for a
// billing drift.
if (board && board.orgId !== org.id) {
  return fail(
    "This board is in a different organization. Switch to it to chat here.",
  );
}
```

and in the insert, `board_id: boardId` becomes `board_id: board?.id ?? null`. Finally, the
revalidate guard `if (!boardId) revalidatePath("/ask");` becomes `if (!board) revalidatePath("/ask");`.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
pnpm vitest run --project unit src/lib/ai/ask/conversation-actions.test.ts
```

Expected: PASS, all cases including the pre-existing ones. Then confirm nothing else consumed the
old name:

```bash
grep -rn "readableBoardId" src/
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/ask/conversation-actions.ts src/lib/ai/ask/conversation-actions.test.ts
git commit -m "fix(ai): refuse a dock on a board outside the org you are acting as"
```

---

### Task 4: Apply to DEV, reconcile the ledger, regenerate types

**Files:**

- Modify: `src/types/database.types.ts`
- Modify: `docs/superpowers/plans/2026-08-04-board-thread-org-coupling.md` (§ Audit log re-run)

**Interfaces:**

- Consumes: the migration filename from Task 2.
- Produces: the constraint **live on DEV** (Task 5 depends on this), and a clean ledger.

This is the only task that writes to the live database. It is deliberately a single writer — do not
run it concurrently with anything.

- [ ] **Step 1: Re-run the audit**

Re-run Task 1 steps 1–2 via the `supabase-dev` MCP `execute_sql`. Rows may have been created since
the spec was written. If `drifted_rows > 0` now and the migration has no remediation block, **go
back to Task 2 step 5** and add it — do not apply the constraint over data that violates it, and do
not repair the data with a loose statement outside the migration (PROD would never receive it).
Update § Audit log with the new numbers and the date.

- [ ] **Step 2: Apply the migration**

Use the `supabase-dev` MCP `apply_migration` with:

- `name`: the **full stamped filename** of the committed file, e.g.
  `20260804xxxxxx_board_thread_org_coupling.sql`
- `query`: the exact contents of that file

- [ ] **Step 3: Expect the version to have drifted, and check**

`apply_migration` stamps its own `now()`-based version regardless of what you pass as `name`. This
fired on 4 of 4 migrations in the previous session. Confirm with the MCP `list_migrations` tool and
compare the newest row's version against your filename's stamp.

- [ ] **Step 4: Reconcile the version label**

If (when) they differ:

```bash
scripts/reconcile-migration-version.sh <applied-version> <your-filename>
```

The script touches no database — it validates both versions against `supabase/migrations/` and
**prints** the identity check and the relabel SQL. Run the printed identity check first via the MCP
`execute_sql`, confirm it names your migration, then run the printed `update`, then the printed
verification query. The committed file is the source of truth; the ledger label is what moves.

- [ ] **Step 5: Verify the ledger in both directions**

```bash
pnpm db:ledger-check
```

Expected: exit 0 with no drift. A **ledger row with no committed file** is exit 2 and is always a
defect (gotcha-57) — `supabase db push` reads files, so such a change can never reach production.
`finish-task.sh` blocks on it, so it must be clean here.

- [ ] **Step 6: Verify the constraint really is what you wrote**

Via the MCP `execute_sql`:

```sql
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid in ('public.ai_conversations'::regclass, 'public.boards'::regclass)
  and conname in ('ai_conversations_board_org_fkey', 'boards_id_org_key',
                  'ai_conversations_board_id_fkey')
order by conname;
```

Expected exactly two rows:

- `ai_conversations_board_org_fkey` →
  `FOREIGN KEY (board_id, org_id) REFERENCES boards(id, org_id) ON DELETE SET NULL (board_id)`
- `boards_id_org_key` → `UNIQUE (id, org_id)`

`ai_conversations_board_id_fkey` must be **absent**. If `ON DELETE SET NULL` appears without
`(board_id)`, stop and fix it — every board purge is now broken.

- [ ] **Step 7: Regenerate the database types — NOT with `pnpm db:types` from here**

`pnpm db:types` pipes `supabase gen types` stdout directly into the types file, so running it from a
worktree (unlinked project) **empties** `src/types/database.types.ts`. Use the MCP instead:

1. Call the `supabase-dev` MCP `generate_typescript_types` tool.
2. Write its output to `src/types/database.types.ts` with the Write tool.
3. Format it: `pnpm exec prettier --write src/types/database.types.ts`
4. **Size-check before believing it:**

   ```bash
   wc -l src/types/database.types.ts
   ```

   Expected: several thousand lines. Anything under a few hundred means the generation failed and
   you have just wiped the file — restore with
   `git checkout -- src/types/database.types.ts` and retry.

5. Confirm the FK rename landed:

   ```bash
   grep -n "ai_conversations_board_org_fkey" src/types/database.types.ts
   grep -n "ai_conversations_board_id_fkey" src/types/database.types.ts
   ```

   Expected: the first matches, the second does not.

Fallback if the MCP tool is unavailable: run `pnpm db:types` **in the main checkout**
`C:\Users\D\Monilith`, copy the file into the worktree, then restore the main checkout with
`git -C C:\Users\D\Monilith checkout -- src/types/database.types.ts`.

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS. If it fails on `cacheLife("nav")`/`cacheLife("guard")`, that is the known
cold-typecheck trap — run `pnpm build` once to generate `.next/types`, then re-run.

- [ ] **Step 9: Check the advisors**

Ask the `supabase-dev` MCP for advisors and read the security + performance lints. If it now reports
an **unindexed foreign key** on `ai_conversations (board_id, org_id)`, add
`create index ai_conversations_board_org_idx on public.ai_conversations (board_id, org_id) where board_id is not null;`
as a **new** migration (mint it with the script; do not edit the applied file) and repeat steps 2–6
for it. If it does not, add no index.

- [ ] **Step 10: Commit**

```bash
git add src/types/database.types.ts docs/superpowers/plans/2026-08-04-board-thread-org-coupling.md
git commit -m "chore(db): regenerate types after the board-org composite fk"
```

---

### Task 5: The Tier-2 proof that actually executes

**Files:**

- Create: `src/lib/ai/ask/board-org-coupling.fixtures.test.ts`

**Interfaces:**

- Consumes: the constraint live on DEV (Task 4); the fixture constants
  `TIER2_FIXTURE_TENANTS`, `TIER2_FIXTURE_PASSWORD`, `loadFixtureEnv`, `resolveFixtureTarget` from
  `@/test/tenant-fixtures`, and `signInOrThrow` from `@/test/integration-auth`.
- Produces: the discriminator case. Nothing depends on it.

**Why Tier 2 and not Tier 1.** `vault/decisions/2026-08-04-gotcha-74-a-mitigation-that-never-executes-is-not-a-mitigation.md`
is binding: all ~70 `*.integration.test.ts` suites self-skip, because `integrationTargetReady()`
deny-lists DEV and PROD (the Tier-1 teardown is a destructive `@example.com` purge) and decision-25
rules out a sacrificial project. `7 skipped` is not `7 passed`. `allowsTier2Fixtures()` inverts that
deny-list and permits DEV alone, so `*.fixtures.test.ts` is the only tier that runs against the
database the deployment serves.

**No seed migration is needed.** Every id this suite uses already exists in `TIER2_FIXTURE_TENANTS`,
and the probe rows it creates are transient — fixed UUIDs in their own block, deleted unconditionally.

- [ ] **Step 1: Write the suite**

Create `src/lib/ai/ask/board-org-coupling.fixtures.test.ts`:

```ts
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import {
  TIER2_FIXTURE_PASSWORD,
  TIER2_FIXTURE_TENANTS,
  loadFixtureEnv,
  resolveFixtureTarget,
} from "@/test/tenant-fixtures";
import type { Database } from "@/types/database.types";

// ===========================================================================
// TIER 2 — ai_conversations_board_org_fkey, proven against the LIVE DEV project.
// ===========================================================================
//
// Run: `pnpm test:fixtures` (also part of `pnpm test`).
//
// THE DISCRIMINATOR IS CASE 1.
// Alpha inserting (org_id = alpha's org, board_id = BETA's board) must raise
// SQLSTATE 23503. BEFORE the composite FK shipped, that insert SUCCEEDED — it
// created exactly the drifted row this constraint exists to forbid. Drop
// `ai_conversations_board_org_fkey` and this case goes red, and it is the ONLY
// case here that does. Every other case is a control.
//
// WHY THE REFUSAL IS NOT ABOUT VISIBILITY.
// Alpha cannot READ beta's board — but referential-integrity checks run as the
// constraint owner and are not subject to RLS, so the refusal comes from the FK,
// not from invisibility. That is the whole "a uuid-shaped board id is not a
// board you may write to" argument, now enforced one layer below the server
// action.
//
// WHY THIS IS TIER 2. All ~70 Tier-1 *.integration.test.ts suites self-skip:
// integrationTargetReady() deny-lists DEV and PROD because the Tier-1 teardown
// is a destructive purge, and decision-25 rules out a sacrificial project. A
// suite that skips proves nothing, however well written — gotcha-74.
//
// THE PROBE ROWS ARE TRANSIENT. Cases 2 and 3 leave real rows in the permanent
// fixture corpus; 1 and 4 leave none IF the constraint works and one if it does
// not. afterAll deletes all four fixed UUIDs through alpha's own client
// (ai_conversations_delete_own permits an owner-scoped DELETE), and the final
// case re-reads them and asserts the corpus is back to its seeded shape — the
// same integrity discipline board-threads.fixtures.test.ts ends with.

loadFixtureEnv();

const resolution = resolveFixtureTarget(process.env);

if (!resolution.ok) {
  console.info(`[board-org-coupling] skipped — ${resolution.reason}`);
}

const [ALPHA, BETA] = TIER2_FIXTURE_TENANTS;

/** Postgres foreign_key_violation. */
const PG_FK_VIOLATION = "23503";

/** Transient probe ids, in their own block. Deliberately NOT added to
 *  src/test/tenant-fixtures.ts — nothing permanent depends on them. */
const PROBE = {
  crossOrg: "eeee0000-0000-4000-8000-000000000001",
  sameOrg: "eeee0000-0000-4000-8000-000000000002",
  boardless: "eeee0000-0000-4000-8000-000000000003",
  ghostBoard: "eeee0000-0000-4000-8000-000000000004",
} as const;

/** A board uuid that is well-formed and belongs to no board at all. */
const GHOST_BOARD_ID = "eeee0000-0000-4000-8000-0000000000ff";

describe.skipIf(!resolution.ok)(
  "a docked thread's board must live in the thread's org (live DEV)",
  () => {
    const target = resolution.ok ? resolution.target : null;

    let alpha: SupabaseClient<Database>;
    let alphaUserId: string;

    beforeAll(async () => {
      console.info(
        `[board-org-coupling] asserting ai_conversations_board_org_fkey on ${target!.label.toUpperCase()}`,
      );
      alpha = createClient<Database>(target!.url, target!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // Rides out GoTrue's 429 and THROWS if still unauthenticated. A silently
      // signed-out client would make every refusal below vacuous.
      await signInOrThrow(
        alpha,
        { email: ALPHA.email, password: TIER2_FIXTURE_PASSWORD },
        "tier-2 fixture alpha",
      );
      const { data } = await alpha.auth.getUser();
      if (!data.user) {
        throw new Error(
          "tier-2 fixture alpha signed in but has no user — are the accounts " +
            "created from supabase/fixtures/tier2-fixture-users.dev-only.sql?",
        );
      }
      alphaUserId = data.user.id;
    }, 120_000);

    afterAll(async () => {
      // Unconditional. Cases 2 and 3 always leave a row; 1 and 4 leave one only
      // if the constraint is broken, which is precisely when cleanup matters.
      if (!alpha) return;
      await alpha
        .from("ai_conversations")
        .delete()
        .in("id", Object.values(PROBE));
    });

    function insertProbe(id: string, boardId: string | null) {
      return alpha
        .from("ai_conversations")
        .insert({
          id,
          org_id: ALPHA.orgId,
          user_id: alphaUserId,
          board_id: boardId,
          title: "board-org coupling probe",
        })
        .select("id")
        .maybeSingle();
    }

    // ── Anti-vacuity ────────────────────────────────────────────────────────
    it("signs alpha in as a real principal who owns the fixture org", async () => {
      const { data, error } = await alpha
        .from("organizations")
        .select("id, slug");
      expect(error).toBeNull();
      expect(data).toEqual([{ id: ALPHA.orgId, slug: ALPHA.orgSlug }]);
    });

    it("cannot even READ beta's board — the id is a bare uuid to alpha", async () => {
      // Which is the point: the refusal in case 1 must come from the FK, not
      // from the row being invisible.
      const { data, error } = await alpha
        .from("boards")
        .select("id")
        .eq("id", BETA.boardId);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // ── 1. THE DISCRIMINATOR ────────────────────────────────────────────────
    it("REFUSES a thread stamped alpha's org and docked to beta's board", async () => {
      const { data, error } = await insertProbe(PROBE.crossOrg, BETA.boardId);
      expect(
        error,
        "ORG ATTRIBUTION CAN STILL DRIFT — ai_conversations_board_org_fkey is " +
          "not enforcing (board_id, org_id) against boards (id, org_id)",
      ).not.toBeNull();
      // Assert the SQLSTATE, not merely "it errored": an RLS regression (42501)
      // or a not-null violation (23502) from a botched SET NULL clause would
      // satisfy a bare truthiness check while proving something else entirely.
      expect(error?.code).toBe(PG_FK_VIOLATION);
      expect(error?.message).toContain("ai_conversations_board_org_fkey");
      expect(data).toBeNull();
    });

    // ── 2. Anti-vacuity for case 1: the same insert on the RIGHT board works ─
    it("ACCEPTS the same thread docked to alpha's own board", async () => {
      // Differs from case 1 in exactly one column. Without this, case 1 would
      // pass just as happily if RLS, a typo, or a NOT NULL column were doing the
      // refusing.
      const { data, error } = await insertProbe(PROBE.sameOrg, ALPHA.boardId);
      expect(error).toBeNull();
      expect(data).toEqual({ id: PROBE.sameOrg });
    });

    // ── 3. board_id IS NULL stays legal ─────────────────────────────────────
    it("ACCEPTS a boardless thread — every /ask thread and briefing is one", async () => {
      // MATCH SIMPLE: a null in any referencing column satisfies the composite
      // FK with no lookup. If a future edit ever replaced the FK with a trigger
      // that forgot its null guard, this is the case that catches it.
      const { data, error } = await insertProbe(PROBE.boardless, null);
      expect(error).toBeNull();
      expect(data).toEqual({ id: PROBE.boardless });
    });

    // ── 4. A board that does not exist is still refused ─────────────────────
    it("REFUSES a well-formed board uuid that is no board at all", async () => {
      const { error } = await insertProbe(PROBE.ghostBoard, GHOST_BOARD_ID);
      expect(error?.code).toBe(PG_FK_VIOLATION);
    });

    // ── Integrity: the permanent corpus is untouched ────────────────────────
    it("leaves nothing behind and does not disturb the seeded fixtures", async () => {
      await alpha
        .from("ai_conversations")
        .delete()
        .in("id", Object.values(PROBE));

      const probes = await alpha
        .from("ai_conversations")
        .select("id")
        .in("id", Object.values(PROBE));
      expect(
        probes.data ?? [],
        "a probe row survived — the permanent fixture corpus is polluted",
      ).toEqual([]);

      // The regression subject from board-threads.fixtures.test.ts, re-read.
      const seeded = await alpha
        .from("ai_conversations")
        .select("id, board_id, visibility")
        .eq("id", ALPHA.conversationId);
      expect(seeded.data).toEqual([
        { id: ALPHA.conversationId, board_id: null, visibility: "private" },
      ]);
    });
  },
);
```

- [ ] **Step 2: Run it and read the count**

```bash
pnpm test:fixtures
```

Expected: the new suite's cases report as **passed**. Per gotcha-74 rule 1, read the number —
`skipped` here means `.env.local` is not resolving to DEV and the suite proved nothing. Fix that
before continuing; do not accept a skip.

- [ ] **Step 3: Prove the discriminator discriminates**

This is gotcha-74 rule 2 and it is not optional. Via the `supabase-dev` MCP `execute_sql`, in one
session:

```sql
begin;
alter table public.ai_conversations drop constraint ai_conversations_board_org_fkey;
insert into public.ai_conversations (id, org_id, user_id, board_id, title)
select
  'eeee0000-0000-4000-8000-0000000000aa',
  (select id from public.organizations where slug = 'tier2-fixture-alpha'),
  (select id from auth.users where lower(email) = 'pulse-tier2-fixture-a@example.com'),
  (select id from public.boards where org_id <> (select id from public.organizations where slug = 'tier2-fixture-alpha') limit 1),
  'discriminator proof — rolled back';
-- Expect: INSERT 0 1. Without the constraint, the drifted row is accepted.
rollback;
```

`rollback` is mandatory and is why this is safe on live data: nothing is committed, the constraint
is restored, and the probe row never existed. Record the observed result (insert succeeded without
the constraint) in the Task 6 ADR. Then re-run `pnpm test:fixtures` and confirm it is still green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/ask/board-org-coupling.fixtures.test.ts
git commit -m "test(ai): prove the board-org coupling on live dev fixtures"
```

---

### Task 6: Full gates, the ADR, and the manual-test walkthrough

**Files:**

- Create: `vault/decisions/2026-08-04-decision-34-a-docked-thread-belongs-to-its-boards-org.md`

**Interfaces:**

- Consumes: everything.
- Produces: a green branch and the closing hand-off.

- [ ] **Step 1: Run every gate, in order**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

All four must pass. If `pnpm test` reports the new fixtures cases as skipped, the suite is not
proving anything — see Task 5 step 2. If `pnpm build` fails with `module-not-found` on a dependency
another session added, run `pnpm install` in the worktree and re-run.

- [ ] **Step 2: Verify the ledger one final time**

```bash
pnpm db:ledger-check
```

Expected: exit 0. `finish-task.sh` blocks on drift, so a failure here is a failure to finish.

- [ ] **Step 3: Write the ADR**

Create `vault/decisions/2026-08-04-decision-34-a-docked-thread-belongs-to-its-boards-org.md` with
front-matter matching the shelf's convention (`type: decision`, `date: 2026-08-04`,
`tags: [decision, db, rls, boards, ai]`, and `related` links to
`[[2026-08-04-1443-board-dock-and-ai-move-verb]]`,
`[[2026-08-04-gotcha-74-a-mitigation-that-never-executes-is-not-a-mitigation]]` and
`[[2026-08-02-decision-32-production-runs-the-dev-database]]`). It must record:

1. **The defect was attribution, not access** — RLS already bounded reads; two resolvers
   (`readableBoard` → the board's org, `resolveActiveOrg` → the cookie) disagreed, and the board
   page never reconciled the cookie. Reachable with no attack; 8 multi-org users on DEV.
2. **Why a CHECK is not available** and why a composite FK beat a trigger and an RLS `WITH CHECK`:
   declarative, enforced for `service_role` too, `MATCH SIMPLE` gives null-legality as a property of
   the constraint class rather than a line someone must not delete.
3. **`ON DELETE SET NULL (board_id)`** — that the bare form would null the `NOT NULL org_id` and
   break `purgeBoard`, that PG 15+ is required, and that a unit test rejects the bare form by name.
4. **The audit numbers** (12 rows / 4 docked / 0 drifted) and the rule they encode: _count the
   violating rows before adding a constraint to a database the production deployment serves._
5. **The rejected remediation** — nulling `board_id` repairs a pointer, rewriting `org_id`
   re-tenants a user's private content.
6. **The discriminator result from Task 5 step 3** — the insert succeeds without the constraint,
   which is what makes the Tier-2 case evidence rather than decoration.
7. **The deferred follow-up** — reconciling `pulse_active_org` to the board's org on the board page,
   which would also fix `/api/ask` entitling and billing the cookie's org for a turn about another
   org's board.

- [ ] **Step 4: Commit**

```bash
git add vault/decisions/2026-08-04-decision-34-a-docked-thread-belongs-to-its-boards-org.md
git commit -m "docs(vault): adr for the docked-thread org coupling"
```

- [ ] **Step 5: Hand over the manual-test walkthrough**

This change is **mostly** not user-observable — it is a constraint plus a guard on a path the UI
does not normally reach. Give the user this, verbatim, in the closing message and in the `/wrapup`
note. It requires an account in two orgs.

1. Pull `develop`. Open a board that belongs to **org A**.
2. Without leaving that page, switch the org picker to **org B** in another tab, then come back and
   send a message in the dock on org A's board.
   Expected: `This board is in a different organization. Switch to it to chat here.` — no thread is
   created.
3. Switch the picker back to **org A**, reload the board, and send the same message.
   Expected: it works exactly as before — the thread streams, and reloading shows it in "This board".
4. Open `/ask` and start a plain thread (no board).
   Expected: unchanged. This is the `board_id IS NULL` path and it must be completely unaffected.
5. Archive a board that has docked threads and purge it (owner only).
   Expected: the purge **succeeds**, and the threads that were docked to it survive as plain
   threads on `/ask` rather than disappearing. A failure here means the delete action lost its
   `(board_id)` column list.

Everything else is verified by the test suite: `pnpm test` runs the Tier-2 suite against live DEV.

- [ ] **Step 6: Do NOT run `finish-task.sh` without the user's go-ahead**

The scoping session that produced this plan stops at review. Confirm before merging.

---

## Performance & data-fetching budget (working agreement #5)

- **First paint:** unchanged. No query is added to `getBoardPayload`, `listBoardThreads`,
  `listAgentThreads` or the dock's first render.
- **Per interaction:** **zero new server round-trips.** The guard reads `org_id` from the board row
  `readableBoard()` already fetches — a widened projection on an existing single-row primary-key
  lookup, not a second query. `resolveActiveOrg()` is `cache()`-wrapped and already resolved earlier
  in the same request.
- **Does the interaction change server data?** Only where it already did — `createConversation` is a
  Server Action and its revalidation behaviour is untouched (`/ask` still revalidates for a
  boardless thread; a board thread still deliberately does not, per gotcha-09).
- **Bounded reads over indexed columns:** the FK adds one index probe per conversation insert,
  against `boards_id_org_key` (18 rows). The delete-side RI action is served by the existing partial
  index `ai_conversations_board_updated_idx`. The audit and remediation statements are one-off
  migration-time queries over a 12-row table joined to an 18-row table on indexed keys. No unbounded
  `select *` is introduced anywhere.
