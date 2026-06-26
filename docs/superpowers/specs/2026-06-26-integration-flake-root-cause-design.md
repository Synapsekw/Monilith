# Integration-test flake — root-cause fix

**Date:** 2026-06-26
**Status:** Approved design, ready for plan
**Scope:** test infrastructure only — no app/runtime behavior changes

## Problem

`scripts/finish-task.sh` gates every merge on the full `pnpm test`, which runs both
the `unit` and `integration` Vitest projects. The `*.integration.test.ts` suites hit
one **shared** cloud dev Supabase project and flake non-deterministically (e.g.
`automations.engine.5b1` failing with `create_item` → P0002 "group not found", or a
`created_by` NULL violation). Because the suites `skipIf(!SERVICE_ROLE_KEY)`, **CI
skips them** — `finish-task` is the _only_ gate that runs them, so the flake blocks
otherwise-sound merges, while still being the only guard against a real integration
regression landing on `develop`.

The flake is environmental, not a code regression. Two root causes:

### Cause 1 (dominant) — cross-run teardown contention

`src/test/global-teardown.ts` runs once after a `pnpm test` run and purges **every**
`@example.com` user and their orgs, matched only by email suffix. Per-suite `afterAll`
hooks already clean up same-run data; `global-teardown` is only a leak-sweeper for
crashed runs.

Multiple worktrees run `pnpm test` concurrently against **one** shared cloud dev
project. So worktree B's end-of-run teardown cascade-deletes worktree A's _in-flight_
org → board → group, surfacing as P0002 / NULL violations in A. The org cascade is the
"group not found" signature.

### Cause 2 (secondary) — silent auth failure

~20 provisioning blocks call `await signInWithRetry(...)` and **discard the result**.
When the 429 backoff is exhausted, the returned (still-errored) client is used
unauthenticated; `create_organization` then returns `null`, blowing up later as a
confusing NPE instead of a clear, immediate failure.

## Goals

- `finish-task.sh` stays as-is — full `pnpm test`, integration included. Make the gate
  **trustworthy**, do not bypass it.
- Eliminate cross-run cascade deletion.
- Turn silent unauth into a loud, immediate, retryable failure.
- Net-new logic is unit-testable without the cloud.

## Non-goals

- No change to `finish-task.sh`.
- No migration of _all_ suites' auth handling (lazy migration — see Part B).
- No run-id email embedding (rejected: ~20-suite churn + new-suite footgun).

## Design

### Part A — Age-gate the teardown sweep

Only purge test users whose `created_at` is older than a threshold (`PURGE_MIN_AGE_MS`,
30 min). Concurrent runs' users are always recent, so a sibling teardown can never touch
them; genuine orphans age past the threshold and get swept by the next run.

- **One file changes:** `src/test/global-teardown.ts`.
- **Robust by construction:** no per-suite changes; a new suite cannot reintroduce the
  global-purge bug.
- **Cost:** a run's _own_ leaked users wait up to ~30 min for the next run's sweep —
  harmless for throwaway `@example.com` data.

**Isolation for testing:** extract a pure selector

```ts
// returns the ids of users old enough to purge
selectPurgeableUserIds(
  users: { id: string; email: string | undefined; created_at: string }[],
  nowMs: number,
  minAgeMs: number,
): string[]
```

`teardown` wires it to `listUsers()` + the current time. The selector encodes both the
`@example.com` suffix filter and the age gate, so it is fully unit-testable with no cloud.

### Part B — `signInOrThrow` helper, migrated lazily

Add to `src/test/integration-auth.ts`:

```ts
// Wraps signInWithRetry; throws a descriptive error when the result still
// carries an error after retries, so provisioning fails loud + immediate.
signInOrThrow(client, credentials, label?): Promise<void>
```

On a residual error it throws `sign-in failed for <label>: <message>`. The integration
project's `retry: 1` then gives the file one clean re-run.

**Lazy migration scope (this PR):** the four suites actually observed flaking —
`automations.engine.5b1`, `automations.5b2.engine`, `automations.5c1.runhistory`,
`automations.5c2.webhook`. Replace their result-discarding `await signInWithRetry(...)`
provisioning calls with `await signInOrThrow(...)`. Other suites are migrated
opportunistically later; `signInWithRetry` remains for callers that want the raw result.

## Testing

New unit tests (run in the `unit` project, no cloud):

- `selectPurgeableUserIds`: age boundary (just-under vs just-over threshold), mixed
  ages, non-`@example.com` emails excluded, missing/undefined email handled, empty input.
- `signInOrThrow`: throws on errored result (message includes label); resolves on success.

Plus: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green, and the four
migrated integration suites still pass in isolation.

## Execution DAG

Small task; tasks are mostly independent:

- **Task 1** — `selectPurgeableUserIds` + its unit test; wire into `global-teardown.ts`. (Part A)
- **Task 2** — `signInOrThrow` + its unit test in `integration-auth.ts`. (Part B helper)
- **Task 3** — migrate the four flaky suites to `signInOrThrow`. **Depends on Task 2.**

Parallel batch 1: {Task 1, Task 2}. Batch 2: {Task 3}. Critical path: Task 2 → Task 3.

## Performance & data-fetching budget

N/A — no UI, no server-data reads. Test-infra change only.
