# Board Thread Org Coupling — `ai_conversations.board_id → org_id`

**Date:** 2026-08-04
**Status:** Spec written — awaiting review
**Author:** Dani (with Claude)
**Closes:** the open thread "A multi-org user can dock a thread stamped `org_id = A` onto a board in
org B" in `vault/sessions/2026-08-04-1443-board-dock-and-ai-move-verb.md`
**Related:**
`vault/decisions/2026-08-04-gotcha-74-a-mitigation-that-never-executes-is-not-a-mitigation.md`,
`vault/decisions/2026-08-04-decision-33-a-board-dock-reverses-ask-as-a-standalone-surface.md`,
`vault/decisions/2026-08-02-decision-32-production-runs-the-dev-database.md`,
`vault/decisions/2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file.md`,
`vault/decisions/2026-07-02-decision-25-no-isolated-test-db-integration-opt-in.md`,
`docs/superpowers/specs/2026-08-03-personal-agents-phase2-design.md`

## Summary

Make it structurally impossible for an `ai_conversations` row to carry a `board_id` whose board
lives in a different org than the row's own `org_id`. The mechanism is a **composite foreign key**
`(board_id, org_id) → boards (id, org_id)` with `ON DELETE SET NULL (board_id)`, plus a matching
app-level guard in `createConversation` so the failure surfaces as a sentence rather than a
Postgres error code.

This is **not** a tenant escape. RLS already bounds what a docked thread can read and who can read
it: `ai_conversations_select_own` requires `user_id = auth.uid() AND is_org_member(org_id)`, and
`ai_conversations_select_board_shared` requires `can_read_board(board_id)`, which itself requires
active membership of the _board's_ org. The defect is **attribution drift** — a row that claims to
belong to org B while sitting in org A's dock — and drift in the column every downstream org-scoped
query, export, deletion cascade, and usage ledger keys off.

## The defect, precisely

`createConversation` (`src/lib/ai/ask/conversation-actions.ts`) writes:

- `board_id` — resolved through `readableBoardId()`, i.e. **the board's org**, whichever of the
  caller's orgs that is;
- `org_id` — resolved through `resolveActiveOrg()`, i.e. **the `pulse_active_org` cookie**,
  validated against `getUserOrgs()`.

Two independent resolvers, two different answers whenever the caller belongs to more than one org
and the cookie does not name the board's org. Nothing reconciles them.

**It is reachable through the ordinary UI, with no attack.** `src/app/(app)/boards/[boardId]/page.tsx`
neither reads nor reconciles the active-org cookie — it renders any board RLS lets the caller read.
A user in orgs A and B, with the cookie on B, opens a board in A, opens the dock, and sends a
message: the thread is stamped B and docked to A.

On DEV today: **8 users hold active membership of more than one org.** The population that can
produce this is real, not theoretical.

### What this is NOT, and must not be confused with

The same session found and fixed a genuine cross-tenant hole in this exact function:
`createConversation` resolved `agentId` through RLS while accepting `boardId` **on trust**, letting
any authenticated user plant an attacker-authored thread into a foreign board's dock. The fix was
`readableBoardId()` — an RLS-scoped read through the user client, failing closed with one message
for both "not yours" and "not there" so it is not a board-membership oracle.

**This spec does not touch that.** `readableBoardId()` stays exactly as it is, keeps its single
fail-closed message, and remains the first gate. The change here is additive: the same read also
returns `org_id`, and a second, _narrower_ comparison runs only for a board the caller has already
proven they may read. The new message therefore leaks nothing new — reaching it already requires
proven membership of the board's org.

The docblock on `readableBoardId()` currently ends with:

> Nothing downstream closes this — `ai_conversations` has no trigger and no CHECK coupling
> `board_id` to `org_id` […]

That sentence becomes false the moment this ships and must be corrected in the same change, or the
next reader will trust a comment that is now describing the old world.

## Mechanism: why a composite FK, not a CHECK and not a trigger

A `CHECK` constraint cannot subquery. `CHECK (board_in_org(board_id, org_id))` — calling the
existing `SECURITY DEFINER` helper from `20260615061747_boards_core.sql` — is _syntactically_
accepted by Postgres but is a documented footgun: a `CHECK` is required to be `IMMUTABLE` and is
**not** re-evaluated when the referenced row changes, so it is a lie the planner is entitled to
believe. `pg_dump`/restore order can also make it fail to reload. It is not an option.

That leaves three real candidates.

| Option                                                         | Enforced against                                 | Verdict    |
| -------------------------------------------------------------- | ------------------------------------------------ | ---------- |
| **A. Composite FK** `(board_id, org_id) → boards (id, org_id)` | every role, every path, including `service_role` | **Chosen** |
| B. `BEFORE INSERT OR UPDATE` trigger calling `board_in_org()`  | every role, but via hand-written PL/pgSQL        | Rejected   |
| C. RLS `WITH CHECK … board_in_org(board_id, org_id)`           | `authenticated` only                             | Rejected   |

### Why A

1. **It is the referential-integrity machinery, not code.** No `SECURITY DEFINER` function to
   harden, no `set search_path = ''` to remember, no ACL to lock down — the repo already carries a
   whole migration (`20260725102610_definer_acl_lockdown.sql`) paying for definer functions it has.
   Nothing to `create or replace` out from under a future reader.
2. **`board_id IS NULL` stays legal for free.** A composite FK defaults to `MATCH SIMPLE`: if _any_
   referencing column is NULL the constraint is satisfied without a lookup. `org_id` is `NOT NULL`
   and `board_id` is nullable, so a boardless thread — every `/ask` thread, every scheduled
   briefing (`writeBriefingThread` sets `board_id: null` by construction) — passes trivially. A
   trigger has to _spell_ `if new.board_id is null then return new; end if;`, and a future edit can
   drop that line. Here the legality is a property of the constraint class, not of a line someone
   must not delete.
3. **It preserves `ON DELETE SET NULL`, which is load-bearing.**
   `20260804093518_board_thread_board_fk_set_null.sql` deliberately softened this FK from `CASCADE`
   because `purgeBoard` is an owner-only hard delete and every member's docked threads — including
   `visibility = 'private'` ones the owner has never been able to read — hang off that board. The
   naive composite FK would _break_ that: plain `ON DELETE SET NULL` on a composite key nulls
   **every** referencing column, and `org_id` is `NOT NULL`, so purging a board would start failing
   with a not-null violation. Postgres 15+ solves this with a column list:
   **`ON DELETE SET NULL (board_id)`**. DEV runs **PostgreSQL 17.6** (verified), so this is
   available and is the exact expression of the existing intent: the board reference degrades, the
   org attribution survives.
4. **It survives `service_role`.** RLS is bypassed by the service client and by any
   `SECURITY DEFINER` function; a constraint is not. `writeBriefingThread` is careful to write
   through the _owner_ client today, but that is a convention, and conventions are what this repo's
   ADR shelf is made of.
5. **It self-documents.** It shows up in `\d ai_conversations`, in the advisors, and in
   `src/types/database.types.ts` `Relationships`. A trigger shows up nowhere a reader is looking.

### Why not B (trigger)

A trigger is the right tool when you need a _custom_ error message, or repair-on-update semantics,
or a check the RI machinery cannot express. None applies:

- The friendly message belongs in the server action (see below), which runs first and makes the
  constraint an unreachable backstop for the app path.
- `boards.org_id` is never updated — no code path writes it, and a board changing org is not a
  product concept. So there is no "the parent moved, now fix the children" case a trigger would
  handle and an FK would not. (An FK would _refuse_ such an update, which is the correct answer
  anyway.)
- Per-row PL/pgSQL on every conversation insert is a cost with no return next to an index probe.

### Why not C (RLS `WITH CHECK`)

The repo has real precedent here — `groups`, `items`, `cell_values` and friends all carry
`with check (is_org_member(org_id) and board_in_org(board_id, org_id))`. It is a good pattern and
it is _complementary_, not sufficient: those tables have `board_id NOT NULL` and are only ever
written by `authenticated`. `ai_conversations` is written by paths that could reasonably become
service-side, and its `INSERT`/`UPDATE` policies sit two feet from the widened `SELECT` policies
this feature just shipped — editing them again is the single highest-blast-radius edit available on
this table. **Not editing an RLS policy is a feature of this design.** The FK gives the same
guarantee, strictly wider, with zero policy churn.

## The change

### 1. Migration (one file, minted by `scripts/new-migration.sh`)

```sql
-- boards.id is already unique (PK), but a foreign key must reference a UNIQUE
-- INDEX over exactly its referenced column list. (id, org_id) is unique for the
-- trivial reason that id alone is; this constraint exists to make that fact
-- addressable by the FK below. 18 rows on DEV — the index build is instant.
alter table public.boards
  add constraint boards_id_org_key unique (id, org_id);

-- Replace, do not add alongside. Two FKs from ai_conversations to boards would
-- make PostgREST embeds ambiguous and fire two RI triggers per board delete for
-- one guarantee; the composite FK strictly subsumes the single-column one
-- (org_id is NOT NULL, so MATCH SIMPLE never short-circuits on it).
alter table public.ai_conversations
  drop constraint ai_conversations_board_id_fkey;

alter table public.ai_conversations
  add constraint ai_conversations_board_org_fkey
    foreign key (board_id, org_id)
    references public.boards (id, org_id)
    on delete set null (board_id);
```

`ON DELETE SET NULL (board_id)` is the whole point of the third statement: it nulls **only**
`board_id`, leaving the `NOT NULL org_id` intact, so `purgeBoard` keeps working and a docked thread
keeps degrading to a plain `/ask` thread exactly as it does today.

The constraint is added **validated** (no `NOT VALID`): the table holds 12 rows and the pre-flight
count below is a hard gate on there being zero violations. `NOT VALID` + a later
`VALIDATE CONSTRAINT` is the escape hatch **only** if the pre-flight finds drift that cannot be
remediated in the same change — see below.

Deliberately **not** in this migration: no new index on `ai_conversations`. The RI check for the
delete side is `… where board_id = $1 and org_id = $2`, which the existing partial index
`ai_conversations_board_updated_idx (board_id, updated_at desc) where board_id is not null` already
serves (a `board_id = $1` predicate implies the partial index's own predicate, so the planner may
use it). If the Supabase advisor flags an unindexed FK after apply, add the covering index then —
not speculatively.

### 2. Existing drifted rows on DEV

**The production deployment runs the DEV database** (`hjqcahbbbdaknbbnfnvl`), so this migration
reaches real users the moment `main` is promoted. It must be safe against live data, and "safe"
means _counted_, not assumed.

**Pre-flight audit (run against DEV before writing the migration, and again immediately before
applying it):**

```sql
-- Every row that would be REFUSED by the new constraint, with enough context to
-- decide what to do about each one. Expected: zero rows.
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

and the aggregate that makes a zero result non-vacuous (a `join` returning nothing proves nothing
if there are no docked rows at all):

```sql
select
  count(*)                                                    as total_rows,
  count(*) filter (where c.board_id is null)                  as boardless_rows,
  count(*) filter (where c.board_id is not null)              as docked_rows,
  count(*) filter (where c.board_id is not null and b.id is null)
                                                              as orphan_board_refs,
  count(*) filter (where b.id is not null and b.org_id <> c.org_id)
                                                              as drifted_rows
from public.ai_conversations c
left join public.boards b on b.id = c.board_id;
```

**Result on DEV, 2026-08-04:**

| total_rows | boardless_rows | docked_rows | orphan_board_refs | drifted_rows |
| ---------- | -------------- | ----------- | ----------------- | ------------ |
| 12         | 8              | 4           | 0                 | **0**        |

Four docked rows, all correctly attributed. **No remediation is needed today.** The dock is
hours old; the drift window has barely opened, which is exactly why closing it now costs nothing
and closing it in three months would be a data migration on live user history.

**Remediation, if the re-run at apply time finds `drifted_rows > 0`:**

Null the board reference; do **not** rewrite `org_id`.

```sql
-- Degrade the drifted rows to plain /ask threads. This is the SAME graceful
-- degradation ON DELETE SET NULL already performs, and it fails closed: the
-- shared-read policy's first conjunct is `board_id is not null`, so a nulled row
-- drops out of every board member's view immediately.
update public.ai_conversations c
set board_id = null,
    visibility = 'private'
from public.boards b
where b.id = c.board_id
  and b.org_id is distinct from c.org_id;
```

`visibility` is reset alongside because `setThreadVisibility` already treats
`visibility = 'board'` on a boardless thread as a lie worth refusing — leaving it would paint a
"Shared" chip on a thread no board member can read.

**Why not the other direction.** Rewriting `c.org_id = b.org_id` looks tidier and is wrong. `org_id`
is the conversation's _tenant attribution_: it is what `ai_conversations_insert_own` validated at
write time, what an org export and an account deletion key off, and what the AI usage/entitlement
ledger is scoped by. Rewriting it silently moves a user's private conversation content into another
tenant's ledger — a bigger act than the one being repaired, performed by a migration, on live data,
with no audit trail. Nulling a nullable pointer is reversible in spirit; re-tenanting content is not.

**Ordering.** If remediation is needed it goes in the **same migration file, before** the
`add constraint`, so there is no window in which the constraint exists and the data does not satisfy
it, and no possibility of the repair being applied to DEV and forgotten before PROD.

### 3. `board_id IS NULL` stays legal — the three ways this is guaranteed

1. `MATCH SIMPLE` (the default) skips the lookup entirely when any referencing column is NULL.
2. `ON DELETE SET NULL (board_id)` is the _only_ delete action, so a board purge continues to
   produce null-`board_id` rows and they continue to be legal.
3. A Tier-2 assertion inserts `(org_id = own org, board_id = null)` and requires it to succeed
   (§ Testing). This is the case a hasty trigger implementation would break, so it is tested, not
   asserted in prose.

### 4. App-level guard (`createConversation`)

Without it, a multi-org user in the ordinary flow above gets `fail("Couldn't start the
conversation.")` — a raw constraint violation dressed as a generic error, with no way to act on it.

`readableBoardId()` widens its projection from `id` to `id, org_id` — **the same single read, no
new round-trip** — and returns the pair. `createConversation` then compares it against the org it
already resolved:

```ts
// Reachable ONLY for a board the caller has already proven they may read, so
// naming the mismatch leaks nothing readableBoardId did not already concede.
// The DB constraint is the invariant; this is the sentence a human can act on.
if (board.orgId !== org.id) {
  return fail(
    "This board is in a different organization. Switch to it to chat here.",
  );
}
```

Ordering matters: `readableBoardId()` runs first and keeps its single ambiguous message, so an
attacker probing a board uuid they cannot read still learns only "Board not found."

**Rejected alternative: derive `org_id` from the board instead of the cookie.** It removes the
failure path entirely and is tempting. It is wrong here because `/api/ask/route.ts` independently
resolves `resolveActiveOrg()` for `requireAiEntitlement()` and for usage recording on **every
turn**. Deriving the conversation's org from the board would stamp the thread org A while every
turn in it is entitled and billed to org B — trading an attribution drift for a _billing_ drift,
which is worse and harder to detect. The whole request must agree on one org, and the cookie is
what the rest of the request already uses.

### 5. Explicitly out of scope

- **Reconciling the active-org cookie to the board's org on the board page.** This is the fix that
  would make the new guard unreachable in practice, and it also closes the `/api/ask` billing
  mismatch above. It touches a global concern (the org switcher) and deserves its own spec and its
  own ADR. Named here so the next reader does not think this spec claimed it.
- **RLS policy changes.** None. See § Why not C.
- **`ai_messages`.** It carries no `board_id`; ownership derives from the parent conversation.
- **Backfilling `org_id` on any row.** See § Why not the other direction.

## Testing

`vault/decisions/2026-08-04-gotcha-74-a-mitigation-that-never-executes-is-not-a-mitigation.md` is
binding on this spec: **naming a Tier-1 `*.integration.test.ts` suite as the control is naming a
mitigation that never executes.** All ~70 Tier-1 suites self-skip — `integrationTargetReady()`
deny-lists DEV and PROD because the Tier-1 teardown is a destructive `@example.com` purge, and
decision-25 rules out a sacrificial project. `7 skipped` is not `7 passed`.

This spec therefore names **Tier 2** (`*.fixtures.test.ts`, run by `pnpm test:fixtures`, included in
`pnpm test`) as its control. `allowsTier2Fixtures()` inverts the Tier-1 deny-list and permits DEV
alone, so the suite actually runs, against the live database the deployment serves.

### Tier 2 — `src/lib/ai/ask/board-org-coupling.fixtures.test.ts` (new)

Signs in as fixture **alpha** (`pulse-tier2-fixture-a@example.com`) using the existing
`signInOrThrow` + `resolveFixtureTarget` machinery from `src/test/tenant-fixtures.ts`. Four cases,
all probe-writes with fixed UUIDs and an unconditional cleanup, following the "THE ONE HONEST
CAVEAT" precedent already set by the tenant-isolation and board-thread fixture suites.

| #   | Insert as alpha                                    | Expected                | Proves                        |
| --- | -------------------------------------------------- | ----------------------- | ----------------------------- |
| 1   | `org_id = ALPHA.orgId`, `board_id = BETA.boardId`  | **error, code `23503`** | **the discriminator**         |
| 2   | `org_id = ALPHA.orgId`, `board_id = ALPHA.boardId` | succeeds                | anti-vacuity: #1 is the FK    |
| 3   | `org_id = ALPHA.orgId`, `board_id = null`          | succeeds                | boardless stays legal         |
| 4   | `org_id = ALPHA.orgId`, `board_id = <random uuid>` | **error, code `23503`** | no board ⇒ no dock, unchanged |

**Case #1 is the discriminator that fails if the constraint is removed.** Today — before the
migration — that insert **succeeds**, creating precisely the drifted row this spec exists to
forbid. After the migration it must raise `foreign_key_violation`. Delete the constraint and the
case goes green-to-red in the one direction that matters. State it in the file's header, in those
words.

Three details that make it evidence rather than decoration:

- **Assert the SQLSTATE, not just `error !== null`.** `expect(error?.code).toBe("23503")` and
  `expect(error?.message).toContain("ai_conversations_board_org_fkey")`. Without this, an RLS
  regression returning `42501`, or a `NOT NULL` violation from a botched `SET NULL` clause, would
  satisfy a bare "it errored" and the case would pass while proving something else.
- **Beta's board id is a real uuid alpha cannot read** — which is the point. RI checks run as the
  constraint owner and are not subject to RLS, so the refusal comes from the FK, not from
  invisibility. That is the whole "a uuid-shaped board id is not a board you may write to" argument,
  now enforced one layer below the server action.
- **Cleanup is unconditional and asserted.** Cases #2 and #3 leave real rows in the permanent
  fixture corpus; #1 and #4 leave none _if the constraint works_ and one _if it does not_. An
  `afterAll` deletes all four fixed UUIDs through alpha's own client (owner-scoped `DELETE` is
  permitted by `ai_conversations_delete_own`), and a final case re-reads them and asserts the corpus
  is back to exactly its seeded shape — the same integrity block
  `board-threads.fixtures.test.ts` ends with. Probe rows use their own UUID block and are **not**
  added to `src/test/tenant-fixtures.ts`' permanent constants; they are transient by design.

No seed migration is needed. Every id the suite needs already exists in `TIER2_FIXTURE_TENANTS`.

### Unit tier — always runs, no database

- **`src/lib/ai/ask/board-threads.schema.test.ts` (extend).** This file already reads the migration
  corpus off disk and asserts its shape, and it currently pins `ai_conversations_board_id_fkey` by
  name — including a test that the **last word on that FK across the whole corpus is
  `on delete set null`**. Dropping that constraint and adding `ai_conversations_board_org_fkey`
  invalidates those regexes; they must be **rewritten deliberately, not deleted**, to assert:
  1. `boards_id_org_key` exists as a `unique (id, org_id)` constraint on `public.boards`;
  2. the composite FK references `public.boards (id, org_id)`;
  3. its delete action is the **column-list** form `on delete set null (board_id)` — a plain
     `on delete set null` here is a latent not-null violation on every board purge, so the test must
     reject it specifically;
  4. no later migration drops `ai_conversations_board_org_fkey` (the same "nothing re-hardens it"
     ordering property the existing suite protects for `SET NULL`);
  5. the corpus never re-adds a single-column `boards(id)` FK on `ai_conversations` afterwards.
- **`src/lib/ai/ask/conversation-actions.test.ts` (extend).** The existing
  `describe("createConversation — board threads")` block gains: a board in another org →
  `fail(...)` with the new message and **no insert attempted**; a board in the active org → inserts
  as before; `boardId` omitted → unchanged, no board read at all. Mocked client, so this runs
  everywhere including CI.

### Gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, with `pnpm test` explicitly confirmed to
report the new fixtures cases as **passed**, not skipped — read the count, per gotcha-74's rule 1.
Plus `pnpm db:ledger-check` clean in both directions.

## Performance & data-fetching budget (working agreement #5)

- **First paint:** unchanged. No query added to `getBoardPayload`, `listBoardThreads` or the dock.
- **Per interaction:** **zero new round-trips.** The guard reads `org_id` from the board row
  `readableBoardId()` already fetches — a widened projection on an existing single-row PK lookup, not
  a second query. `resolveActiveOrg()` is `cache()`-wrapped and already resolved in the same request.
- **Write path:** one extra index probe per conversation insert (the FK check, against the new
  unique index on `boards (id, org_id)`, 18 rows). Board delete gains one RI action, served by the
  existing partial index on `ai_conversations (board_id, …)`.
- **Bounded over indexed columns:** the audit and remediation queries are one-off migration-time
  statements over a 12-row table joined to an 18-row table, both on indexed keys. Nothing here is a
  hot path.

## Independent units (working agreement #6, spec half)

Four units with no shared state, suitable for concurrent scheduling once their inputs exist:

- **U1 — the pre-flight audit.** Read-only SQL against DEV. Produces the go/no-go and the
  remediation decision. Nothing else can be finalised before it, because the migration's content
  depends on its answer.
- **U2 — the migration file.** Depends only on U1's verdict. Touches `supabase/migrations/` alone.
- **U3 — the app guard + its unit tests.** Touches `src/lib/ai/ask/conversation-actions.ts` and its
  test file only. Shares no file with U2 or U4; needs no database.
- **U4 — the schema-shape tests.** Touches `src/lib/ai/ask/board-threads.schema.test.ts` only, but
  reads U2's file content, so it follows U2.
- **U5 — the Tier-2 suite.** New file, no conflicts, but must run against a DEV that already has
  the constraint — so it follows the apply step, not merely the file.

U2 and U3 are the genuinely parallel pair; U4 and U5 are parallel with each other once their
respective inputs land.

## Risks

| Risk                                                                          | Severity | Mitigation                                                                                                                                                       |
| ----------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain `on delete set null` used instead of the column-list form               | **High** | `purgeBoard` would start failing on `org_id` NOT NULL. Pinned by a schema-shape unit test that rejects the plain form by name, and by PG 17.6 (verified) support |
| Drifted rows appear between the audit and the apply                           | Medium   | The audit is re-run immediately before `apply_migration`; remediation ships **inside** the same migration, before the `add constraint`                           |
| The Tier-2 probe leaves rows in the permanent fixture corpus                  | Medium   | Fixed UUIDs, unconditional `afterAll` delete through alpha's own client, plus an asserted integrity re-read — the precedent the existing fixtures suite sets     |
| Rewriting the schema test loses the `SET NULL` ordering guarantee it protects | Medium   | The rewrite is a named, itemised task (5 assertions listed above), not "fix the failing test"                                                                    |
| MCP `apply_migration` stamps its own version (gotcha-55)                      | Medium   | Fired on **4 of 4** migrations last session. `scripts/reconcile-migration-version.sh` + `pnpm db:ledger-check` are budgeted steps, not contingencies             |
| `pnpm db:types` run from the worktree empties `database.types.ts`             | Medium   | Generate from the **main checkout** or via the MCP `generate_typescript_types` tool; size-check before committing                                                |
| A multi-org user is now refused where they previously succeeded               | Low      | That "success" was the defect. The refusal is actionable and one org-switch away; the cookie-reconciliation follow-up removes even that                          |

## Open questions

None. The mechanism, the delete semantics, the remediation direction, the test tier and the
discriminator are all settled above; the one genuinely separable decision (reconciling the active-org
cookie on the board page) is named and deferred with a reason.
