# Auth Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rate-limit the four mutating auth server actions (`signIn`, `signUp`, `requestPasswordReset`, `changeOwnPassword`) to blunt credential-stuffing, brute-force, and signup/reset abuse — without leaking account existence.

**Architecture:** A SECURITY DEFINER fixed-window counter RPC (`public.check_rate_limit`) over a service-role-only `public.auth_rate_limits` table, called from a pure `src/lib/rate-limit/auth-rate-limit.ts` helper via the existing service client + `typedRpc`. Each auth action gains a one-line gate after Zod parse and before the Supabase call; a denied gate returns a generic, enumeration-safe throttle message through the existing `AuthState.error` path. Fail-open on limiter error.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase (Postgres, plpgsql DEFINER RPC, `@supabase/ssr`), Zod, Vitest, `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-07-15-auth-rate-limiting-design.md`

---

## File Structure

| File                                                     | Responsibility                                                                     | Task |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---- |
| `supabase/migrations/<stamp>_auth_rate_limits.sql`       | `auth_rate_limits` table + `check_rate_limit` DEFINER RPC + grants                 | 1    |
| `src/types/database.types.ts`                            | Regenerated types (adds `check_rate_limit` to `Functions`)                         | 1    |
| `src/lib/rate-limit/auth-rate-limit.ts`                  | `getClientIp`, `hashIdentifier`, `RATE_LIMITS`, `checkRateLimit`, `throttleResult` | 3    |
| `src/lib/rate-limit/auth-rate-limit.test.ts`             | Unit tests for the helper (mocked RPC)                                             | 3    |
| `src/app/auth/actions.ts`                                | Four gate call sites (modify)                                                      | 4    |
| `src/app/auth/actions.test.ts`                           | Throttle + anti-enumeration action tests (modify)                                  | 4    |
| `src/lib/rate-limit/auth-rate-limit.integration.test.ts` | DB-level windowing test against DEV (opt-in)                                       | 5    |

---

## Execution DAG (working agreement #6)

**Dependency edges (Consumes / Produces):**

- **Task 1 — DB migration + types.** Consumes: nothing. Produces: `auth_rate_limits` table, `check_rate_limit` RPC, regenerated `database.types.ts` (the `check_rate_limit` entry in `Database["public"]["Functions"]`).
- **Task 2 — env override plumbing.** Consumes: nothing. Produces: optional `AUTH_RATE_LIMIT_MULTIPLIER` in `env.server.ts`. _Independent of Task 1._
- **Task 3 — limiter helper + unit tests.** Consumes: Task 1's regenerated types (for `typedRpc(sb, "check_rate_limit", …)`), Task 2's env override. Produces: `checkRateLimit`, `throttleResult`, `hashIdentifier`, `getClientIp`, `RATE_LIMITS`.
- **Task 4 — action wiring + action tests.** Consumes: Task 3's `checkRateLimit` / `throttleResult`. Produces: gated `actions.ts`.
- **Task 5 — DB integration test.** Consumes: Task 1's RPC. Produces: windowing/grant coverage. _Independent of Tasks 3–4._

**Dependency graph:**

```
Task 1 ──┬─> Task 3 ──> Task 4
         └─> Task 5
Task 2 ──────> Task 3
```

**Parallel batches (waves of concurrent agents):**

- **Batch A (parallel):** Task 1, Task 2 — no shared files, no dependency.
- **Batch B (parallel):** Task 3, Task 5 — both depend only on Task 1 (Task 3 also on Task 2); they touch disjoint files (`auth-rate-limit.ts` vs `*.integration.test.ts`).
- **Batch C:** Task 4 — depends on Task 3.

**Critical path (wall-clock floor):** Task 1 → Task 3 → Task 4 (3 tasks deep). Task 2 folds into Batch A; Task 5 folds into Batch B.

**Worktree note:** all work happens in the existing `.claude/worktrees/auth-rate-limiting` worktree on `task/auth-rate-limiting`. If Batch A/B tasks are dispatched to parallel subagents, they share this one worktree — Task 1 and Task 2 edit disjoint files, as do Task 3 and Task 5, so no clobber. Serialize the migration apply (Task 1) before starting Batch B.

---

## Task 1: DB migration — `auth_rate_limits` table + `check_rate_limit` RPC

**Files:**

- Create: `supabase/migrations/<stamp>_auth_rate_limits.sql` (mint via `scripts/new-migration.sh auth_rate_limits`)
- Modify (generated): `src/types/database.types.ts`

- [ ] **Step 1: Mint the migration file**

Run: `scripts/new-migration.sh auth_rate_limits`
Expected: prints a path `supabase/migrations/<UTC-stamp>_auth_rate_limits.sql` and the apply/types follow-up steps. Note the exact `<stamp>` — it must match when applying via MCP.

- [ ] **Step 2: Write the migration SQL**

Paste into the minted file (replace any scaffold):

```sql
-- Auth rate limiting (deferred Audit Batch B).
--
-- A service-role-only fixed-window counter behind the four auth server actions
-- (signIn / signUp / requestPasswordReset / changeOwnPassword). The app calls
-- check_rate_limit() through the SERVICE client only, so the function is NOT
-- granted to anon/authenticated — nothing here is reachable from the browser or
-- PostgREST. The table holds only opaque sha256 bucket keys (no email, no raw
-- IP), so a leak reveals nothing about who was limited.

create table public.auth_rate_limits (
  bucket_key   text        primary key,
  count        integer     not null default 0,
  window_start timestamptz not null default now()
);

-- Default-deny for anon/authenticated: RLS on, no permissive policy. Only the
-- service role (which bypasses RLS) and the DEFINER function touch this table.
alter table public.auth_rate_limits enable row level security;

-- Fixed-window counter. Atomic single-row upsert keyed by bucket_key.
-- Returns (allowed, retry_after seconds, remaining).
create function public.check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count        integer;
  v_window_start timestamptz;
  v_now          timestamptz := now();
begin
  -- Opportunistic prune of this key's expired window happens implicitly via the
  -- reset branch below; a bulk prune of all-expired rows is a documented
  -- follow-up (table stays tiny at auth volume).
  insert into public.auth_rate_limits (bucket_key, count, window_start)
  values (p_key, 1, v_now)
  on conflict (bucket_key) do update
    set
      count = case
        when public.auth_rate_limits.window_start
             < v_now - make_interval(secs => p_window_seconds)
        then 1
        else public.auth_rate_limits.count + 1
      end,
      window_start = case
        when public.auth_rate_limits.window_start
             < v_now - make_interval(secs => p_window_seconds)
        then v_now
        else public.auth_rate_limits.window_start
      end
  returning count, window_start into v_count, v_window_start;

  allowed   := v_count <= p_limit;
  remaining := greatest(p_limit - v_count, 0);
  retry_after := case
    when allowed then 0
    else greatest(
      ceil(extract(epoch from (
        v_window_start + make_interval(secs => p_window_seconds) - v_now
      )))::integer,
      0
    )
  end;
  return next;
end;
$$;

-- Execution lockdown: service-role-only. Never anon/authenticated/public.
revoke execute on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
```

- [ ] **Step 3: Apply to DEV via the `supabase-dev` MCP**

Use `mcp__supabase-dev__apply_migration` with **the same version + name** as the file (`name: "<stamp>_auth_rate_limits"`, `query:` the SQL above).
Then `mcp__supabase-dev__list_migrations` and confirm the ledger shows `<stamp>` matching the filename. On any drift, run `scripts/reconcile-migration-version.sh`.

- [ ] **Step 4: Smoke-test the RPC on DEV**

Run via `mcp__supabase-dev__execute_sql` (rolled-back is fine — wrap in a txn you don't commit, or just call it, rows self-expire):

```sql
select * from public.check_rate_limit('t:smoke', 2, 3600);  -- allowed=t, remaining=1
select * from public.check_rate_limit('t:smoke', 2, 3600);  -- allowed=t, remaining=0
select * from public.check_rate_limit('t:smoke', 2, 3600);  -- allowed=f, retry_after>0
delete from public.auth_rate_limits where bucket_key = 't:smoke';
```

Expected: third call `allowed = false` with `retry_after` between 1 and 3600.

- [ ] **Step 5: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` now contains a `check_rate_limit` entry under `Database["public"]["Functions"]` with `Args: { p_key: string; p_limit: number; p_window_seconds: number }` and a `Returns` row shape. `git diff` shows only that addition.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<stamp>_auth_rate_limits.sql src/types/database.types.ts
git commit -m "feat(auth): add auth_rate_limits table + check_rate_limit RPC"
```

---

## Task 2: Optional env override for limit tuning

**Files:**

- Modify: `src/lib/env.server.ts`

- [ ] **Step 1: Add the optional var to the schema**

In `src/lib/env.server.ts`, add to `serverEnvSchema` (mirroring the existing optional-var style, e.g. `APP_BASE_URL`):

```ts
  // Optional ops lever for auth rate limits: multiplies every compiled default
  // limit (e.g. "2" doubles all caps, "0.5" halves them). Absent → 1× defaults.
  // Feature works fully without it, like the DIGEST_* optionals above.
  AUTH_RATE_LIMIT_MULTIPLIER: z.coerce
    .number()
    .positive("AUTH_RATE_LIMIT_MULTIPLIER must be a positive number when set")
    .optional(),
```

And add the matching line inside the `safeParse({ … })` object in `getServerEnv`:

```ts
    AUTH_RATE_LIMIT_MULTIPLIER: process.env.AUTH_RATE_LIMIT_MULTIPLIER,
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no consumers yet; `ServerEnv` gains the optional field).

- [ ] **Step 3: Commit**

```bash
git add src/lib/env.server.ts
git commit -m "feat(auth): optional AUTH_RATE_LIMIT_MULTIPLIER env lever"
```

---

## Task 3: Limiter helper + unit tests

**Files:**

- Create: `src/lib/rate-limit/auth-rate-limit.ts`
- Test: `src/lib/rate-limit/auth-rate-limit.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `src/lib/rate-limit/auth-rate-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, headerMap, serverEnv } = vi.hoisted(() => ({
  rpc: vi.fn(),
  headerMap: new Map<string, string>(),
  serverEnv: { value: {} as Record<string, unknown> },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));
vi.mock("next/headers", () => ({ headers: async () => headerMap }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => serverEnv.value }));

import {
  checkRateLimit,
  hashIdentifier,
  getClientIp,
  throttleResult,
} from "./auth-rate-limit";

beforeEach(() => {
  // Default: every rule allowed.
  rpc.mockReset().mockResolvedValue({
    data: [{ allowed: true, retry_after: 0, remaining: 5 }],
    error: null,
  });
  headerMap.clear();
  serverEnv.value = {};
});

describe("hashIdentifier", () => {
  it("is stable, hex, and normalizes case/whitespace", () => {
    expect(hashIdentifier("  User@Example.com ")).toBe(
      hashIdentifier("user@example.com"),
    );
    expect(hashIdentifier("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getClientIp", () => {
  it("reads the first x-forwarded-for hop", async () => {
    headerMap.set("x-forwarded-for", "203.0.113.7, 10.0.0.1");
    expect(await getClientIp()).toBe("203.0.113.7");
  });
  it("falls back to a sentinel when no IP header is present", async () => {
    expect(await getClientIp()).toBe("unknown");
  });
});

describe("checkRateLimit", () => {
  it("allows when every rule is under the cap", async () => {
    const d = await checkRateLimit({ endpoint: "signIn", email: "a@b.co" });
    expect(d).toEqual({ allowed: true });
  });

  it("denies (most-restrictive-wins) and returns retry_after", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ allowed: false, retry_after: 42, remaining: 0 }],
      error: null,
    });
    const d = await checkRateLimit({ endpoint: "signIn", email: "a@b.co" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it("fails OPEN when the RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const d = await checkRateLimit({ endpoint: "signIn", email: "a@b.co" });
    expect(d).toEqual({ allowed: true });
  });
});

describe("throttleResult", () => {
  it("returns a generic error with no PII or account signal", () => {
    const r = throttleResult("signUp", 120);
    expect(r.error).toBeTruthy();
    expect(r.error).not.toMatch(/@|exist|account|found/i);
    expect(r.success).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/rate-limit/auth-rate-limit.test.ts`
Expected: FAIL — `Cannot find module './auth-rate-limit'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/rate-limit/auth-rate-limit.ts`:

```ts
import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getServerEnv } from "@/lib/env.server";
import type { AuthState } from "@/app/auth/actions";

/** A single limit rule: a dimension (which key to bucket on) + the cap. */
type Dimension = "ip" | "ip_email" | "email" | "user";
type Rule = { dimension: Dimension; limit: number; windowSeconds: number };
type Endpoint =
  | "signIn"
  | "signUp"
  | "requestPasswordReset"
  | "changeOwnPassword";

const MINUTE = 60;
const HOUR = 3600;

/** Per-endpoint limits (spec §4). Conservative starting defaults. */
export const RATE_LIMITS: Record<Endpoint, Rule[]> = {
  signIn: [
    { dimension: "ip_email", limit: 5, windowSeconds: 15 * MINUTE },
    { dimension: "ip", limit: 20, windowSeconds: 15 * MINUTE },
  ],
  signUp: [{ dimension: "ip", limit: 5, windowSeconds: HOUR }],
  requestPasswordReset: [
    { dimension: "ip", limit: 5, windowSeconds: HOUR },
    { dimension: "email", limit: 3, windowSeconds: HOUR },
  ],
  changeOwnPassword: [{ dimension: "user", limit: 10, windowSeconds: HOUR }],
};

/** sha256 hex of a normalized identifier — table stores no plaintext PII. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Best-effort client IP from request headers. On Vercel the platform sets a
 * trusted client-IP header; VERIFY the exact header against Vercel docs during
 * impl (candidates: first `x-forwarded-for` hop, or `x-real-ip`). Falls back to
 * a sentinel so the limiter still functions locally / in tests.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type CheckInput = {
  endpoint: Endpoint;
  email?: string;
  userId?: string;
};

function multiplier(): number {
  const m = getServerEnv().AUTH_RATE_LIMIT_MULTIPLIER;
  return typeof m === "number" && m > 0 ? m : 1;
}

/** Build the opaque bucket key for one rule, or null if its dimension can't be
 *  resolved from the given input (e.g. no email supplied). */
async function bucketKey(
  endpoint: Endpoint,
  rule: Rule,
  input: CheckInput,
): Promise<string | null> {
  const email = input.email;
  switch (rule.dimension) {
    case "ip":
      return `${endpoint}:ip:${hashIdentifier(await getClientIp())}`;
    case "email":
      return email ? `${endpoint}:email:${hashIdentifier(email)}` : null;
    case "ip_email":
      return email
        ? `${endpoint}:ip_email:${hashIdentifier(`${await getClientIp()}|${email}`)}`
        : null;
    case "user":
      return input.userId ? `${endpoint}:user:${input.userId}` : null;
  }
}

/**
 * Evaluate all rules for an endpoint; the most restrictive (first denial) wins.
 * Fails OPEN: any RPC error allows the request (availability > perfect
 * throttling for a login page; GoTrue's project limit still backstops).
 */
export async function checkRateLimit(
  input: CheckInput,
): Promise<RateLimitDecision> {
  const rules = RATE_LIMITS[input.endpoint];
  const mult = multiplier();
  const sb = createServiceClient();

  for (const rule of rules) {
    const key = await bucketKey(input.endpoint, rule, input);
    if (!key) continue;
    try {
      const { data, error } = await typedRpc(sb, "check_rate_limit", {
        p_key: key,
        p_limit: Math.max(1, Math.round(rule.limit * mult)),
        p_window_seconds: rule.windowSeconds,
      });
      if (error || !data) {
        console.error("[auth-rate-limit] fail-open: RPC error", {
          endpoint: input.endpoint,
          dimension: rule.dimension,
          error: error?.message,
        });
        continue; // fail open on this rule
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.allowed === false) {
        console.warn("[auth-rate-limit] throttled", {
          event: "auth_rate_limited",
          endpoint: input.endpoint,
          dimension: rule.dimension,
          keyPrefix: key.slice(-8),
          retryAfterSeconds: row.retry_after,
        });
        return { allowed: false, retryAfterSeconds: row.retry_after ?? 0 };
      }
    } catch (err) {
      console.error("[auth-rate-limit] fail-open: threw", {
        endpoint: input.endpoint,
        dimension: rule.dimension,
        err,
      });
      // fail open
    }
  }
  return { allowed: true };
}

/** Generic, enumeration-safe throttle response. Identical regardless of
 *  account existence; carries no email/account signal. */
export function throttleResult(
  _endpoint: Endpoint,
  retryAfterSeconds: number,
): AuthState {
  const mins = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return {
    error: `Too many attempts. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
  };
}
```

> **Note on the `AuthState` import:** it is a `type`-only import from
> `@/app/auth/actions`, so it introduces no runtime cycle (types are erased).
> If the reviewer prefers zero coupling, lift `AuthState` into
> `src/app/auth/types.ts` and import from there in both files — optional.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/lib/rate-limit/auth-rate-limit.test.ts`
Expected: PASS (all 8 assertions).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — `typedRpc(sb, "check_rate_limit", …)` resolves against the Task 1 types with no cast.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rate-limit/auth-rate-limit.ts src/lib/rate-limit/auth-rate-limit.test.ts
git commit -m "feat(auth): add checkRateLimit limiter helper + unit tests"
```

---

## Task 4: Wire the gate into the four auth actions

**Files:**

- Modify: `src/app/auth/actions.ts`
- Test: `src/app/auth/actions.test.ts` (extend)

- [ ] **Step 1: Write the failing action tests**

Add to `src/app/auth/actions.test.ts`. First, extend the hoisted mock block and add a `checkRateLimit` mock module (place with the other `vi.mock` calls, and add `signInWithPassword` to the mocked auth client so `signIn` is testable):

```ts
// --- add to the vi.hoisted destructure ---
const { checkRateLimit, signInWithPassword } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  signInWithPassword: vi.fn(),
}));

// --- add alongside the other vi.mock(...) calls ---
vi.mock("@/lib/rate-limit/auth-rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
  throttleResult: () => ({
    error: "Too many attempts. Please try again in about 1 minute.",
  }),
}));

// --- in the existing @/lib/supabase/server mock, add signInWithPassword ---
// auth: { getUser, updateUser, signUp, resetPasswordForEmail, signInWithPassword }
```

Then in `beforeEach`, default the gate to "allowed":

```ts
checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
signInWithPassword
  .mockReset()
  .mockResolvedValue({ data: { session: null }, error: null });
```

Now the new test blocks:

```ts
import { signIn as signInAction } from "./actions";

const loginFd = (email = "u@example.com", password = "pw") => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
};

describe("rate limiting — throttle short-circuits before Supabase", () => {
  it("signIn returns the throttle error and never calls Supabase", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const res = await signInAction({}, loginFd());
    expect(res.error).toMatch(/too many attempts/i);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("signUp returns the throttle error and never calls Supabase", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const res = await signUpAction({}, signupFd());
    expect(res.error).toMatch(/too many attempts/i);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("requestPasswordReset throttle error is identical for existent & nonexistent emails (anti-enumeration)", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const a = await requestPasswordReset({}, resetFd("real@example.com"));
    const b = await requestPasswordReset({}, resetFd("nobody@example.com"));
    expect(a).toEqual(b);
    expect(a.error).toMatch(/too many attempts/i);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("changeOwnPassword returns the throttle error and never updates", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const res = await changeOwnPassword({}, fd("longenough1"));
    expect(res.error).toMatch(/too many attempts/i);
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("rate limiting — allowed path preserves existing contracts", () => {
  it("signUp still returns check-email when allowed (duplicate == fresh)", async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: {
        code: "user_already_exists",
        message: "User already registered",
      },
    });
    const res = await signUpAction({}, signupFd());
    expect(res).toEqual({ success: "check-email" });
  });

  it("requestPasswordReset still returns reset-email-sent when allowed", async () => {
    const res = await requestPasswordReset({}, resetFd("user@example.com"));
    expect(res).toEqual({ success: "reset-email-sent" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/app/auth/actions.test.ts`
Expected: FAIL — the throttle tests fail because `actions.ts` doesn't call `checkRateLimit` yet (Supabase mocks get called / no throttle error returned).

- [ ] **Step 3: Wire the gate into `actions.ts`**

Add the import at the top of `src/app/auth/actions.ts`:

```ts
import {
  checkRateLimit,
  throttleResult,
} from "@/lib/rate-limit/auth-rate-limit";
```

In **`signIn`**, after the `if (!parsed.success)` block and before `const supabase = await createClient();`:

```ts
const gate = await checkRateLimit({
  endpoint: "signIn",
  email: parsed.data.email,
});
if (!gate.allowed) return throttleResult("signIn", gate.retryAfterSeconds);
```

In **`signUp`**, after the `if (!parsed.success)` block and before `const origin = await getOrigin();`:

```ts
const gate = await checkRateLimit({
  endpoint: "signUp",
  email: parsed.data.email,
});
if (!gate.allowed) return throttleResult("signUp", gate.retryAfterSeconds);
```

In **`requestPasswordReset`**, after the `if (!parsed.success)` block and before `const origin = await getOrigin();`:

```ts
const gate = await checkRateLimit({
  endpoint: "requestPasswordReset",
  email: parsed.data.email,
});
if (!gate.allowed)
  return throttleResult("requestPasswordReset", gate.retryAfterSeconds);
```

In **`changeOwnPassword`**, the user isn't known until after `getUser()`. Move the gate to run **after** the `if (!user) redirect("/login");` line and before `supabase.auth.updateUser(...)`:

```ts
const gate = await checkRateLimit({
  endpoint: "changeOwnPassword",
  userId: user.id,
});
if (!gate.allowed)
  return throttleResult("changeOwnPassword", gate.retryAfterSeconds);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/app/auth/actions.test.ts`
Expected: PASS — new throttle + contract tests pass, and all pre-existing tests (enumeration hardening, host trust) still pass.

- [ ] **Step 5: Full gate sweep**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/auth/actions.ts src/app/auth/actions.test.ts
git commit -m "feat(auth): rate-limit signIn/signUp/reset/changePassword actions"
```

---

## Task 5: DB-level integration test (opt-in, DEV)

**Files:**

- Create: `src/lib/rate-limit/auth-rate-limit.integration.test.ts`

This follows the repo's opt-in integration pattern: the suite **skips** unless
`PULSE_TEST_DB` is set (matches `rls.integration.test.ts` /
`function-execute-grants.integration.test.ts`), so it never runs (or pollutes)
in normal CI. Confirm the exact env-gate + client-construction pattern by
reading an existing `*.integration.test.ts` before writing.

- [ ] **Step 1: Write the integration test**

Create `src/lib/rate-limit/auth-rate-limit.integration.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createServiceClient } from "@/lib/supabase/service";

// Opt-in only: skip unless a real DEV DB is wired (repo convention).
const RUN = !!process.env.PULSE_TEST_DB;
const d = RUN ? describe : describe.skip;

const KEY = `itest:${Date.now()}:${Math.random().toString(36).slice(2)}`;

d("check_rate_limit (DEV DB)", () => {
  afterEach(async () => {
    const sb = createServiceClient();
    await sb.from("auth_rate_limits").delete().eq("bucket_key", KEY);
  });

  it("allows up to the cap, then denies with a positive retry_after", async () => {
    const sb = createServiceClient();
    const call = () =>
      sb.rpc("check_rate_limit", {
        p_key: KEY,
        p_limit: 2,
        p_window_seconds: 3600,
      });

    const r1 = await call();
    const r2 = await call();
    const r3 = await call();

    expect(r1.data?.[0]?.allowed).toBe(true);
    expect(r2.data?.[0]?.allowed).toBe(true);
    expect(r3.data?.[0]?.allowed).toBe(false);
    expect(r3.data?.[0]?.retry_after).toBeGreaterThan(0);
    expect(r3.data?.[0]?.retry_after).toBeLessThanOrEqual(3600);
  });

  it("resets the window when p_window_seconds has elapsed", async () => {
    const sb = createServiceClient();
    // window = 1s: first call consumes it, sleep past the window, next resets.
    await sb.rpc("check_rate_limit", {
      p_key: KEY,
      p_limit: 1,
      p_window_seconds: 1,
    });
    const denied = await sb.rpc("check_rate_limit", {
      p_key: KEY,
      p_limit: 1,
      p_window_seconds: 1,
    });
    expect(denied.data?.[0]?.allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    const reset = await sb.rpc("check_rate_limit", {
      p_key: KEY,
      p_limit: 1,
      p_window_seconds: 1,
    });
    expect(reset.data?.[0]?.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it (skipped in default CI)**

Run: `pnpm test src/lib/rate-limit/auth-rate-limit.integration.test.ts`
Expected: SKIPPED (no `PULSE_TEST_DB`). To actually exercise it against DEV, run with `PULSE_TEST_DB=1 pnpm test …` locally and expect PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rate-limit/auth-rate-limit.integration.test.ts
git commit -m "test(auth): DB-level check_rate_limit windowing integration test"
```

---

## Final verification (working agreement #4)

- [ ] Run the full gate from inside the worktree:

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four PASS.

- [ ] Confirm the DEV ledger matches the committed migration filename:

Use `mcp__supabase-dev__list_migrations` and check the `<stamp>_auth_rate_limits` row is present with the same version as the file. Run `scripts/reconcile-migration-version.sh` on any drift.

- [ ] Finish the task:

Run: `scripts/finish-task.sh` (rebases onto `develop`, re-runs gates, merges, pushes, removes the worktree + branch).

---

## Manual test guide (hand to the user after merge)

> Setup: pull `develop`. The limiter runs against the **DEV** Supabase project
> (the migration was applied there); local `.env.local` points at DEV.

1. **Reset abuse is throttled.** Go to `/forgot-password`. Submit the same email
   6 times quickly (default cap: 5 / hour per IP, 3 / hour per email). Expected:
   the first few show the normal "reset email sent" confirmation; once the cap
   trips you get a banner: _"Too many attempts. Please try again in about N
   minutes."_ — and no further reset emails arrive.
2. **The throttle message leaks nothing.** Repeat step 1 with an email you know
   is **not** registered. Expected: the throttle banner is **byte-identical** to
   step 1 — you cannot tell from the response whether the account exists.
3. **Brute-force sign-in is throttled.** Go to `/login`. Enter a real email with
   a wrong password and submit ~6 times (default: 5 / 15 min per IP+email).
   Expected: the first attempts show the normal "invalid credentials" error;
   after the cap you get the generic "Too many attempts…" banner instead, and
   sign-in stops being attempted server-side.
4. **Recovery after the window.** Wait out the window (or, for a quick check, ask
   an operator to `delete from auth_rate_limits` on DEV). Expected: the next
   attempt is accepted normally — the limiter is a cooldown, not a permanent
   lock.
5. **Signup spam is throttled.** On `/signup`, create accounts (distinct emails)
   6 times from one browser (default: 5 / hour per IP). Expected: after the cap,
   the throttle banner appears instead of the "check your email" screen.

> If the DB/limiter is unavailable, auth **fails open** (requests are allowed and
> the error is logged) — so a limiter outage never locks users out of logging in.

---

## Self-Review notes

- **Spec coverage:** §3 arch → Tasks 1+3; §4 limits → Task 3 `RATE_LIMITS`; §5
  keys/PII → `hashIdentifier`/`bucketKey` (Task 3); §6 anti-enumeration UX →
  `throttleResult` (Task 3) + anti-enumeration tests (Task 4); §7 fail-open +
  observability → `checkRateLimit` catch/log (Task 3); §8 env → Task 2; §9 perf
  → PK point-lookup RPC (Task 1); §11 tests → Tasks 3/4/5. All covered.
- **Open question (spec §12):** the default `signIn` config here omits the global
  per-email cap. If the owner opts into it, add one line to `RATE_LIMITS.signIn`
  (`{ dimension: "email", limit: 30, windowSeconds: 15 * MINUTE }`) and a test —
  no structural change.
- **Type consistency:** `checkRateLimit` / `throttleResult` / `RateLimitDecision`
  / `AuthState` names are used identically across Tasks 3 and 4; the RPC name
  `check_rate_limit` and its args (`p_key`, `p_limit`, `p_window_seconds`) match
  across Tasks 1, 3, and 5.
