# Server Env Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-02-env-validation-design.md`

**Goal:** Give server-only env vars (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`) a Zod schema in a `server-only`-guarded module, fail eagerly at server boot via `instrumentation.ts` with a startup line naming the active Supabase project, and lint-guard against new raw `process.env` reads.

**Architecture:** A lazy, memoized `getServerEnv()` in `src/lib/env.server.ts` (approach B from the spec — no import-time parse, so `next build` stays secret-independent and tests can mutate `process.env`). `src/instrumentation.ts` `register()` forces the first parse at server start and logs a presence-only summary. Shared, non-secret project refs live in `src/lib/supabase/project-refs.ts`, consumed by both the startup label and the integration-test deny-list.

**Tech Stack:** Next.js 16 (App Router, `instrumentation.ts` file convention, built-in `server-only`), Zod 4, Vitest (`server-only` already aliased to a stub in `vitest.config.ts`), ESLint 9 flat config.

## Global Constraints

- No new dependencies (`server-only` is built into Next 16; no `@t3-oss/env-nextjs`).
- Do NOT change the AI graceful-degradation contract: `getAnthropicClient()` still throws `AiNotConfiguredError` when the key is absent; `src/lib/ai/actions.ts` stays untouched.
- Never log secret values — presence flags only. Project refs are non-secret.
- Test/`src/test/` files keep raw `process.env` access (they run under Vitest, not Next).
- `src/components/web-vitals.tsx` keeps its direct reads (deliberate Next inline replacement; lint-exempted).
- TypeScript strict, no `any`. Commit subjects lowercase after `type(scope):`; every commit has a descriptive body and ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Stage explicitly by path (`git add <paths>`), never `git add -A`.
- Done gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.

---

### Task 1: Shared Supabase project refs

**Files:**

- Create: `src/lib/supabase/project-refs.ts`
- Test: `src/lib/supabase/project-refs.test.ts`

**Interfaces:**

- Consumes: nothing (leaf module; plain TS, NOT server-only — refs appear in client-side URLs).
- Produces:
  - `SUPABASE_PROJECT_REFS: { readonly dev: "hjqcahbbbdaknbbnfnvl"; readonly prod: "jzsyqhxynswolgijkktn" }`
  - `type SupabaseTargetLabel = "dev" | "prod" | "unknown"`
  - `labelSupabaseTarget(url: string | undefined): SupabaseTargetLabel`

- [ ] **Step 1: Write the failing test**

`src/lib/supabase/project-refs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SUPABASE_PROJECT_REFS,
  labelSupabaseTarget,
} from "@/lib/supabase/project-refs";

describe("labelSupabaseTarget", () => {
  it("labels the DEV project ref", () => {
    expect(
      labelSupabaseTarget(`https://${SUPABASE_PROJECT_REFS.dev}.supabase.co`),
    ).toBe("dev");
  });

  it("labels the PROD project ref", () => {
    expect(
      labelSupabaseTarget(`https://${SUPABASE_PROJECT_REFS.prod}.supabase.co`),
    ).toBe("prod");
  });

  it("labels anything else unknown", () => {
    expect(labelSupabaseTarget("https://pulse-test.supabase.co")).toBe(
      "unknown",
    );
    expect(labelSupabaseTarget("http://localhost:54321")).toBe("unknown");
  });

  it("labels undefined unknown", () => {
    expect(labelSupabaseTarget(undefined)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/supabase/project-refs.test.ts`
Expected: FAIL — "Cannot find module '@/lib/supabase/project-refs'" (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

`src/lib/supabase/project-refs.ts`:

```ts
// Supabase project refs for this app's known environments. NOT secrets — the
// ref is the subdomain of every client-visible Supabase URL. Single source of
// truth for (a) the boot-time "which project am I pointed at?" label
// (src/lib/env.server.ts) and (b) the integration-teardown deny-list
// (src/test/integration-env.ts). Beware the .env.local duplicate-key/last-wins
// gotcha: these labels are how a silent repoint becomes visible.
export const SUPABASE_PROJECT_REFS = {
  dev: "hjqcahbbbdaknbbnfnvl",
  prod: "jzsyqhxynswolgijkktn",
} as const;

export type SupabaseTargetLabel = "dev" | "prod" | "unknown";

/** Classify a Supabase URL as the known dev project, the known prod project,
 *  or unknown (test projects, localhost, absent). */
export function labelSupabaseTarget(
  url: string | undefined,
): SupabaseTargetLabel {
  if (!url) return "unknown";
  if (url.includes(SUPABASE_PROJECT_REFS.prod)) return "prod";
  if (url.includes(SUPABASE_PROJECT_REFS.dev)) return "dev";
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/supabase/project-refs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/project-refs.ts src/lib/supabase/project-refs.test.ts
git commit -m "feat(env): add shared supabase project-ref labels" -m "Single non-secret source of truth for the known DEV/PROD project refs plus a labelSupabaseTarget() classifier. Consumed next by the server-env boot summary and the integration-test deny-list, so the two can't drift." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `src/lib/env.server.ts` — server-only schema, lazy parse, boot summary

**Files:**

- Create: `src/lib/env.server.ts`
- Test: `src/lib/env.server.test.ts`

**Interfaces:**

- Consumes: `env` from `@/lib/env` (existing: `env.NEXT_PUBLIC_SUPABASE_URL: string`); `labelSupabaseTarget` from `@/lib/supabase/project-refs` (Task 1).
- Produces:
  - `getServerEnv(): ServerEnv` where `type ServerEnv = { SUPABASE_SERVICE_ROLE_KEY: string; ANTHROPIC_API_KEY?: string | undefined }` — lazy, memoized; throws aggregated `Error` on invalid env.
  - `resetServerEnvForTests(): void`
  - `serverEnvSummary(): string` — e.g. `[env] supabase ref hjqcahbbbdaknbbnfnvl (DEV) · service role: present · anthropic: absent`

- [ ] **Step 1: Write the failing test**

`src/lib/env.server.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getServerEnv,
  resetServerEnvForTests,
  serverEnvSummary,
} from "@/lib/env.server";
import { SUPABASE_PROJECT_REFS } from "@/lib/supabase/project-refs";

// vitest.setup.ts seeds NEXT_PUBLIC_* placeholders but NOT the server vars —
// each test states its own env, mirroring src/test/integration-env.test.ts.
const KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  resetServerEnvForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetServerEnvForTests();
});

describe("getServerEnv", () => {
  it("throws a clear aggregated error when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    expect(() => getServerEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => getServerEnv()).toThrow(/Invalid server environment/);
  });

  it("rejects an empty-string service key (duplicate-key/last-wins symptom)", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    expect(() => getServerEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("returns typed values when the env is valid", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const env = getServerEnv();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-role-test");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
  });

  it("treats ANTHROPIC_API_KEY as optional", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    expect(getServerEnv().ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("memoizes: a later process.env mutation is not re-read", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "first";
    expect(getServerEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("first");
    process.env.SUPABASE_SERVICE_ROLE_KEY = "second";
    expect(getServerEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("first");
  });

  it("resetServerEnvForTests re-arms the parse", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "first";
    getServerEnv();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "second";
    resetServerEnvForTests();
    expect(getServerEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("second");
  });
});

describe("serverEnvSummary", () => {
  it("prints ref, label, and presence flags — never key material", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "super-secret-role-key";
    const line = serverEnvSummary();
    // vitest.setup.ts pins NEXT_PUBLIC_SUPABASE_URL to http://localhost:54321.
    expect(line).toContain("[env] supabase ref localhost (UNKNOWN)");
    expect(line).toContain("service role: present");
    expect(line).toContain("anthropic: absent");
    expect(line).not.toContain("super-secret-role-key");
  });

  it("shows anthropic: present when the key is set", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "role";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(serverEnvSummary()).toContain("anthropic: present");
    expect(serverEnvSummary()).not.toContain("sk-ant-x");
  });

  it("known refs get their DEV label", () => {
    // Sanity: the label helper feeding the summary knows the real refs.
    expect(SUPABASE_PROJECT_REFS.dev).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/env.server.test.ts`
Expected: FAIL — cannot resolve `@/lib/env.server`.

- [ ] **Step 3: Write the implementation**

`src/lib/env.server.ts`:

```ts
import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { labelSupabaseTarget } from "@/lib/supabase/project-refs";

// Server-only environment. The `server-only` import (built into Next 16) makes
// any client-component import a BUILD error, so these vars can never reach a
// browser bundle. Parsing is LAZY + memoized (not import-time) on purpose:
// `next build` must not require secrets, and unit tests mutate process.env.
// Eagerness is provided by src/instrumentation.ts register(), which forces the
// first parse at server boot.
const serverEnvSchema = z.object({
  // Core infrastructure (service client, provisioning) — the server must not
  // boot without it. min(1) also rejects the empty string a duplicate
  // .env.local key (last-wins) can leave behind.
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  // Optional feature (AI dashboard generation): absent → the app boots and
  // getAnthropicClient() throws AiNotConfiguredError on use. Non-empty when set.
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY must be non-empty when set")
    .optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Parse (once) and return the validated server env. Throws one aggregated
 *  error naming every missing/invalid var. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  // Static property access so the reads are analyzable (matches env.ts style).
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid server environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clear the memo so a test can re-parse a mutated process.env. */
export function resetServerEnvForTests(): void {
  cached = null;
}

/** One presence-only boot line: which Supabase project is active (the
 *  last-wins .env.local tripwire) and which server secrets are set. Never
 *  prints values. Throws (via getServerEnv) when the env is invalid. */
export function serverEnvSummary(): string {
  const server = getServerEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const ref = new URL(url).hostname.split(".")[0];
  const label = labelSupabaseTarget(url).toUpperCase();
  const anthropic = server.ANTHROPIC_API_KEY ? "present" : "absent";
  return `[env] supabase ref ${ref} (${label}) · service role: present · anthropic: ${anthropic}`;
}
```

Note: `service role: present` is literal — `getServerEnv()` has already thrown if it were absent, so by the time the summary builds, presence is a fact, not a check.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/env.server.test.ts`
Expected: PASS (9 tests). (`server-only` resolves via the `vitest.config.ts` alias to `vitest.server-only-stub.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.server.ts src/lib/env.server.test.ts
git commit -m "feat(env): add server-only zod schema with lazy validated access" -m "getServerEnv() lazily parses SUPABASE_SERVICE_ROLE_KEY (required) and ANTHROPIC_API_KEY (optional) with an aggregated error message; serverEnvSummary() builds the presence-only boot line naming the active supabase ref. server-only guard keeps it out of client bundles." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Migrate `anthropic.ts` and `service.ts` to the schema

**Files:**

- Modify: `src/lib/ai/anthropic.ts:18-22` (the `getAnthropicClient` body)
- Modify: `src/lib/supabase/service.ts` (whole file — drops the ad-hoc check)
- Test: `src/lib/ai/anthropic.test.ts` (create)

**Interfaces:**

- Consumes: `getServerEnv()`, `resetServerEnvForTests()` from `@/lib/env.server` (Task 2).
- Produces: unchanged public contracts — `getAnthropicClient(): Anthropic` (throws `AiNotConfiguredError` when key absent); `createServiceClient()` (now throws Task 2's aggregated error when the service key is missing, instead of the old bespoke string).

- [ ] **Step 1: Write the failing test**

`src/lib/ai/anthropic.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiNotConfiguredError, getAnthropicClient } from "@/lib/ai/anthropic";
import { resetServerEnvForTests } from "@/lib/env.server";

const KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  // getServerEnv() requires the service key even on the AI path — seed it.
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  delete process.env.ANTHROPIC_API_KEY;
  resetServerEnvForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetServerEnvForTests();
});

describe("getAnthropicClient", () => {
  it("throws AiNotConfiguredError when ANTHROPIC_API_KEY is absent", () => {
    expect(() => getAnthropicClient()).toThrow(AiNotConfiguredError);
  });

  it("returns a client when the key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    resetServerEnvForTests();
    expect(getAnthropicClient()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify current state**

Run: `pnpm vitest run --project unit src/lib/ai/anthropic.test.ts`
Expected: PASS already (the old raw-read code satisfies both cases). That is fine — this test pins the contract the migration must preserve. Proceed.

- [ ] **Step 3: Migrate `src/lib/ai/anthropic.ts`**

Replace lines 18-22 (`getAnthropicClient` body) so the function reads:

```ts
export function getAnthropicClient(): Anthropic {
  const apiKey = getServerEnv().ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  return new Anthropic({ apiKey });
}
```

and add to the imports at the top (after `import Anthropic from "@anthropic-ai/sdk";`):

```ts
import { getServerEnv } from "@/lib/env.server";
```

- [ ] **Step 4: Migrate `src/lib/supabase/service.ts`**

Replace the whole file with:

```ts
// server-only — bypasses RLS, never import into client components.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";
import type { Database } from "@/types/database.types";

export function createServiceClient() {
  // Validated at boot by instrumentation.ts; getServerEnv() throws an
  // aggregated, var-naming error if this process somehow skipped that.
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  // No-op cookies: the service client is fully privileged and stateless, so it
  // must not read or write any user session.
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    },
  );
}
```

- [ ] **Step 5: Run the AI + supabase unit tests and typecheck**

Run: `pnpm vitest run --project unit src/lib/ai src/lib/supabase && pnpm typecheck`
Expected: PASS — including the pre-existing `actions.test.ts` (`AiNotConfiguredError` contract) and `generate.test.ts` (injects a fake client, never touches env).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/anthropic.ts src/lib/ai/anthropic.test.ts src/lib/supabase/service.ts
git commit -m "refactor(env): read server secrets via env.server schema" -m "getAnthropicClient() and createServiceClient() now read from getServerEnv() instead of raw process.env; the ad-hoc service-role check is replaced by the schema's aggregated error. AiNotConfiguredError contract unchanged and now pinned by a unit test." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `src/instrumentation.ts` — eager boot check + startup log

**Files:**

- Create: `src/instrumentation.ts`
- Test: `src/instrumentation.test.ts`

**Interfaces:**

- Consumes: `serverEnvSummary()`, `getServerEnv()` from `@/lib/env.server` (Task 2, via dynamic import).
- Produces: `register(): Promise<void>` — the Next 16 `instrumentation.ts` convention export. No app code imports this; Next calls it once per server instance before serving.

- [ ] **Step 1: Write the failing test**

`src/instrumentation.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { resetServerEnvForTests } from "@/lib/env.server";

const KEYS = [
  "NEXT_RUNTIME",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "VERCEL_ENV",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  resetServerEnvForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetServerEnvForTests();
  vi.restoreAllMocks();
});

describe("register", () => {
  it("no-ops outside the nodejs runtime (edge pass)", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await register();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs the env summary under nodejs", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await register();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[env] supabase ref"),
    );
  });

  it("rejects at boot when the server env is invalid", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await expect(register()).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("warns in production when ANTHROPIC_API_KEY is absent", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    process.env.VERCEL_ENV = "production";
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await register();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("ANTHROPIC_API_KEY"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit src/instrumentation.test.ts`
Expected: FAIL — cannot resolve `@/instrumentation`.

- [ ] **Step 3: Write the implementation**

`src/instrumentation.ts`:

```ts
// Next 16 instrumentation file convention: register() runs ONCE per server
// instance (next dev / next start / serverless cold start), before requests
// are served — and does NOT run during `next build`. This is what makes the
// lazy server-env schema eager where it matters: a bad env fails the boot
// loudly instead of the first AI call or service-client query. Reference:
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
export async function register(): Promise<void> {
  // Skip the edge pass — the server-only env module is nodejs-runtime code.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Dynamic import inside the runtime guard (documented pattern) keeps
  // env.server out of the edge bundle graph.
  const { getServerEnv, serverEnvSummary } = await import("@/lib/env.server");

  // Throws (via getServerEnv) with an aggregated, var-naming message when the
  // env is invalid → the server refuses to start. Otherwise: one presence-only
  // line naming the active Supabase ref — the .env.local last-wins tripwire.
  console.log(serverEnvSummary());

  // AI generation is an optional feature (AiNotConfiguredError degrades
  // gracefully), so a missing key WARNS in production rather than failing boot.
  if (
    process.env.VERCEL_ENV === "production" &&
    !getServerEnv().ANTHROPIC_API_KEY
  ) {
    console.warn(
      "[env] ANTHROPIC_API_KEY is not set in production — AI dashboard generation is disabled.",
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project unit src/instrumentation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Smoke the boot line in dev**

Run: `pnpm dev` (briefly; Ctrl-C after the first lines).
Expected: the startup output includes one `[env] supabase ref <ref> (DEV|PROD|UNKNOWN) · service role: present · anthropic: <present|absent>` line. (Skip if no `.env.local` in the worktree; the unit tests cover the logic.)

- [ ] **Step 6: Commit**

```bash
git add src/instrumentation.ts src/instrumentation.test.ts
git commit -m "feat(env): validate server env eagerly at boot via instrumentation" -m "register() (next 16 instrumentation convention, nodejs runtime only) forces the first getServerEnv() parse at server start so a missing/empty secret fails the boot with a var-naming error, and logs the presence-only supabase-ref summary line — the tripwire for the .env.local duplicate-key/last-wins repointing gotcha. Missing ANTHROPIC_API_KEY in production warns instead of failing (optional feature)." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Dedupe integration-test deny-list onto shared refs

**Files:**

- Modify: `src/test/integration-env.ts:17-20` (the `FORBIDDEN_PROJECT_REFS` constant)

**Interfaces:**

- Consumes: `SUPABASE_PROJECT_REFS` from `@/lib/supabase/project-refs` (Task 1).
- Produces: no interface change — `integrationTargetReady()` / `isSafeTestTarget()` behave identically; `src/test/integration-env.test.ts` (existing) must stay green.

- [ ] **Step 1: Replace the hardcoded refs**

In `src/test/integration-env.ts`, add to the imports:

```ts
import { SUPABASE_PROJECT_REFS } from "@/lib/supabase/project-refs";
```

and replace the `FORBIDDEN_PROJECT_REFS` declaration (keeping its comment block) with:

```ts
const FORBIDDEN_PROJECT_REFS = [
  SUPABASE_PROJECT_REFS.prod, // PROD
  SUPABASE_PROJECT_REFS.dev, // DEV
] as const;
```

- [ ] **Step 2: Run the existing tests to verify no behavior change**

Run: `pnpm vitest run --project unit src/test/integration-env.test.ts src/test/global-teardown.test.ts`
Expected: PASS — those suites hardcode the literal refs (`DEV_REF`/`PROD_REF` fixtures), so any drift in the shared constants would fail here.

- [ ] **Step 3: Commit**

```bash
git add src/test/integration-env.ts
git commit -m "refactor(test): derive teardown deny-list from shared project refs" -m "integration-env.ts now imports the DEV/PROD refs from src/lib/supabase/project-refs instead of hardcoding them, so the destructive-teardown deny-list and the boot-time env label can never drift apart. No behavior change; existing tests pin the literals." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: ESLint guard against new raw `process.env` reads

**Files:**

- Modify: `eslint.config.mjs` (add one config block after the `no-explicit-any` block)

**Interfaces:**

- Consumes: the final file layout from Tasks 2-4 (the exemption list below is definitive).
- Produces: `pnpm lint` fails on any `process.env.X` member access in `src/**/*.{ts,tsx}` outside the exempted files.

- [ ] **Step 1: Add the rule**

In `eslint.config.mjs`, insert after the `no-explicit-any` block (before `globalIgnores`):

```js
  // Env vars are read through the validated schemas — src/lib/env.ts (public,
  // NEXT_PUBLIC_*) and src/lib/env.server.ts (server-only secrets) — never raw.
  // Exemptions: the two schema modules themselves; instrumentation.ts (reads
  // NEXT_RUNTIME/VERCEL_ENV, the platform vars that gate validation);
  // web-vitals.tsx (deliberate static reads for Next inline replacement — the
  // endpoint var IS schema-validated in env.ts); and test land, where mutating
  // process.env is the job.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/env.ts",
      "src/lib/env.server.ts",
      "src/instrumentation.ts",
      "src/components/web-vitals.tsx",
      "src/test/**",
      "src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[object.type="MemberExpression"][object.object.name="process"][object.property.name="env"]',
          message:
            "Read env vars via src/lib/env.ts (public) or src/lib/env.server.ts (server secrets), not process.env directly.",
        },
      ],
    },
  },
```

(`src/**/*.test.{ts,tsx}` also matches `*.integration.test.ts` — no separate glob needed.)

- [ ] **Step 2: Verify the guard catches a violation**

Temporarily add `const x = process.env.HOME;` to any non-exempt file (e.g. `src/lib/supabase/service.ts`), run `pnpm lint`, confirm it errors with the message above, then revert the line.

- [ ] **Step 3: Run lint clean**

Run: `pnpm lint`
Expected: PASS with zero errors (proves the exemption list matches reality — if anything else in `src/` reads `process.env`, either it was missed in the sweep or the exemptions are wrong; investigate, don't blanket-exempt).

- [ ] **Step 4: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(lint): forbid raw process.env reads outside env modules" -m "no-restricted-syntax now errors on process.env member access in src/ outside the two env schemas, instrumentation.ts, web-vitals.tsx, and test files — the regression guard that keeps future code on the validated path." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full gates + client-import guard sanity

**Files:**

- None created/modified (verification only; revert any probe before finishing).

**Interfaces:**

- Consumes: everything above.
- Produces: a green branch ready for `scripts/finish-task.sh`.

- [ ] **Step 1: Verify the server-only guard actually bites**

Temporarily add `import "@/lib/env.server";` to a client component (any file with `"use client"`, e.g. `src/components/web-vitals.tsx`), run `pnpm build`, and confirm it FAILS with the server-only poisoning error. Revert the probe line. (This is the spec's core security claim — verify it once, don't unit-test it.)

- [ ] **Step 2: Run all four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. Known flake context: integration suites skip cleanly without `.env.test`; a cold `pnpm typecheck` failing on `cacheLife` types means run `pnpm build` first (see auto-memory `finish-task-typecheck-before-build-cachelife`).

- [ ] **Step 3: Finish**

Run `scripts/finish-task.sh` from the worktree (rebases onto latest `develop`, re-gates, merges, cleans up), then give the user the "How to test this" walkthrough: pull `develop`, `pnpm dev`, observe the `[env] supabase ref … (DEV)` boot line; delete `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` (temporarily) and observe the boot fail with a var-naming error; restore it.

---

## Execution DAG

Interfaces above are the edge list; synthesized:

- **Dependency graph:** Task 2 ← Task 1; Task 3 ← Task 2; Task 4 ← Task 2; Task 5 ← Task 1; Task 6 ← Tasks 3, 4 (final exemption list); Task 7 ← Tasks 3, 4, 5, 6.
- **Parallel batches:**
  - Batch 1: Task 1
  - Batch 2: Task 2 ∥ Task 5
  - Batch 3: Task 3 ∥ Task 4
  - Batch 4: Task 6
  - Batch 5: Task 7 (gates)
- **Critical path:** 1 → 2 → 3 → 6 → 7 (5 of 7 tasks — the wall-clock floor).

**This is an S slice: single-agent sequential execution (1, 2, 3, 4, 5, 6, 7) is acceptable and recommended** — the parallel width is only ever 2, and both ∥ pairs touch neighboring files; worktree-per-task overhead would exceed the savings.

## Performance & data-fetching budget

N/A — no UI, no data fetching, no views/tabs/filters. Runtime cost: one memoized Zod parse per server process + one `console.log` per boot.

## Open questions / decisions taken

Carried from the spec (`docs/superpowers/specs/2026-07-02-env-validation-design.md` § Open questions / decisions taken): lazy parse + boot check over import-time parse; `SUPABASE_SERVICE_ROLE_KEY` required everywhere; `ANTHROPIC_API_KEY` optional with prod warn; `web-vitals.tsx` and test files exempt from the lint guard; project refs deduplicated; no new dependencies.
