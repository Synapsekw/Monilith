---
type: session
date: 2026-06-26-1014
branch: develop
trigger: wrapup
status: complete
tags: [session, testing, flake]
related: []
---

# Integration-test flake root-cause fix

## What changed

- Age-gated `src/test/global-teardown.ts`: new pure `selectPurgeableUserIds(users, now, minAgeMs)` only purges `@example.com` users older than `PURGE_MIN_AGE_MS` (30 min), so a concurrent worktree's end-of-run sweep can't cascade-delete another run's in-flight org→board→group. Unit-tested cloud-free (`global-teardown.test.ts`).
- Added `signInOrThrow()` to `src/test/integration-auth.ts` — provisioning sign-ins that exhaust the 429 backoff now throw loud instead of running silently unauthenticated; migrated into the 4 observed-flaky automations suites (5b1/5b2/5c1/5c2). Unit-tested.
- Fixed a _deterministic_ bug surfaced en route: 5b1's "does not move a subitem" test inserted via the service-role `admin` client; `items.created_by` auto-fills `auth.uid()` and isn't client-insertable, so admin left it NULL → 23502 every run. Now inserts as the authenticated actor (`userAAnon`), per the canonical subitems pattern.
- Merged to `develop` as `56180fb` (commits `539c39e`, `ac09922`, `3c43765`, `a148a17` + spec/plan). Full `pnpm test` gate (integration included) passed.

## Why

`finish-task.sh` gates every merge on the full `pnpm test`, and CI skips the live-DB integration suites — so this gate was the only one running them, yet it flaked non-deterministically and blocked sound work. The dominant cause was cross-worktree teardown contention on the shared cloud dev DB; "the flake" also masked a separate deterministic `created_by` bug. Fix makes the gate trustworthy rather than bypassing it.

## How to test (for the user)

No user-facing behavior to test — verified by the test suite (`5b1` passes 22/22 alone; full gate green at merge).

## Open threads

- Other live worktrees (`item-creation-metadata`, `sidebar-share-icons`, `streaming-shell-9-2`) were cut before `56180fb` and still carry the old by-suffix teardown. Each must `git rebase origin/develop` before resuming integration runs, or it keeps purging shared data for everyone. `item-creation-metadata` was caught doing this live.
- Part B (`signInOrThrow`) migrated only the 4 flaky suites; ~16 other suites still discard `signInWithRetry`'s result (sanctioned lazy migration, not a defect).

## Next session entry point

Flake gate is fixed and green on `develop`. If integration flake recurs, first check for a concurrent worktree running `--project integration` against the shared cloud DB before trusting any run-alone diagnostic.
