# Integration-test Flake Root-Cause Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `*.integration.test.ts` suites from flaking under concurrent cross-worktree runs, so `finish-task.sh`'s full `pnpm test` gate becomes trustworthy instead of a coin-flip.

**Architecture:** Two independent test-infra changes. (A) Age-gate `global-teardown.ts` so its end-of-run purge only deletes `@example.com` users older than 30 min — a concurrent run's fresh users are never cascade-deleted. (B) Add a `signInOrThrow` helper that turns an exhausted-retry (still-errored) sign-in into a loud, immediate throw, and migrate the four observed-flaky automations suites to it. `finish-task.sh` is unchanged.

**Tech Stack:** TypeScript (strict), Vitest 4 (two projects: `unit` parallel, `integration` serial), Supabase JS service-role admin client.

## Global Constraints

- TypeScript strict; avoid `any` (use `as unknown as T` casts in tests when stubbing).
- Test password literal across these suites: `Test-Password-123!` (already defined per-file as `PASSWORD`).
- Test users use `@example.com` emails; suffix match is case-insensitive.
- New unit tests must live in the `unit` Vitest project (filename `*.test.ts`, NOT `*.integration.test.ts`) so they run cloud-free.
- Commit identity is pinned by `start-task.sh`; commit subjects lowercase after `type(scope):`, with a body + `Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>` trailer. Stage by explicit path — never `git add -A`.
- Threshold constant: `PURGE_MIN_AGE_MS = 30 * 60 * 1000`.

---

### Task 1: Age-gate the teardown purge

**Files:**

- Modify: `src/test/global-teardown.ts` (add exported `selectPurgeableUserIds`, add `PURGE_MIN_AGE_MS`, rewire user collection)
- Test: `src/test/global-teardown.test.ts` (new, unit project)

**Interfaces:**

- Produces: `selectPurgeableUserIds(users: PurgeCandidate[], nowMs: number, minAgeMs: number): string[]` where `type PurgeCandidate = { id: string; email: string | null | undefined; created_at: string }`. Returns ids of users whose email ends with `@example.com` (case-insensitive) AND whose `created_at` is at least `minAgeMs` older than `nowMs`. Users with an unparseable `created_at` are excluded (never purged).
- Produces: `PURGE_MIN_AGE_MS` constant.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `src/test/global-teardown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectPurgeableUserIds } from "@/test/global-teardown";

const NOW = 1_700_000_000_000; // fixed epoch ms for deterministic ages
const MIN_AGE = 30 * 60 * 1000; // 30 min

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

describe("selectPurgeableUserIds", () => {
  it("purges example.com users older than the threshold", () => {
    const users = [
      { id: "old", email: "a@example.com", created_at: iso(MIN_AGE + 1) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual(["old"]);
  });

  it("spares example.com users newer than the threshold (a concurrent run)", () => {
    const users = [
      { id: "fresh", email: "b@example.com", created_at: iso(MIN_AGE - 1) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual([]);
  });

  it("treats exactly-at-threshold as purgeable", () => {
    const users = [
      { id: "edge", email: "c@example.com", created_at: iso(MIN_AGE) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual(["edge"]);
  });

  it("excludes non-example.com emails regardless of age", () => {
    const users = [
      { id: "real", email: "user@acme.com", created_at: iso(MIN_AGE * 10) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual([]);
  });

  it("matches the suffix case-insensitively", () => {
    const users = [
      { id: "upper", email: "D@Example.Com", created_at: iso(MIN_AGE + 1) },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual(["upper"]);
  });

  it("skips users with missing or unparseable created_at", () => {
    const users = [
      { id: "noemail", email: undefined, created_at: iso(MIN_AGE + 1) },
      { id: "badts", email: "e@example.com", created_at: "not-a-date" },
    ];
    expect(selectPurgeableUserIds(users, NOW, MIN_AGE)).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(selectPurgeableUserIds([], NOW, MIN_AGE)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/test/global-teardown.test.ts`
Expected: FAIL — `selectPurgeableUserIds` is not exported / not a function.

- [ ] **Step 3: Add the selector and constant to `global-teardown.ts`**

In `src/test/global-teardown.ts`, just below the existing `const EXAMPLE_SUFFIX = "@example.com";` line, add:

```ts
// global-teardown is the cross-run leak-sweeper; per-suite afterAll already
// removes same-run data. Because every worktree's `pnpm test` shares ONE cloud
// dev project, an unscoped suffix purge cascade-deletes a *concurrent* run's
// in-flight org → board → group (the P0002 "group not found" flake). Only sweep
// users old enough that no live run could still own them; true orphans from a
// crashed run age past this and get collected by the next run.
export const PURGE_MIN_AGE_MS = 30 * 60 * 1000; // 30 min

export type PurgeCandidate = {
  id: string;
  email: string | null | undefined;
  created_at: string;
};

export function selectPurgeableUserIds(
  users: PurgeCandidate[],
  nowMs: number,
  minAgeMs: number,
): string[] {
  const ids: string[] = [];
  for (const u of users) {
    if (!u.email?.toLowerCase().endsWith(EXAMPLE_SUFFIX)) continue;
    const createdMs = Date.parse(u.created_at);
    if (Number.isNaN(createdMs)) continue; // unknown age → never purge
    if (nowMs - createdMs >= minAgeMs) ids.push(u.id);
  }
  return ids;
}
```

- [ ] **Step 4: Rewire `teardown()` to use the selector**

In `src/test/global-teardown.ts`, replace the user-collection block (the
`const userIds: string[] = [];` loop that pushes `u.id` when the email matches
the suffix, ending at the `if (userIds.length === 0) return;` line) with the
version below. The change: collect full candidate records, then filter through
`selectPurgeableUserIds`.

```ts
// Collect every test user (id + email + created_at), paginating until a short page.
const candidates: PurgeCandidate[] = [];
for (let page = 1; page <= MAX_PAGES; page++) {
  const { data, error } = await admin.auth.admin.listUsers({
    page,
    perPage: LIST_PER_PAGE,
  });
  if (error) {
    console.warn(
      `[global-teardown] listUsers page ${page} failed: ${error.message}`,
    );
    break;
  }
  const users = data?.users ?? [];
  for (const u of users) {
    candidates.push({ id: u.id, email: u.email, created_at: u.created_at });
  }
  if (users.length < LIST_PER_PAGE) break;
}

// Age-gate: only purge users old enough that no concurrent run still owns them.
const userIds = selectPurgeableUserIds(
  candidates,
  Date.now(),
  PURGE_MIN_AGE_MS,
);

if (userIds.length === 0) return;
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `pnpm vitest run --project unit src/test/global-teardown.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck the changed file's project**

Run: `pnpm typecheck`
Expected: PASS — no `any`, `PurgeCandidate` lines up with the `listUsers` user shape (`email: string | undefined`, `created_at: string`).

- [ ] **Step 7: Commit**

```bash
git add src/test/global-teardown.ts src/test/global-teardown.test.ts
git commit -F - <<'EOF'
fix(test): age-gate global-teardown to stop cross-run cascade deletes

global-teardown swept every @example.com user by suffix, so a concurrent
worktree's end-of-run purge cascade-deleted another run's in-flight
org/board/group (the P0002 "group not found" integration flake). Extract a
pure selectPurgeableUserIds that only returns users older than
PURGE_MIN_AGE_MS (30 min); fresh users owned by a live run are spared, real
orphans still age out and get swept by the next run. Unit-tested cloud-free.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>
EOF
```

---

### Task 2: Add the `signInOrThrow` helper

**Files:**

- Modify: `src/test/integration-auth.ts` (add `signInOrThrow` below `signInWithRetry`)
- Test: `src/test/integration-auth.test.ts` (new, unit project)

**Interfaces:**

- Consumes: existing `signInWithRetry(client, credentials, maxAttempts?)` and the file's local `AuthCapable` type.
- Produces: `signInOrThrow(client: AuthCapable, credentials: { email: string; password: string }, label?: string): Promise<void>` — calls `signInWithRetry`, throws `Error("sign-in failed for <label-or-email>: <message>")` when the result still carries an error, otherwise resolves.

- [ ] **Step 1: Write the failing test**

Create `src/test/integration-auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";

// Minimal structural stub of the GoTrue surface signInWithRetry touches.
function stubClient(result: {
  error: { message: string; status?: number } | null;
}) {
  return {
    auth: { signInWithPassword: async () => result },
  } as unknown as Parameters<typeof signInOrThrow>[0];
}

describe("signInOrThrow", () => {
  it("throws a labelled error when sign-in still fails", async () => {
    const client = stubClient({ error: { message: "bad creds", status: 400 } });
    await expect(
      signInOrThrow(client, { email: "a@example.com", password: "x" }, "userA"),
    ).rejects.toThrow("sign-in failed for userA: bad creds");
  });

  it("falls back to the email when no label is given", async () => {
    const client = stubClient({ error: { message: "boom", status: 400 } });
    await expect(
      signInOrThrow(client, { email: "a@example.com", password: "x" }),
    ).rejects.toThrow("sign-in failed for a@example.com: boom");
  });

  it("resolves with no value on success", async () => {
    const client = stubClient({ error: null });
    await expect(
      signInOrThrow(client, { email: "a@example.com", password: "x" }, "userA"),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/test/integration-auth.test.ts`
Expected: FAIL — `signInOrThrow` is not exported.

- [ ] **Step 3: Implement `signInOrThrow`**

Append to `src/test/integration-auth.ts` (after `signInWithRetry`):

```ts
/**
 * Provisioning-grade sign-in: rides out 429s via signInWithRetry, then THROWS
 * if the client is still unauthenticated. The bare signInWithRetry call-sites
 * discarded the error, so an exhausted backoff yielded a silently-unauthenticated
 * client whose create_organization returned null — surfacing far away as a
 * confusing NPE. Throwing here fails loud + immediate; the integration project's
 * `retry: 1` then gives the file one clean re-run.
 */
export async function signInOrThrow(
  client: AuthCapable,
  credentials: { email: string; password: string },
  label?: string,
): Promise<void> {
  const { error } = await signInWithRetry(client, credentials);
  if (error) {
    throw new Error(
      `sign-in failed for ${label ?? credentials.email}: ${error.message}`,
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/test/integration-auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/test/integration-auth.ts src/test/integration-auth.test.ts
git commit -F - <<'EOF'
feat(test): add signInOrThrow for loud provisioning sign-in

signInWithRetry call-sites discarded the result, so an exhausted 429 backoff
produced a silently-unauthenticated client and a later null-org NPE.
signInOrThrow wraps it and throws a labelled error on residual failure, so
provisioning fails fast and the integration project's retry:1 re-runs the
file. Unit-tested with a structural client stub.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>
EOF
```

---

### Task 3: Migrate the four flaky suites to `signInOrThrow`

**Files:**

- Modify: `src/lib/boards/automations.engine.5b1.integration.test.ts` (import line 27; calls at 121, 297)
- Modify: `src/lib/boards/automations.5b2.engine.integration.test.ts` (import line 21; call at 94)
- Modify: `src/lib/boards/automations.5c1.runhistory.integration.test.ts` (import line 21; calls at 95, 167)
- Modify: `src/lib/boards/automations.5c2.webhook.integration.test.ts` (import line 21; calls at 93, 163, 203)

**Interfaces:**

- Consumes: `signInOrThrow` from Task 2.
- Produces: nothing for later tasks.

**Depends on:** Task 2 (the helper must exist).

Each call-site is the uniform pattern
`await signInWithRetry(<client>, { email: <emailVar>, password: PASSWORD });`.
Migration = swap the function name and pass the client's email var as the label.

- [ ] **Step 1: Update the import in each of the four files**

In each file, change the import line from:

```ts
import { signInWithRetry } from "@/test/integration-auth";
```

to:

```ts
import { signInOrThrow } from "@/test/integration-auth";
```

- [ ] **Step 2: Replace each provisioning call**

Replace every occurrence of this shape (the brace indentation varies between
files — keep the file's existing indentation):

```ts
await signInWithRetry(userAAnon, {
  email: emailA,
  password: PASSWORD,
});
```

with the `signInOrThrow` form, passing the email var as the label:

```ts
await signInOrThrow(userAAnon, { email: emailA, password: PASSWORD }, emailA);
```

Apply to all call-sites:

- `5b1`: `userAAnon`/`emailA` (line ~121), `userBAnon`/`emailB` (line ~297)
- `5b2`: `userAAnon`/`emailA` (line ~94)
- `5c1`: `userAAnon`/`emailA` (line ~95), `userBAnon`/`emailB` (line ~167)
- `5c2`: `userAAnon`/`emailA` (line ~93), `userMAnon`/`emailM` (line ~163), `userBAnon`/`emailB` (line ~203)

- [ ] **Step 3: Verify no stale `signInWithRetry` references remain in these four files**

Run: `grep -rn "signInWithRetry" src/lib/boards/automations.engine.5b1.integration.test.ts src/lib/boards/automations.5b2.engine.integration.test.ts src/lib/boards/automations.5c1.runhistory.integration.test.ts src/lib/boards/automations.5c2.webhook.integration.test.ts`
Expected: no output (all migrated).

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS — `signInOrThrow` is imported and used in each file; no unused-import error for the dropped `signInWithRetry`.

- [ ] **Step 5: (Optional, cloud) Run one migrated suite in isolation**

The worktree has `.env.local` symlinked, so the integration project can run.
Run: `pnpm vitest run --project integration src/lib/boards/automations.engine.5b1.integration.test.ts`
Expected: PASS in isolation (the memory's decisive diagnostic — passes-alone ⇒ environment-only flake is gone for this path). Skip if offline.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/automations.engine.5b1.integration.test.ts \
  src/lib/boards/automations.5b2.engine.integration.test.ts \
  src/lib/boards/automations.5c1.runhistory.integration.test.ts \
  src/lib/boards/automations.5c2.webhook.integration.test.ts
git commit -F - <<'EOF'
fix(test): use signInOrThrow in the flaky automations suites

The four automations integration suites observed flaking discarded
signInWithRetry's result, so an exhausted 429 backoff ran provisioning
unauthenticated and failed later as a null-org NPE. Switch their beforeAll
sign-ins to signInOrThrow so an auth failure throws immediately and the
integration retry re-runs the file.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>
EOF
```

---

## Final Verification (before finish-task)

- [ ] Run the full gate from inside the worktree: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: all green. The `integration` project is network-bound; if it flakes on an _unrelated_ suite, apply the memory's decisive diagnostic (run that suite alone) before assuming a regression.
- [ ] Close with `scripts/finish-task.sh` (rebase onto develop, gate, merge, push, clean up).

## Execution DAG

- **Task 1** (age-gate teardown) — independent.
- **Task 2** (`signInOrThrow` helper) — independent.
- **Task 3** (migrate suites) — depends on Task 2.

Parallel batch 1: {Task 1, Task 2}. Batch 2: {Task 3}. Critical path: Task 2 → Task 3. Tasks 1 and 2 touch disjoint files, so they can run concurrently without worktree conflict.
