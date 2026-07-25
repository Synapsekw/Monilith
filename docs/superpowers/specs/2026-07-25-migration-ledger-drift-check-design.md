# Migration ledger ↔ committed-files drift check

**Date:** 2026-07-25
**Status:** Approved (design), pending implementation
**Rationale ADR:** `vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md`

## Problem

On 2026-07-25 the DEV database carried `20260724134101_mcp_oauth_vault_cleanup_acl` in
`supabase_migrations.schema_migrations` with **no file in `supabase/migrations/`**. It sat there for a
day. The two statements it contained revoked `public`/`anon`/`authenticated` execute on
`oauth_tokens_vault_cleanup()` — a `SECURITY DEFINER` trigger that deletes from `vault.secrets`. Had
`/promote` and `/sync-prod` run in that window, production would have shipped a publicly-executable
definer function that deletes Vault rows.

Nothing in the toolchain looks at that axis:

| Gate                                   | What it compares                    | Catches gotcha-57?                                  |
| -------------------------------------- | ----------------------------------- | --------------------------------------------------- |
| `pnpm typecheck / lint / test / build` | source code                         | no                                                  |
| `finish-task.sh` gotcha-43 guard       | file versions vs. each other        | no                                                  |
| `reconcile-migration-version.sh`       | one ledger version vs. one **file** | no — hard-exits when the file is absent             |
| `/sync-prod` step 1                    | DEV ledger vs. PROD ledger          | no — reads as ordinary "DEV ahead"                  |
| `pnpm db:types`                        | generated types                     | no — `revoke`/`grant` produce byte-identical output |

Two structural reasons this class of drift is uniquely quiet:

1. **`supabase db push` works off files.** A ledger row with no file can never be pushed to PROD — the
   change is not "pending", it is **lost**, and it looks exactly like "pending" to every existing check.
2. **ACL-only DDL leaves no type footprint.** No table, no column, no enum — so the
   regenerate-types-after-a-migration habit gives false reassurance.

## Solution

One new script that diffs the **live migration ledger** against **`supabase/migrations/`** in both
directions, with distinct exit codes so three call sites can apply three different policies to the
same result.

### Semantics — the two directions are not symmetric

Let **F** = the set of 14-digit version prefixes parsed from `supabase/migrations/*.sql` filenames in
the current checkout, and **L** = the set of `version` values in
`supabase_migrations.schema_migrations` on the target database.

| Finding                                       | Meaning                                                | Severity             |
| --------------------------------------------- | ------------------------------------------------------ | -------------------- |
| **L \ F** — ledger row with no committed file | DDL ran on a shared database and exists nowhere in git | **hard failure**     |
| **F \ L** — committed file never applied      | the ordinary mid-task / PROD-behind state              | **warning** (exit 0) |
| duplicate version prefix within F             | gotcha-43 — two files share one ledger version         | **hard failure**     |

Why asymmetric: a file that exists but is unapplied is the _normal_ state — you mint a migration, you
have not applied it yet; or PROD is legitimately behind DEV; or a rebase pulled in a sibling's file
before you re-pushed. It is recoverable by definition, because the DDL is in git. A ledger row with no
file is **never** normal: the schema of a shared database contains a change that no checkout, no PR,
and no `db push` can reproduce. That asymmetry is the whole content of gotcha-57.

### The false positive that must be suppressed

This repo runs many concurrent worktrees against **one shared DEV database** (six were live while this
spec was written). A sibling session that applies migration `X` to DEV and commits the file on its own
unmerged `task/*` branch produces, in _my_ worktree, a ledger row with no file — indistinguishable from
gotcha-57 by set arithmetic alone. Without suppression, the check would hard-fail unrelated tasks
constantly and be disabled within a week.

Suppression rule: before classifying a ledger-only version as drift, scan the `supabase/migrations/`
directory of **every other live git worktree** (`git worktree list --porcelain`). A ledger-only version
whose file exists in a sibling worktree is reported as **"applied from a sibling worktree, not yet
merged"** — a warning, not drift. `new-migration.sh` already scans sibling worktrees for exactly this
class of interference; the new script mirrors that idiom deliberately.

What survives suppression is precisely gotcha-57: a ledger row with no file **anywhere on this
machine**.

### Exit-code contract

The script is the single source of truth; each call site chooses its own policy from the code.

| Code | Meaning                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------- |
| `0`  | in sync (warnings may have been printed)                                                                                   |
| `1`  | **local failure** — duplicate version prefix or malformed filename. No network needed, so this can never be "unavailable". |
| `2`  | **ledger drift** — one or more ledger-only versions survived suppression                                                   |
| `3`  | **check unavailable** — credentials absent, `psql` absent, or the database unreachable                                     |
| `4`  | usage error (bad flag)                                                                                                     |

This mirrors `scripts/watch-ci.sh`'s established convention of an exit code per outcome class rather
than a single pass/fail.

### Enforce vs. advisory, per call site

| Call site                   | Target ledger  | `1`   | `2` (drift) | `3` (unavailable)  |
| --------------------------- | -------------- | ----- | ----------- | ------------------ |
| `scripts/finish-task.sh`    | **DEV**        | block | **block**   | **warn, continue** |
| `/sync-prod` step 1b        | **DEV + PROD** | stop  | stop        | stop and ask       |
| `/promote` step 1 preflight | **DEV**        | stop  | stop        | note, continue     |

**`finish-task.sh` enforces drift.** It is the earliest moment at which an agent or human with the
relevant context is present, and the failure it prevents is a security regression. With sibling-worktree
suppression in place the residual false-positive rate is ~zero, so blocking is proportionate. The check
is placed where the existing gotcha-43 block lives — **before** `typecheck/lint/test/build` — so a drift
failure costs ~1.5s rather than a full build.

**`finish-task.sh` never blocks on unavailability.** Blocking a merge on a network call is how a gate
wedges every future task. Exit `3` prints a single loud, named warning and continues:

```
!! WARNING: could not verify the DEV migration ledger (<reason>).
   Migration/file drift was NOT checked (gotcha-57). Re-run manually when you have
   connectivity:  pnpm db:ledger-check
```

Degradation triggers, all of which resolve to exit `3`:

- `.env.prod.local` missing — **resolved from the main checkout**, not the worktree, because
  `start-task.sh` symlinks only `.env.local` and `DEV_SUPABASE_DB_URL` lives exclusively in
  `.env.prod.local`.
- `DEV_SUPABASE_DB_URL` (or `PROD_SUPABASE_DB_URL` for `--env prod`) unset or empty.
- `psql` not on `PATH` after honoring `PG_BIN` from `.env.prod.local` (same fallback `dump-dev.sh` uses).
- Connection or query failure. Bounded natively by libpq — `PGCONNECT_TIMEOUT=10` and
  `PGOPTIONS=-c statement_timeout=15000` — because `timeout(1)` does not exist on macOS.

One explicit escape hatch: `PULSE_SKIP_LEDGER_CHECK=1` makes the script print
`skipped by PULSE_SKIP_LEDGER_CHECK` and exit `0`. It exists so that a genuinely blocked finish has a
sanctioned, greppable bypass instead of an agent hand-editing `finish-task.sh` under pressure.

**`/sync-prod` checks both ledgers** and reframes its existing step 1. Today a non-empty DEV∖PROD
version set produces one instruction: `supabase db push`. That instruction is _wrong_ when any of those
versions has no committed file — `db push` reads files, so it silently cannot carry them, and the change
is lost on the way to production. Step 1 must therefore split its stop:

- DEV ahead, every missing version **has a file** → existing `db push` instruction, unchanged.
- DEV ahead, some missing version **has no file** → different hard stop: backfill the file at the
  ledger's version first (gotcha-57 recovery), never `db push`.

The PROD side matters more, not less: a PROD ledger row with no committed file is an unreproducible
production schema.

**`/promote` checks DEV, advisory on unavailability, stop on drift.** Promotion ships code, not schema —
but PROD's schema comes _only_ from committed files. Code that depends on uncommitted DEV DDL works in
dev and breaks in production. `/promote` runs from the main checkout where `.env.prod.local` is present,
so the check is reliable there.

### Recovery affordance

The script holds a live connection, so on drift it does the retrieval gotcha-57 prescribes rather than
telling a human to go do it. Default output names each drifted version plus the one-line recovery
command; `--show-ddl` fetches and prints the statements inline:

```sql
SELECT version, name, array_to_string(statements, E'\n') AS ddl
FROM supabase_migrations.schema_migrations WHERE version = '<v>';
```

Output ends by restating the sanctioned exception from gotcha-57: **backfill the file at the ledger's
version — do not mint a new stamp with `new-migration.sh`.**

### Reuse, not duplication

- The gotcha-43 duplicate-version guard **moves out of `finish-task.sh`** into the new script's offline
  phase (it needs no network). `finish-task.sh` calls the script once and gets both checks. One
  implementation, not two.
- `reconcile-migration-version.sh` keeps its file-exists precondition and its hard exit; only the error
  text changes, to route the no-file case to the new script. It remains the gotcha-55 (version-label)
  repair; the new script is the gotcha-57 (no-file) detector. Adjacent, non-overlapping.
- `new-migration.sh`'s echoed step 2 currently teaches a hand-typed
  `select version, name from supabase_migrations.schema_migrations …`. That becomes
  `pnpm db:ledger-check`.
- The sibling-worktree scan mirrors `new-migration.sh`'s
  `git worktree list --porcelain | sed -n 's/^worktree //p'` loop. Bash and Node cannot share it, so the
  duplication is acknowledged in a comment on both sides rather than pretended away.

### Language: Node, not Bash

The script is `scripts/check-migration-ledger.mjs`, run with plain `node` (zero dependencies:
`node:child_process` to spawn `psql`, `node:fs` to read the env file and the migrations dir).

This deviates from the `.sh` sibling scripts, and the reason is testability. AGENTS.md #4 makes tests
mandatory, and the repo has **exactly one** precedent for testing non-`src` tooling:
`.claude/hooks/maybe-write-session.mjs` exports pure functions and
`.claude/hooks/maybe-write-session.test.mjs` asserts them with `node:assert/strict` under the vitest
`unit` project. There is no bats, no shellcheck harness, and no test of any kind for any `scripts/*.sh`.
Following the one precedent that exists beats inventing a second harness for one script.

The logic that actually needs coverage is pure and non-trivial: version parsing, duplicate detection,
three-way classification with sibling suppression, `.env` parsing (Postgres URLs contain `=` inside
query strings and passwords, so a naive `split("=")` corrupts them), and the exit-code mapping. As a
Node module those are five exported functions with fixture inputs. As Bash they are untestable without
building a harness first.

`vitest.config.ts`'s existing `stripShebang` plugin is keyed on `id.endsWith(".mjs")`, not on path, so a
`scripts/` module with a `#!/usr/bin/env node` shebang is already handled — the trap that comment
documents is pre-solved.

### Explicitly out of scope

- **CI enforcement.** `.env.prod.local` is gitignored, so a CI variant needs `DEV_SUPABASE_DB_URL` as a
  repository secret. That is a separate decision (exposing a superuser DSN to Actions) and a separate
  task. The script is CI-ready — it reads the DSN from the environment when the env file is absent — but
  no workflow is wired in this change.
- **Auto-repair.** The script detects and prints recovery SQL. It never writes to the ledger and never
  creates migration files. Backfilling is a judgement call about DDL correctness.
- **Statement-level comparison** between a ledger row and its file. Supabase strips comments and
  re-normalizes whitespace, so hashes never match even for identical DDL — `reconcile-migration-version.sh`
  already documents this. Version-set comparison only.
- **Auditing the other definer functions** added around 2026-07-24 for the same missed ACL. That is the
  ADR's other open follow-up and is being handled by a separate task.

## Independent units (for the plan's DAG)

1. **The script + its tests + wiring into `package.json` and `vitest.config.ts`** — foundation;
   everything else consumes its name and exit codes.
2. **`finish-task.sh` integration** — replace the inline gotcha-43 block with a call plus exit-code policy.
3. **Command-doc updates** — `sync-prod.md` step 1/1b, `promote.md` step 1.
4. **Sibling-script and reference-doc pointers** — `reconcile-migration-version.sh` error text,
   `new-migration.sh` echoed steps, `CONTRIBUTING.md`, `AGENTS.md`.
5. **Vault closeout** — gotcha index entry for 57, ADR consequences.

Units 2, 3 and 4 touch disjoint files and consume only unit 1's interface, so they are one parallel batch.

## Performance & data-fetching budget (working agreement #5)

**No UI, no RSC, no client state — (a), (b) and (c) of the budget do not apply.** The developer-tooling
equivalents, which do:

- **Exactly one network round-trip per invocation**, per target ledger: a single
  `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version` over a text primary key
  on a ~111-row table. No retries, no polling, no second query unless `--show-ddl` is passed (then one
  more, for the drifted versions only).
- **Measured cost:** 1.19s / 1.27s / 1.41s over three cold `psql` invocations against DEV from this
  machine. `finish-task.sh` already spends minutes in `pnpm install` + four gates, so the marginal cost
  is under 1%.
- **Bounded:** `PGCONNECT_TIMEOUT=10`, `statement_timeout=15000`. Worst case adds ~10s and degrades to
  exit `3` — it cannot hang a finish.
- **Fail-fast placement:** before `typecheck/lint/test/build`, so a caught drift costs seconds.
- **Offline checks run unconditionally**, before any connection attempt, so duplicate-version detection
  (the current gotcha-43 guard) never regresses when the network is down.

## Testing

Vitest `unit` project, extended to include `scripts/**/*.test.mjs`. Pure functions exported from
`scripts/check-migration-ledger.mjs`, asserted with `node:assert/strict`, following
`.claude/hooks/maybe-write-session.test.mjs` exactly. No live database in the test suite — the DB read is
the one impure boundary and is exercised by the manual verification path below.

Coverage:

- `parseVersionsFromFilenames` — accepts `<14-digit>_<slug>.sql`; ignores `.md`/dotfiles/non-14-digit
  prefixes; preserves duplicates so the next function can see them.
- `findDuplicateVersions` — reproduces the gotcha-43 case (two files, one version prefix); empty for a
  clean list. Guards the behavior being moved out of `finish-task.sh`.
- `classifyLedger` — clean sets; ledger-only → `drift`; file-only → `pending`; ledger-only present in a
  sibling worktree → `pendingElsewhere`, **not** drift; mixed input classified independently.
- `parseEnvFile` — `KEY=value`; single/double-quoted values; `#` comments; blank lines; `export KEY=`
  prefix; and critically a value containing `=` (`postgresql://u:p=q@h/db?sslmode=require`) split on the
  **first** `=` only.
- `exitCodeFor` — the full mapping: clean → 0, duplicates → 1, drift → 2, unavailable → 3, duplicates
  **and** drift → 1 (local failure reported first, since it needs no network to fix).

Plus the four repo gates (`typecheck / lint / test / build`) — the new file must satisfy ESLint's config
for `.mjs` and must not break the vitest include change.

## How to test (developer verification path)

Not user-observable — no page, no route, no UI. The acceptance path is a deliberate DEV ledger drift,
proven caught, then cleaned up. Full numbered walkthrough is in the plan's "How to test" section.

## Risks

- **Sibling suppression hides real drift** if the drifting session's worktree still exists with the file
  committed but never merged. Accepted: that state _is_ recoverable (the DDL is in git), which is the
  line this design draws. The warning still names the version and the worktree.
- **`.env.prod.local` drifts out of the main checkout** and every invocation degrades to exit `3`
  forever, silently re-opening the gap. Mitigated by the warning being loud and named; a CI variant
  (out of scope) would close it properly.
- **`PULSE_SKIP_LEDGER_CHECK` becomes habitual.** Mitigated by it printing its own name on every use, so
  it is greppable in transcripts.
