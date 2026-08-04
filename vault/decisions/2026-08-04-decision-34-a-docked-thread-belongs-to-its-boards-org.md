---
type: decision
date: 2026-08-04
tags: [decision, db, rls, boards, ai]
related:
  - "[[2026-08-04-1443-board-dock-and-ai-move-verb]]"
  - "[[2026-08-04-gotcha-74-a-mitigation-that-never-executes-is-not-a-mitigation]]"
  - "[[2026-08-02-decision-32-production-runs-the-dev-database]]"
  - "[[2026-08-04-decision-33-a-board-dock-reverses-ask-as-a-standalone-surface]]"
  - "[[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]]"
---

# Decision 34 — a docked thread belongs to its board's org

## The defect was attribution, not access

`createConversation` resolved two things from two different places and never reconciled them:

- `board_id` through an RLS-scoped board read — i.e. **the board's org**, whichever of the caller's
  orgs that happened to be;
- `org_id` through `resolveActiveOrg()` — i.e. **the `pulse_active_org` cookie**.

Whenever a caller belonged to more than one org and the cookie did not name the board's org, those
answers differed. `src/app/(app)/boards/[boardId]/page.tsx` neither reads nor reconciles the cookie —
it renders any board RLS lets you read — so the ordinary UI produced it with **no attack**: open a
board in org A with the cookie on org B, send a message, and the thread is stamped B while sitting in
A's dock. **8 users hold active membership of more than one org on DEV.**

This is deliberately **not** filed as a tenant escape, and the ADR should not be cited as one. RLS
already bounded the reads: `ai_conversations_select_own` requires
`user_id = auth.uid() AND is_org_member(org_id)`, and `ai_conversations_select_board_shared` requires
`can_read_board(board_id)`, which itself requires active membership of the **board's** org. What
drifted was the column every downstream org-scoped query, export, deletion cascade and AI usage
ledger keys off.

The genuine cross-tenant hole found the same day — `boardId` accepted on trust, letting anyone plant
a thread in a foreign board's dock — was a **separate** fix (`readableBoard`, formerly
`readableBoardId`). That guard is untouched here and still runs first.

## Why a composite FK, and not a CHECK, a trigger, or an RLS `WITH CHECK`

**A CHECK was never available.** `CHECK (board_in_org(board_id, org_id))` is syntactically accepted
but is a footgun: a `CHECK` is required to be `IMMUTABLE` and is **not** re-evaluated when the
referenced row changes, so it is a lie the planner is entitled to believe.

That left three real options, and the composite FK won on four counts:

1. **It is machinery, not code.** No `SECURITY DEFINER` function to harden, no `set search_path = ''`
   to remember, no ACL to lock down, nothing to `create or replace` out from under a future reader.
2. **`board_id IS NULL` stays legal as a property of the constraint class.** A composite FK defaults
   to `MATCH SIMPLE`: if any referencing column is NULL the constraint is satisfied with no lookup.
   `org_id` is `NOT NULL` and `board_id` is nullable, so every `/ask` thread and every scheduled
   briefing passes trivially. A trigger has to *spell* `if new.board_id is null then return new`, and
   a future edit can delete that line. Here there is no line to delete.
3. **It survives `service_role`.** RLS is bypassed by the service client and by any
   `SECURITY DEFINER` function; a constraint is not. An RLS `WITH CHECK` would bind `authenticated`
   only — and editing the `ai_conversations` policies, two feet from the SELECT policies the dock had
   just widened, is the single highest-blast-radius edit available on that table. **Not editing an
   RLS policy is a feature of this design.**
4. **It self-documents** — in `\d ai_conversations`, in the advisors, and in `database.types.ts`
   `Relationships`. A trigger shows up nowhere a reader is looking.

## `ON DELETE SET NULL (board_id)` — the column list is load-bearing

`20260804093518_board_thread_board_fk_set_null.sql` had deliberately softened this FK from `CASCADE`,
because `purgeBoard` is an **owner-only** hard delete and every member's docked threads hang off that
board — including `visibility = 'private'` ones the owner has never been able to read.

The naive composite FK **breaks that**: on a composite key, a delete action without a column list
nulls **every** referencing column, and `org_id` is `NOT NULL`. Every purge of a board with docked
threads would start failing with a not-null violation. PostgreSQL 15+ solves it with the column list
`on delete set null (board_id)` — the board pointer degrades, the org attribution survives. DEV runs
PostgreSQL 17.6 (`server_version_num = 170006`, verified).

A unit test in `board-threads.schema.test.ts` rejects the bare form **by name**, and it was watched
failing before the edit was reverted. A guard nobody has seen fire is a guard nobody knows they have.

### The trap that test itself fell into

The first version of that guard **failed on correct SQL**. The migration's own header comment argues
about the bare form by name, so a regex over the raw file matched the *prose* rather than the DDL —
and symmetrically, the positive assertion would have passed vacuously off a comment. The neighbouring
fk-fix migration has the same shape: its header says "ON DELETE CASCADE" while its SQL says SET NULL.
Both assertions now run through a `sqlOnly()` helper that strips `--` comments first.

**A schema-shape test that scans raw migration text reads the argument, not the conclusion.** These
migrations explain the option they did *not* choose, by name — that is good documentation and a
booby-trap for any regex over the file.

## Count the violating rows before constraining a live database

The production deployment runs this database, so the constraint was added **validated** only on the
strength of a measurement, not an assumption. Audited three times — at spec time, at build time, and
immediately before `apply_migration`:

| total | boardless | docked | orphan refs | **drifted** |
| ----- | --------- | ------ | ----------- | ----------- |
| 12    | 8         | 4      | 0           | **0**       |

The aggregate matters as much as the drift count: a `join` returning nothing proves nothing if there
are no docked rows at all. Four docked rows existed, all correctly attributed. No remediation
statement shipped — a no-op `UPDATE` against a live table is not free.

### The remediation that was rejected in advance

Had drift been found, the repair would have been to **null `board_id`** (and reset `visibility`), not
to rewrite `org_id = b.org_id`. Rewriting the org looks tidier and is the bigger act: `org_id` is the
conversation's tenant attribution — what the insert policy validated, what an org export and an
account deletion key off, what AI usage is scoped by. Nulling a nullable pointer is reversible in
spirit; **re-tenanting a user's private conversation content into another org's ledger is not**,
least of all performed by a migration with no audit trail.

## The discriminator was observed, not assumed

Per gotcha-74, the control is Tier 2 (`board-org-coupling.fixtures.test.ts`), which actually executes
against DEV — 7 cases, verified **passed**, not skipped. Tier 1 would have self-skipped.

The evidence that makes case 1 evidence rather than decoration, both against DEV in rolled-back
transactions:

- **Before the migration:** inserting alpha's `org_id` with beta's `board_id` was **ACCEPTED**
  (`conversation_org` = alpha, `board_org` = beta, `is_drifted = true`) — exactly the drifted row.
- **After the migration:** dropping the constraint **re-admits** it (1 row inserted).

With the constraint in place the same insert raises `23503` naming
`ai_conversations_board_org_fkey`. The test asserts the SQLSTATE and the constraint name, not
`error !== null` — otherwise an RLS regression (`42501`) or a not-null violation (`23502`) from a
botched delete action would satisfy it while proving something else.

## Two operational notes that recurred

- **gotcha-55 fired again** — `apply_migration` stamped `20260804144702` against the committed
  file's `20260804144223`. It is a step, not an incident. New detail worth recording: the ledger
  `name` column keeps whatever was passed to `apply_migration`, so passing the **full stamped
  filename** turns the repair into a pure relabel — but `reconcile-migration-version.sh` prints a
  `WHERE name = '<bare slug>'`, which then matches nothing. Adjust the `WHERE` to the row's actual
  name (the script does warn).
- **`supabase gen types` emitted a PostHog telemetry line after `} as const`** and exited 1. Generated
  from the main checkout into a scratch file (so the main checkout's own types were never touched),
  truncated at the last `} as const`, then size-checked at 4190 lines.

## Deferred, deliberately

**Reconciling `pulse_active_org` to the board's org on the board page.** That is the fix that makes
this guard unreachable in practice, and it closes a second, worse drift: `/api/ask/route.ts`
independently resolves `resolveActiveOrg()` for `requireAiEntitlement()` and usage recording on
**every turn**, so a turn about org A's board is entitled and billed to the cookie's org B. That is
precisely why the guard here refuses rather than deriving `org_id` from the board — deriving would
have traded an attribution drift for a **billing** drift, which is worse and harder to detect. The
whole request must agree on one org; the cookie is what the rest of the request already uses. Fixing
that touches the global org switcher and deserves its own spec and its own ADR.
