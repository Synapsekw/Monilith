---
type: session
status: complete
date: 2026-08-04
time: "21:40"
branch: task/carryover-repairs → develop @ c04dfce9
tags: [project/monolith, session, tooling, ai-write, verification]
related:
  - "[[00-north-star]]"
  - "[[2026-08-04-gotcha-75-a-zero-row-repair-reports-success]]"
  - "[[2026-08-04-1907-promote-and-ai-write-followups]]"
---

# Carryover repairs — the tooling that lied, and the two prod claims that were stale

A `/whats-next` triage that turned into closing the carryover instead of scoping new work.
Three tooling repairs shipped; three "owed" claims re-tested against reality, two of which were
no longer true.

## What shipped (`c04dfce9`, 3 commits, 4 gates green)

**1. `reconcile-migration-version.sh` no longer prints a repair that does nothing.**
The emitted `UPDATE` filtered on `name = '<slug>'`. The root cause is sharper than "the ledger
stores the filename": `supabase_migrations.schema_migrations.name` has **two** legitimate forms,
measured on DEV —

| form                | rows | written by             |
| ------------------- | ---- | ---------------------- |
| `<slug>`            | 100  | Supabase CLI `db push` |
| `<version>_<slug>`  | 31   | MCP `apply_migration`  |

— and this script only ever runs against the **MCP** kind, while it derived the **CLI** form. So the
predicate matched zero rows on every invocation it will ever have. It now keys on `version` alone
(the primary key; STEP 1 already proves identity) and `RETURNING version, name` makes an empty
repair visible. A new STEP 4 makes `pnpm db:ledger-check` mandatory, since that is the only thing
that ever caught the no-op.

**2. `finish-task.sh` stops deleting committed drafts.** Its `rm -f _draft-*.md` ran before the
clean-tree check and took tracked files with it — dirtying the tree and failing the very check
below it, for every session in the repo. Extracted to `scripts/clear-untracked-drafts.sh`, which
removes only what `git ls-files --others --exclude-standard` reports.

**3. `finish-task.sh` sweeps vitest that outlived the gates.** It could finish with workers still
alive against the **live DEV** project. `scripts/sweep-orphaned-vitest.sh` is scoped by
**measurement, not assumption**: on macOS / pnpm 10 / vitest 4 the runner and all 8 workers carry
the worktree's absolute `node_modules` path in their argv, so a sibling worktree's concurrent run
is provably untouched. Wiring detail that matters — the EXIT trap alone is **wrong**, because
step 5 removes the worktree and the sweep script with it. The trap covers abnormal exits; the
success path sweeps explicitly, after the gates, while `$WT` still exists.

**4. `resolveCreateItem` stops asserting a cause it can't tell apart.** `getBoardPayload` excludes
archived groups, so "That group isn't on this board." was a claim the resolver cannot support.
`resolveMoveItem` was fixed for exactly this; create was left behind. The old test only asserted
`kind === "error"`, so the wording was unpinned — it is now.

## The discipline that made this worth trusting

Every new guard was **mutation-tested before landing**: the old code was restored under the new
tests, and **7 of 15 assertions went red** — the 2 reconcile ones, the 2 draft ones, the 3 sweep
ones — while the other 8 correctly stayed green. That is the direct answer to
[[2026-08-03-gotcha-72-a-global-regex-with-test-makes-a-guard-silently-blind]]: a guard you have
never seen fail is not a guard. All three script tests are **behavioural** — a temp git repo, real
spawned processes, real script stdout — not regexes over the scripts' source.

## Two "owed" claims were stale, and one was sharpened

- **`digest_secret`'s halves match.** Proven without reading either secret: `digest_runs` holds
  22 rows on 08-02 and 22 on 08-03 with status `sent`/`skipped`, and a mismatched secret 401s and
  writes **no row at all**. The lone `blocked` row (07-28) predates `DIGEST_SECRET` reaching Vercel
  (~08-01) and is the *absent* case — the only one the route records. Attempting the "obvious"
  check first (pull both, compare hashes) was blocked as secret-handling, which was the right
  outcome: the end-to-end evidence is strictly better and needs no secret at all.
- **The Ask write path is exercised.** 2026-08-04 13:54:47 UTC, an approved proposal moved
  `QYSEA (ROV)` Robotics → Software: an `item_moved` row in `item_activities` matching the "Done"
  outcome turn to the millisecond, manually reverted 18s later. The same conversation is a clean
  fossil record of the whole gotcha-73 arc — 10:26 *"I don't have a tool that can move an item"*,
  11:45 *"none of my tools returned the item's internal ID"*, 13:54 done.
  **But it ran through a `develop` build, not the deployment** — the item-ids fix is not on `main`,
  so on prod the model still cannot reach `move_item`.
- **`RESEND_API_KEY` really is absent** from Vercel production (which holds only `DIGEST_SECRET`,
  `AI_PGNET_HMAC_SECRET`, `OPENAI_EMBEDDING_API_KEY`, `ANTHROPIC_API_KEY` + the three Supabase
  vars). A run recorded as `ran` with no email is expected, not a fault.
- **The four stale `task/*` remote branches were already gone.** `git branch -r` shows none. The
  Owed entry had outlived its cleanup. Origin *does* carry 8 dependabot branches nothing tracked.

## A tool-shaped trap worth remembering

`net._http_response` **self-prunes** — it held a single row, minutes old, when checked. It answers
*"is this cron failing right now?"*, never *"did it fail last week?"*. §3 recommended it as the
first place to look, which is right for a live incident and useless for a retrospective. Durable
history lives in `digest_runs`, `item_activities`, `user_agent_runs`.

Also: the first attempt to prove the write path counted `tool_trace` keys like `executed` — and got
0, which reads as "never ran". The trace shape is `{proposedActions, boardsConsulted}` and carries
**no** execution field; approve/cancel append a **separate outcome turn**, because `ai_messages`
has no UPDATE policy. Guessing the schema of the thing you are measuring is the same blind-guard
failure one level up.

## How to test

**No user-facing behaviour changed** — the three script fixes are developer tooling, and the fourth
is a refusal message the model relays only when a group id is stale. Verified by the suite (25 new
assertions) and by `finish-task.sh` running its own repaired code to merge this branch.

To see the tooling fixes for yourself:

1. `pnpm test scripts/` — 15 script assertions green.
2. `scripts/reconcile-migration-version.sh 20200101000000 <newest-migration.sql>` — STEP 2 keys on
   `version` alone, carries `RETURNING`, and STEP 4 demands `pnpm db:ledger-check`.
3. `touch vault/sessions/_draft-x.md && scripts/clear-untracked-drafts.sh` — removed. Commit one
   first and it survives.

## Open threads

- **`/promote` is now the gate on two things**, not one: the three AI-write follow-ups, and the AI
  write path being reachable on the *deployment* rather than only on `develop`.
- **Report Builder v2 has no spec and no plan** — the charts spec (`2026-07-26-…-charts-design.md`
  L31-35, L534-539) explicitly defers roll-ups and org templates. It is named the critical path
  everywhere but has never been scoped; it is not a "start building" task yet.
- **The migration/`database.types.ts` regen is the real concurrency limit.** Report Builder v2,
  Personal Agents Phase 2's remainder, and F17 each add a migration; only one can be in flight.
  E6 Stripe needs **no** migration, which is what makes it the safe partner for a parallel batch.
- `e2e/ai-write-visibility.spec.ts` is still **never executed** — it needs a live model and
  `E2E_AI_WRITES=1`. The 13:54 move above is the manual equivalent, not the automated proof.
- 8 dependabot branches unmerged; the npm ones contend with E6's Stripe SDK over the lockfile.

## Next session entry point

**`/promote`.** After that the choice is unchanged — **Report Builder v2** (which needs
`brainstorming` → `writing-plans` first, since nothing is written) or the **E6 Stripe track**
(spec exists, needs a plan, no migration).
