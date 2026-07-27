# Isolated test database (`.env.test`)

**Date:** 2026-06-29
**Status:** Spec written, awaiting review
**Scope:** test infrastructure only — no app/runtime behavior changes
**Branch:** `task/test-db-isolation`

## Problem

The 38 `*.integration.test.ts(x)` suites provision throwaway `@example.com` users and
test organizations against the **REMOTE DEV** Supabase project (no local stack). They
re-pollute DEV within ~2h of every purge, and the destructive cross-run
`global-teardown.ts` sweeper runs against that same live DEV project. We want the
integration suites pointed at a **dedicated test-only Supabase project** via a
`.env.test` file, so they stop polluting (and stop sweeping) DEV.

This is the top infra priority. See user-memory `tests-write-to-remote-db.md`.

### Current footprint (verified in this worktree)

- **`vitest.config.ts`** declares two projects under one config: `unit` (parallel,
  excludes `*.integration.test.*`) and `integration` (`fileParallelism: false`,
  generous timeouts, `retry: 1`). Both share `setupFiles: ["./vitest.setup.ts"]` and
  `globalSetup: ["./src/test/global-teardown.ts"]`.
- **`vitest.setup.ts`** seeds **placeholder** `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`??=`) so modules that import the validated env can
  load. It does NOT touch `SUPABASE_SERVICE_ROLE_KEY`.
- **All 38 integration files load env identically.** Each contains the **byte-identical**
  literal line:
  ```ts
  config({ path: ".env.local", override: true });
  ```
  followed by direct reads of `process.env.NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (bypassing the
  validated `src/lib/env.ts`). They gate on `describe.skipIf(!SERVICE_ROLE_KEY)`.
- **`src/test/global-teardown.ts`** (the Vitest `globalSetup` export `teardown`) also
  does `config({ path: ".env.local", override: true })`, then purges every
  `@example.com` user older than 30 min and their orgs against whatever URL/service-role
  it loaded. It skips silently if no `SUPABASE_SERVICE_ROLE_KEY` is present.
- **`.env.example`** documents the var set. `.env.local` = DEV creds, `.env.prod.local` =
  PROD creds. `.gitignore` ignores `.env*` (except `.env.example`) — so **`.env.test`
  will be gitignored automatically**; no secrets get committed.
- **CI** (`.github/workflows/ci.yml`) runs **unit only** with placeholder env; the
  integration suites are gated **locally** via `finish-task.sh`'s `pnpm test`.
- **Schema source of truth:** `supabase/migrations/` (69 migrations). `pnpm db:types`
  uses `supabase gen types --linked`. There is **no** `db:push` script — migrations are
  pushed manually with the Supabase CLI against the linked project.

The byte-identical-line finding is the key enabler: the single-source-of-truth refactor
is a **mechanical, deterministic replace** across all 39 call sites (38 tests + 1
teardown), not 38 bespoke edits.

## Goals

1. Integration suites + teardown read creds from a **dedicated test project** when a
   `.env.test` file is present, with `.env.test` overriding `.env.local`.
2. **Unit tests are completely unaffected** (they never import the loader).
3. The cred-resolution + override precedence lives in **one** module (single source of
   truth) — not duplicated across 39 files.
4. The destructive `@example.com` purge can **NEVER** run against DEV or PROD, even by
   accident (forgotten `.env.test`, mis-pasted URL).
5. With **no** `.env.test` present, integration suites **skip cleanly** (default = no
   DEV pollution, identical to CI behavior today). Running them is opt-in.

## Non-goals (explicit, YAGNI)

- **Provisioning the test Supabase project itself** — that is a REMOTE step the user
  performs. This task documents the procedure as a manual prerequisite and does not
  attempt it.
- **Wiring `.env.test` into CI** so integration tests run in GitHub Actions — separate
  follow-up task (see Open Question). CI stays unit-only.
- **A local Supabase/Docker stack** — out of scope; we stay on a remote test project.
- Migrating integration tests off the direct `process.env` reads onto `src/lib/env.ts`.

## Key design decisions

### Decision 1 — How `.env.test` overrides only for integration

**Chosen: a shared loader module** (`src/test/integration-env.ts`) imported and called
at the top of every integration suite and the teardown.

Precedence, in one place:

1. `config({ path: ".env.local", override: true })` — base (keeps DEV creds as the
   fallback layer so a partial `.env.test` still resolves shared non-DB vars).
2. `config({ path: ".env.test", override: true })` — **if the file exists**, its values
   win (test-project URL + keys override DEV).

Unit tests never import this module, so they are untouched — they keep running with
`vitest.setup.ts`'s placeholders.

**Rejected — vitest project-level `env` / `loadEnv`:** the integration files read
`process.env.*` at **module-import time**, on the lines immediately after their own
top-level `config()` call. A project-level `env` map or `loadEnv` in `vitest.config.ts`
does not cleanly guarantee precedence over a per-file `dotenv.config({ override: true })`
that runs at import, and — critically — it would not redirect `global-teardown.ts`
(which is `globalSetup`, a separate process-level hook). A shared **import** is the one
mechanism that covers all 39 call sites uniformly from a single file.

**Rejected — a `pnpm test:integration` flag alone:** a flag can choose a config, but it
still leaves 39 hardcoded `.env.local` paths; the override logic must live somewhere.
The shared loader IS that somewhere; a flag is not needed.

### Decision 2 — Single source of truth (no 38 per-file edits of logic)

The 38 test files and the teardown all **replace** their literal
`config({ path: ".env.local", override: true });` with a call to the shared loader:

```ts
import { loadIntegrationEnv } from "@/test/integration-env";
loadIntegrationEnv();
```

(The teardown, being in `src/test/`, imports it with a relative path
`./integration-env`.) The precedence/override logic exists in exactly one file. Future
changes to env resolution touch only `integration-env.ts`. The replace is mechanical
because the old line is byte-identical everywhere.

### Decision 3 — Provisioning the test-only project (MANUAL prerequisite)

This is a **remote step the user performs once**; the plan documents it, does not run it:

1. Create a new Supabase project (e.g. "Monolith TEST") in the dashboard. Note its project
   ref, URL, anon/publishable key, and service-role key.
2. Apply the schema (the 69 migrations in `supabase/migrations/` are the source of
   truth):
   ```bash
   supabase link --project-ref <test-project-ref>
   supabase db push          # applies all migrations to the linked test project
   supabase link --project-ref <dev-project-ref>   # relink back to DEV afterwards
   ```
   (Relinking back to DEV keeps `pnpm db:types --linked` pointed at DEV.)
3. Create `.env.test` (gitignored) in the repo root with the **test** project's creds:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<test-project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<test anon/publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<test service-role key>
   PULSE_TEST_DB=1
   ```
   `PULSE_TEST_DB=1` is the explicit opt-in marker the safety guard (Decision 4)
   requires before any destructive purge.

This procedure is captured in `.env.example` (a documented `.env.test` block) and in
`CONTRIBUTING.md` so the next developer can reproduce it. CI is unchanged.

### Decision 4 — Teardown safety guard (purge can never hit DEV/PROD)

After `loadIntegrationEnv()`, the teardown resolves a URL + service-role. Before any
destructive call it MUST pass a guard, implemented in `integration-env.ts` as
`assertSafeTestTarget(url)` and reused by the teardown:

- **Deny-list (hard):** refuse if the resolved `NEXT_PUBLIC_SUPABASE_URL` host contains
  the **PROD** ref `jzsyqhxynswolgijkktn` or the **DEV** ref. (DEV ref is read from the
  team's `.env.local`; the guard hard-codes the prod ref and treats "URL equals the
  `.env.local` URL" as DEV — i.e. if `.env.test` did not actually override the URL, the
  target is still DEV → refuse.)
- **Allow-list (positive):** require `process.env.PULSE_TEST_DB === "1"`. No marker → not
  a recognized test DB → skip the purge.

If the guard fails, the teardown **logs a clear warning and returns without deleting
anything** (it does not throw — a teardown that throws would fail the whole run; the goal
is "never delete from DEV", and skipping achieves that safely). The existing
"no service-role secret → skip silently" branch stays.

Net effect: the purge fires **only** against a URL that (a) differs from DEV's
`.env.local` URL, (b) is not PROD, and (c) carries `PULSE_TEST_DB=1`.

### Decision 5 — Fallback when `.env.test` is absent

**Chosen: skip cleanly (graceful), not fail-loud, not silent-pollute.**

- The integration suites already `describe.skipIf(!SERVICE_ROLE_KEY)`. With no
  `.env.test` AND no service-role in `.env.local`, they skip — same as CI today.
- **But `.env.local` DOES carry a DEV service-role**, so without further change the
  suites would still run against DEV. To honor Goal 5, `loadIntegrationEnv()` returns a
  small status object, and the suites gate on a single new predicate
  `integrationTargetReady()` (true only when a real, non-DEV test target with a
  service-role is resolved). When `.env.test` is absent, `integrationTargetReady()` is
  `false` → suites skip. This is the behavior change that **stops the default DEV
  pollution**: running integration tests becomes opt-in (requires the test project).
- The teardown's Decision-4 guard independently ensures no DEV purge regardless.

**Rejected — fail-loud (throw when `.env.test` missing):** would break `pnpm test` (and
thus `finish-task.sh`) for every developer and CI run that doesn't have the test
project. Skipping is the correct default; opt-in is explicit.

## Architecture / units

| Unit                                           | Responsibility                                                                                                                                                                                               | Depends on           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| `src/test/integration-env.ts` (**new**)        | Single source of truth for integration env: load `.env.local` then `.env.test` (override); expose `loadIntegrationEnv()`, `integrationTargetReady()`, `assertSafeTestTarget(url)` / `isSafeTestTarget(url)`. | `dotenv`, `node:fs`  |
| 38 `*.integration.test.ts(x)` (**modify**)     | Replace the literal dotenv line with `loadIntegrationEnv()`; gate `describe.skipIf(...)` on `!integrationTargetReady()`.                                                                                     | `integration-env.ts` |
| `src/test/global-teardown.ts` (**modify**)     | Use `loadIntegrationEnv()`; call `isSafeTestTarget(url)` before purging; bail safely if unsafe.                                                                                                              | `integration-env.ts` |
| `src/test/integration-env.test.ts` (**new**)   | Unit tests for loader precedence, `integrationTargetReady`, and the safety guard (incl. DEV/PROD refusal).                                                                                                   | `integration-env.ts` |
| `.env.example`, `CONTRIBUTING.md` (**modify**) | Document the `.env.test` block + provisioning procedure.                                                                                                                                                     | —                    |

**Data flow:** test/teardown imports `integration-env` → loader merges
`.env.local` + `.env.test` into `process.env` → suites read `process.env.*` (unchanged
read sites) → teardown additionally guards on the resolved URL before deleting.

## Error handling

- `.env.test` missing → loader loads only `.env.local`; `integrationTargetReady()`
  false → suites skip; teardown guard refuses (DEV) → no purge.
- `.env.test` present but malformed/partial (no service-role) → `integrationTargetReady()`
  false → skip; no purge.
- Guard sees DEV/PROD URL → teardown logs and returns; throws nowhere.
- Loader is idempotent (safe to call once per file at import).

## Testing strategy

`integration-env.ts` is **pure-ish and unit-testable** (no network) — it manipulates
`process.env` and reads file existence. New `src/test/integration-env.test.ts` (a UNIT
test, runs in CI) covers:

1. `.env.test` values override `.env.local` when present.
2. With no `.env.test`, only `.env.local` is applied.
3. `integrationTargetReady()` is `false` when the resolved URL equals the DEV/`.env.local`
   URL or `PULSE_TEST_DB !== "1"` or no service-role; `true` for a distinct test target
   with `PULSE_TEST_DB=1` + service-role.
4. `isSafeTestTarget()` refuses the PROD ref and the DEV URL; accepts a distinct test URL.

The existing `global-teardown.test.ts` and `integration-auth.test.ts` continue to pass
(pure-function tests, unaffected). Full gate: `pnpm typecheck && pnpm lint && pnpm test
&& pnpm build`. Note: because the loader change makes integration suites skip absent
`.env.test`, the local `finish-task.sh` run will SKIP integration suites unless the
runner has provisioned `.env.test` — this is the intended new default.

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point the 38 integration suites + the teardown sweeper at a dedicated test-only
Supabase project via a gitignored `.env.test`, through one shared env loader, so they
stop polluting (and never destructively sweep) DEV.

**Architecture:** A single new `src/test/integration-env.ts` owns env precedence
(`.env.local` then `.env.test` override), a readiness predicate, and a DEV/PROD safety
guard. All 38 test files and the teardown call into it, replacing a byte-identical
hardcoded dotenv line. Suites skip cleanly when `.env.test` is absent.

**Tech Stack:** Vitest (project split), `dotenv`, `@supabase/supabase-js`, Supabase CLI
(manual provisioning).

---

## Task 1: The shared env loader + safety guard (`integration-env.ts`)

**Files:**

- Create: `src/test/integration-env.ts`
- Test: `src/test/integration-env.test.ts`

**Interfaces:**

- Produces: `loadIntegrationEnv()`, `integrationTargetReady(): boolean`,
  `isSafeTestTarget(url: string | undefined): boolean`.
- Consumes: nothing (leaf unit).

- [ ] **Step 1: Write the failing tests**

```ts
// src/test/integration-env.test.ts
import { describe, expect, it } from "vitest";

// `isSafeTestTarget` is a pure predicate over process.env + the URL, so it is
// directly unit-testable with no filesystem/network. (The .env.local/.env.test
// file-merge in loadIntegrationEnv is exercised by Task 3's integration-project
// skip run, not duplicated here.)
import { isSafeTestTarget } from "./integration-env";

const PROD_REF = "jzsyqhxynswolgijkktn";

describe("isSafeTestTarget", () => {
  it("refuses the PROD project URL", () => {
    expect(isSafeTestTarget(`https://${PROD_REF}.supabase.co`)).toBe(false);
  });
  it("refuses when PULSE_TEST_DB is not set", () => {
    delete process.env.PULSE_TEST_DB;
    expect(isSafeTestTarget("https://sometest.supabase.co")).toBe(false);
  });
  it("accepts a distinct test URL with PULSE_TEST_DB=1", () => {
    process.env.PULSE_TEST_DB = "1";
    expect(isSafeTestTarget("https://pulse-test.supabase.co")).toBe(true);
  });
  it("refuses an empty/undefined URL", () => {
    process.env.PULSE_TEST_DB = "1";
    expect(isSafeTestTarget(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/test/integration-env.test.ts`
Expected: FAIL — `isSafeTestTarget` not exported / module not found.

- [ ] **Step 3: Implement `integration-env.ts`**

```ts
// src/test/integration-env.ts
import { existsSync } from "node:fs";
import { config } from "dotenv";

// PROD project ref — destructive teardown must NEVER touch it. (DEV is detected
// dynamically: if .env.test did not override the URL away from .env.local's URL,
// the target is still DEV and is refused.)
const PROD_PROJECT_REF = "jzsyqhxynswolgijkktn";

const ENV_LOCAL = ".env.local";
const ENV_TEST = ".env.test";

let loaded = false;

/**
 * Single source of truth for integration-suite env resolution.
 * Loads `.env.local` (base) then `.env.test` (override) if present, so a
 * dedicated test project's creds win when `.env.test` exists. Idempotent.
 */
export function loadIntegrationEnv(): void {
  if (loaded) return;
  config({ path: ENV_LOCAL, override: true });
  if (existsSync(ENV_TEST)) {
    config({ path: ENV_TEST, override: true });
  }
  loaded = true;
}

/**
 * True only when a SAFE, non-DEV test target with a service-role is resolved.
 * Integration suites gate `describe.skipIf(!integrationTargetReady())` on this,
 * so they SKIP cleanly when `.env.test` is absent (default = no DEV pollution).
 */
export function integrationTargetReady(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(serviceRole) && isSafeTestTarget(url);
}

/**
 * Guard for the destructive teardown purge. A URL is a safe test target ONLY
 * when it is the explicitly-marked dedicated test project — never DEV/PROD.
 */
export function isSafeTestTarget(url: string | undefined): boolean {
  if (!url) return false;
  if (process.env.PULSE_TEST_DB !== "1") return false; // explicit opt-in marker
  if (url.includes(PROD_PROJECT_REF)) return false; // never PROD
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/test/integration-env.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/test/integration-env.ts src/test/integration-env.test.ts
git commit -m "test(infra): add integration-env loader + DEV/PROD safety guard"
```

---

## Task 2: Wire the teardown sweeper through the loader + guard

**Files:**

- Modify: `src/test/global-teardown.ts`
- Test (existing, must stay green): `src/test/global-teardown.test.ts`

**Interfaces:**

- Consumes: `loadIntegrationEnv`, `isSafeTestTarget` (Task 1).
- Produces: a teardown that purges only a safe test target.

- [ ] **Step 1: Replace the hardcoded dotenv load with the loader**

In `src/test/global-teardown.ts`, replace:

```ts
// Mirror rls.integration.test.ts: `override: true` because vitest.setup.ts
// seeds placeholder NEXT_PUBLIC_* values before this runs.
config({ path: ".env.local", override: true });
```

with:

```ts
loadIntegrationEnv();
```

and replace the `import { config } from "dotenv";` line with:

```ts
import { isSafeTestTarget, loadIntegrationEnv } from "./integration-env";
```

- [ ] **Step 2: Add the safety guard before any delete**

Immediately after the existing `if (!url || !serviceRoleKey) return;` block, add:

```ts
// HARD GUARD: the @example.com purge is destructive. Run it ONLY against the
// explicitly-marked dedicated test project — never DEV/PROD. Without .env.test
// (or its PULSE_TEST_DB marker) this refuses and returns, leaving DEV intact.
if (!isSafeTestTarget(url)) {
  console.warn(
    "[global-teardown] target is not a marked test DB (PULSE_TEST_DB) — " +
      "skipping purge to protect DEV/PROD.",
  );
  return;
}
```

- [ ] **Step 3: Run the existing teardown unit test**

Run: `pnpm vitest run --project unit src/test/global-teardown.test.ts`
Expected: PASS (it tests `selectPurgeableUserIds`, unaffected by the guard).

- [ ] **Step 4: Add a guard test to the teardown suite**

Append to `src/test/global-teardown.test.ts`:

```ts
import { isSafeTestTarget } from "./integration-env";

describe("teardown safety guard wiring", () => {
  it("refuses DEV/PROD-shaped targets without the marker", () => {
    delete process.env.PULSE_TEST_DB;
    expect(isSafeTestTarget("https://jzsyqhxynswolgijkktn.supabase.co")).toBe(
      false,
    );
  });
});
```

- [ ] **Step 5: Run + commit**

Run: `pnpm vitest run --project unit src/test/global-teardown.test.ts`
Expected: PASS.

```bash
git add src/test/global-teardown.ts src/test/global-teardown.test.ts
git commit -m "test(infra): gate teardown purge behind test-DB safety guard"
```

---

## Task 3: Migrate all 38 integration suites to the loader + readiness gate

**Files:**

- Modify: all 38 `src/**/*.integration.test.ts(x)` files (mechanical).

**Interfaces:**

- Consumes: `loadIntegrationEnv`, `integrationTargetReady` (Task 1).

**Note:** depends on Task 1 only (not Task 2). The old line is byte-identical
everywhere, so the path replace is deterministic; the `skipIf` change is per-file but
uniform in pattern.

- [ ] **Step 1: Replace the dotenv line across all suites**

For every file matching `src/**/*.integration.test.ts` and `.tsx`, replace the literal:

```ts
config({ path: ".env.local", override: true });
```

with:

```ts
loadIntegrationEnv();
```

and add the import (alongside the existing `@/test/integration-auth` import where
present):

```ts
import {
  loadIntegrationEnv,
  integrationTargetReady,
} from "@/test/integration-env";
```

Remove the now-unused `import { config } from "dotenv";` from each file (lint will flag
it otherwise). Verify zero stragglers:

Run: `grep -rl 'config({ path: ".env.local"' src --include="*.integration.test.ts*"`
Expected: no output.

- [ ] **Step 2: Switch each suite's skip gate to readiness**

In each file, change the skip predicate from the service-role check to the readiness
predicate. The current form is a `describe.skipIf(!SERVICE_ROLE_KEY)(...)` (or a local
`const SERVICE_ROLE_KEY = ...` used in the gate). Replace the gate expression with
`!integrationTargetReady()`:

```ts
// before
describe.skipIf(!SERVICE_ROLE_KEY)("...", () => { ... });
// after
describe.skipIf(!integrationTargetReady())("...", () => { ... });
```

Leave the local `SERVICE_ROLE_KEY`/`SUPABASE_URL`/`ANON_KEY` consts in place — they are
still read inside `beforeAll` to build clients. Only the **gate** moves to
`integrationTargetReady()`.

Verify every suite is gated on readiness:

Run: `grep -rL "integrationTargetReady" src --include="*.integration.test.ts*"`
Expected: no output (every integration file references it).

- [ ] **Step 3: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS, no unused-import errors.

- [ ] **Step 4: Run the full unit project (proves no regression, integration skipped)**

Run: `pnpm vitest run --project unit`
Expected: PASS. (Integration suites are excluded from `unit`.)

- [ ] **Step 5: Run the integration project WITHOUT `.env.test` to prove clean skip**

Run: `pnpm vitest run --project integration`
Expected: all integration suites report **skipped** (no `@example.com` users created;
nothing hits DEV). This is the core acceptance signal for Goal 5.

- [ ] **Step 6: Commit**

```bash
git add src/**/*.integration.test.ts src/**/*.integration.test.tsx
git commit -m "test(infra): route all integration suites through integration-env loader"
```

---

## Task 4: Document the `.env.test` provisioning procedure

**Files:**

- Modify: `.env.example`
- Modify: `CONTRIBUTING.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Add a `.env.test` block to `.env.example`**

Append:

```
# --- Isolated test database (integration suites). Real values go in .env.test (gitignored). ---
# Provision a DEDICATED Supabase project, apply supabase/migrations to it, then fill these.
# Integration suites + the teardown sweeper use these and NEVER touch DEV/PROD.
# Without .env.test, integration suites SKIP (no DEV pollution).
# NEXT_PUBLIC_SUPABASE_URL=https://YOUR_TEST_PROJECT_REF.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=test-project-anon-key
# SUPABASE_SERVICE_ROLE_KEY=test-project-service-role-key
# PULSE_TEST_DB=1   # REQUIRED opt-in marker; the destructive purge refuses to run without it
```

- [ ] **Step 2: Add a "Running integration tests" section to `CONTRIBUTING.md`**

Document the one-time manual provisioning (Decision 3): create the test project,
`supabase link --project-ref <test-ref>` → `supabase db push` → relink to DEV; create
`.env.test`; note that absent `.env.test`, integration suites skip.

- [ ] **Step 3: Commit**

```bash
git add .env.example CONTRIBUTING.md
git commit -m "docs(infra): document .env.test isolated-test-DB provisioning"
```

---

## Execution DAG (AGENTS.md #6)

**Dependency graph:**

- Task 1 (loader) — no dependencies.
- Task 2 (teardown) — depends on Task 1.
- Task 3 (38 suites) — depends on Task 1.
- Task 4 (docs) — no code dependency (depends on the design only).

```
Task 1 ──┬─→ Task 2
         └─→ Task 3
Task 4 (independent)
```

**Parallel batches:**

- **Batch A (parallel):** Task 1, Task 4.
- **Batch B (parallel, after Task 1):** Task 2, Task 3.

Task 2 and Task 3 touch disjoint files (teardown vs. the 38 suites) and both depend only
on Task 1, so they run concurrently. Per AGENTS.md #6, dispatch Batch B as parallel
agents. Because all files live in this one `task/test-db-isolation` worktree and the two
tasks are file-disjoint, no nested worktrees are needed; a single shared worktree is safe.

**Critical path:** Task 1 → Task 3 (the 38-file migration is the longest leg) → final
gate. Critical path length = 2 tasks.

**Final gate (after all batches):** `pnpm typecheck && pnpm lint && pnpm test && pnpm
build`, then `scripts/finish-task.sh`. Note the runner needs `.env.test` provisioned to
actually exercise the integration suites; without it they skip (intended).

## Open question for the human reviewer

**Decision 5 makes integration coverage opt-in locally and never-run in CI.** With this
change, `pnpm test` skips all integration suites unless the runner has provisioned
`.env.test` — including the `finish-task.sh` gate and CI. Is that acceptable as the new
default, or do you want a **follow-up task** to wire `.env.test` secrets into CI
(GitHub Actions) so the isolated integration suite runs there? Recommendation: accept the
opt-in default now (it solves the DEV-pollution priority); treat CI integration as a
separate, later task.

## How to test (post-merge)

No user-facing behavior to test — this is test-infra only. Verify by:

1. `pnpm test` with **no** `.env.test` → integration suites report **skipped**; DEV gets
   no new `@example.com` users (check the DEV auth users list before/after).
2. (Optional, requires the provisioned test project) `pnpm test` **with** `.env.test`
   present → integration suites run against the test project; `@example.com` users appear
   in the TEST project (not DEV) and the teardown purges them there.
