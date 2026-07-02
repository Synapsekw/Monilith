# Server env validation — design

**Date:** 2026-07-02
**Slice size:** S
**Status:** Spec written, awaiting review

## Problem

`src/lib/env.ts` validates only the three `NEXT_PUBLIC_*` client vars with Zod and throws
eagerly at import time. Server-only secrets have no schema:

- `src/lib/ai/anthropic.ts:19` reads `process.env.ANTHROPIC_API_KEY` raw inside
  `getAnthropicClient()`. A missing key surfaces only on the first AI call (as
  `AiNotConfiguredError`), never at boot.
- `src/lib/supabase/service.ts:7` reads `process.env.SUPABASE_SERVICE_ROLE_KEY` raw with an
  ad-hoc `if (!serviceRoleKey) throw` outside any schema. A missing key surfaces on the first
  service-client call (e.g. mid-provisioning), not at boot.
- Nothing at startup says **which** Supabase project the server is actually pointed at. The
  known `.env.local` duplicate-keys/last-wins gotcha (see auto-memory
  `supabase-env-labels-inverted`) has already silently repointed local dev between the DEV
  (`hjqcahbbbdaknbbnfnvl`) and PROD (`jzsyqhxynswolgijkktn`) projects.

Full `process.env` sweep of `src/` (verified 2026-07-02): the only **non-test** direct reads
outside `env.ts` are the two files above, plus `src/components/web-vitals.tsx` (client;
`NODE_ENV` + `NEXT_PUBLIC_WEB_VITALS_ENDPOINT` — see decisions). All other ~40 hits are
`*.integration.test.ts` suites and `src/test/` helpers, which intentionally read and mutate
`process.env` under Vitest (out of scope).

## Goals

1. A **server-only** Zod schema (`src/lib/env.server.ts`, guarded by `import "server-only"`)
   covering `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY`. Importing it from a client
   component fails the build (Next 16 has `server-only` built in — install optional; already
   used in 16 files in this repo).
2. **Eager failure at server boot** with a clear aggregated message naming every missing/invalid
   var — via `src/instrumentation.ts` `register()` (Next 16 file convention: runs once per
   server instance, before it serves requests; does NOT run during `next build`).
3. A **startup log line** naming the active Supabase project ref, labeled DEV/PROD/unknown,
   plus presence (never values) of the server secrets — the tripwire for the last-wins gotcha.
4. Consumers (`service.ts`, `anthropic.ts`) read from the schema, not `process.env`.
5. A lint guard so new direct `process.env` reads outside the env modules fail `pnpm lint`.

## Non-goals

- Validating every var the app ever touches (`NODE_ENV`, Vercel-injected vars, test-only vars).
- Changing the AI feature's graceful-degradation contract (`AiNotConfiguredError` stays).
- Touching integration-test env plumbing beyond deduplicating the project-ref constants.
- Adopting `@t3-oss/env-nextjs` (approach C below — rejected).

## Approaches considered

**A. Eager import-time parse in `env.server.ts` (mirror `env.ts`).** Simplest, but the module
graph evaluates during `next build` page-data collection, so a build in an env without secrets
would fail, and Vitest suites that mutate `process.env` per test couldn't re-parse without
`vi.resetModules()` churn. Rejected.

**B. Lazy memoized `getServerEnv()` + eager boot check in `instrumentation.ts` (chosen).**
The schema lives in one server-only module; parsing happens on first access and is memoized;
`register()` forces that first access at server startup so failures are eager and loud at boot
(dev and prod runtime) without coupling validation to build time. Testable: a
`resetServerEnvForTests()` escape hatch re-arms the memo.

**C. `@t3-oss/env-nextjs`.** Purpose-built, but a new dependency and more indirection than an
S slice warrants for two server vars. Rejected (revisit if the schema grows past ~6 vars).

## Design

### 1. `src/lib/supabase/project-refs.ts` (new, shared, NOT server-only)

Project refs are not secrets (they appear in every client-side Supabase URL). Exports:

```ts
export const SUPABASE_PROJECT_REFS = {
  dev: "hjqcahbbbdaknbbnfnvl",
  prod: "jzsyqhxynswolgijkktn",
} as const;

/** "dev" | "prod" | "unknown" for a Supabase URL (or undefined url → "unknown"). */
export function labelSupabaseTarget(
  url: string | undefined,
): "dev" | "prod" | "unknown";
```

`src/test/integration-env.ts` currently hardcodes the same two refs in
`FORBIDDEN_PROJECT_REFS`; it switches to deriving them from this module (behavior unchanged,
one source of truth, existing tests keep passing).

### 2. `src/lib/env.server.ts` (new, server-only)

```ts
import "server-only";
```

Zod schema (Zod 4, matching `env.ts` conventions — static property access on `process.env`):

- `SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)` — **required**. Core infrastructure
  (provisioning, service client); the server must not boot without it.
- `ANTHROPIC_API_KEY: z.string().min(1).optional()` — **optional in every environment**. AI
  dashboard generation is an optional feature with a deliberate graceful path
  (`AiNotConfiguredError` → clean user-facing message in `src/lib/ai/actions.ts:106`).

Exports:

- `getServerEnv(): ServerEnv` — lazy, memoized `safeParse`; on failure throws one aggregated
  `Error` listing every issue as `  - VAR_NAME: message` (same format as `env.ts`).
- `resetServerEnvForTests(): void` — clears the memo (unit tests mutate `process.env` between
  cases).
- `serverEnvSummary(): string` — pure, testable builder for the startup line. Reads
  `getServerEnv()` + `env.NEXT_PUBLIC_SUPABASE_URL` + `labelSupabaseTarget`. Shape:

  ```
  [env] supabase ref hjqcahbbbdaknbbnfnvl (DEV) · service role: present · anthropic: absent
  ```

  Presence only — never key material. If the label is `unknown` it still prints the ref, so a
  silent repoint is visible in the first lines of `next dev` output.

### 3. `src/instrumentation.ts` (new)

Next 16 `instrumentation.js|ts` convention (verified against
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`):
export `register()`, called once per server instance before it handles requests.

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // skip edge sandbox pass
  const { serverEnvSummary } = await import("@/lib/env.server");
  console.log(serverEnvSummary()); // getServerEnv() inside throws on invalid env → boot fails loudly
}
```

Dynamic import inside the runtime guard is the documented pattern (keeps the server-only
module out of the edge pass). A production `console.warn` is added when `ANTHROPIC_API_KEY`
is absent and `VERCEL_ENV === "production"` — warn, not fail (optional feature; see
decisions).

### 4. Consumer migration

- `src/lib/supabase/service.ts` — delete the ad-hoc check; `getServerEnv().SUPABASE_SERVICE_ROLE_KEY`.
  (File already server-only by convention; it gains an explicit `import "server-only"` since
  it now transitively pulls `env.server.ts` anyway.)
- `src/lib/ai/anthropic.ts` — `getAnthropicClient()` reads `getServerEnv().ANTHROPIC_API_KEY`;
  still throws `AiNotConfiguredError` when `undefined`. Public contract unchanged
  (`actions.ts` and its tests untouched).

### 5. Lint guard

`eslint.config.mjs` gains a `no-restricted-syntax` block flagging
`MemberExpression[object.object.name="process"][object.property.name="env"]` for
`src/**/*.{ts,tsx}`, with `files`-scoped exemptions for: `src/lib/env.ts`,
`src/lib/env.server.ts`, `src/instrumentation.ts`, `src/components/web-vitals.tsx`,
`src/test/**`, and `src/**/*.test.{ts,tsx}` / `src/**/*.integration.test.{ts,tsx}`. Message
points at the two env modules.

## Error handling

- Invalid server env at boot: `register()` throws → server fails to start, message lists every
  offending var (not just the first).
- Invalid server env when `instrumentation` somehow didn't run (unit test, stray script):
  first `getServerEnv()` call throws the same aggregated error — no silent `undefined`.
- Missing `ANTHROPIC_API_KEY`: unchanged behavior — `AiNotConfiguredError` → friendly message.
- Empty-string values (the classic duplicate-key/last-wins symptom): `min(1)` rejects them,
  same as absence.

## Testing

Unit tests (Vitest; `server-only` is already aliased to a stub in `vitest.config.ts`, so
`env.server.ts` imports cleanly):

- `project-refs.test.ts`: labels dev/prod/unknown URLs; `undefined` → unknown.
- `env.server.test.ts`: missing service key → throws naming `SUPABASE_SERVICE_ROLE_KEY`;
  empty string → throws; valid env → typed values; `ANTHROPIC_API_KEY` absent → `undefined`,
  no throw; memoization (second call doesn't re-read mutated `process.env`);
  `resetServerEnvForTests` re-arms; `serverEnvSummary()` prints ref + label + presence flags
  and never the key material.
- `instrumentation.test.ts`: `register()` no-ops when `NEXT_RUNTIME !== "nodejs"`; logs the
  summary under nodejs; propagates the validation error when env is invalid.
- Existing suites (`actions.test.ts`, integration-env tests) must stay green — they pin the
  contracts this slice must not break.

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Performance & data-fetching budget

N/A — no UI, no data fetching. One `console.log` per server boot; env parse is once per
process (memoized).

## Independent units (for the plan's DAG)

1. `project-refs.ts` + tests — no dependencies.
2. `env.server.ts` + tests — depends on 1 (label helper in the summary).
3. Consumer migration (`service.ts`, `anthropic.ts`) — depends on 2.
4. `instrumentation.ts` + tests — depends on 2 (parallel with 3).
5. ESLint guard + `integration-env.ts` dedupe — guard depends on 3+4 (final allowlist);
   dedupe depends only on 1.

For an S slice executed by a single agent, sequential execution is acceptable; the plan states
the DAG anyway.

## Open questions / decisions taken (non-interactive)

1. **`SUPABASE_SERVICE_ROLE_KEY` required everywhere (dev and prod).** It backs core flows
   (provisioning, service client) and is present in every working `.env.local`. Failing the
   boot beats failing mid-request.
2. **`ANTHROPIC_API_KEY` optional everywhere; prod gets a boot-time `console.warn`.** The
   codebase deliberately degrades gracefully (`AiNotConfiguredError` → clean message).
   Making it prod-required would turn an optional feature into a boot blocker.
3. **Lazy parse + instrumentation boot check (approach B), not import-time parse.** Keeps
   `next build` independent of secrets and keeps unit tests simple; the eagerness requirement
   is met at server start, which is where it matters.
4. **`web-vitals.tsx` keeps its direct reads (lint-exempted).** Its
   `NEXT_PUBLIC_WEB_VITALS_ENDPOINT` is already validated by the `env.ts` schema; the direct
   static read is deliberate (Next inline replacement) and its test suite mutates
   `process.env` per test, which an import-time-parsed `env` object would break. Folding it in
   would be churn without safety gain. `NODE_ENV` is platform-standard and stays out of the
   schema.
5. **Test files and `src/test/` helpers stay on raw `process.env`.** They run under Vitest,
   not Next, and mutating env is their job. Covered by the lint exemptions.
6. **Project refs deduplicated into `src/lib/supabase/project-refs.ts`** and consumed by both
   the startup summary and `integration-env.ts`'s deny-list; refs are non-secret. The
   deny-list vs. boot-label purposes differ, but the constants must not drift.
7. **No new dependency** (`server-only` is built into Next 16; no `@t3-oss/env-nextjs`).
