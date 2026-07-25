# Rate-limit `/api/oauth/register` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Throttle the unauthenticated RFC 7591 dynamic client registration endpoint so anonymous callers can no longer flood `public.oauth_clients` — without breaking legitimate first-time Claude Desktop / Claude Code / claude.ai connects.

**Architecture:** Extend the canonical limiter `src/lib/rate-limit/auth-rate-limit.ts` with a new `"oauthRegister"` endpoint (two rules: `ip` 10 / 10 min for burst control, plus a new `global` dimension at 200 / h as the IP-rotation-proof ceiling), and a per-endpoint **fail-CLOSED** policy that only `oauthRegister` opts into. The route handler gains a one-line gate as its very first statement — before the body is even read — and renders a 429 + `Retry-After` + OAuth `temporarily_unavailable` body. **No third rate-limit module, no new migration** (`public.check_rate_limit` is already a generic bucket-keyed fixed-window RPC and is already in `database.types.ts`), no new env var.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript strict, Supabase (`typedRpc` → `check_rate_limit` SECURITY DEFINER RPC via the service client), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-oauth-register-rate-limit-design.md`

**Worktree:** all work happens in `.claude/worktrees/oauth-register-ratelimit` on `task/oauth-register-ratelimit`.

---

## File Structure

| File                                         | Responsibility                                                                                                                                     | Task |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/lib/rate-limit/auth-rate-limit.ts`      | Modify: `+ "oauthRegister"` on `Endpoint`, `+ "global"` on `Dimension` (+ its `bucketKey` case), `RATE_LIMITS.oauthRegister`, `FAIL_CLOSED` policy | 1    |
| `src/lib/rate-limit/auth-rate-limit.test.ts` | Modify (append): rule shape, bucket keys, short-circuit, fail-closed, fail-open regression, multiplier                                             | 1    |
| `src/lib/env.server.ts`                      | Modify: widen the `AUTH_RATE_LIMIT_MULTIPLIER` doc comment from "auth rate limits" to "app-level rate limits"                                      | 2    |
| `src/app/api/oauth/register/route.ts`        | Modify: gate as the first statement + a local `throttled()` 429 builder                                                                            | 3    |
| `src/app/api/oauth/register/route.test.ts`   | Create: route-level tests (201 regression, 429 shape, no-write-when-throttled, gate ordering, 400 regression)                                      | 3    |

**Explicitly NOT touched:** `src/lib/rate-limit/mcp-rate-limit.ts` (and its test) — `RateLimitDecision` is unchanged, so the `/api/mcp` limiter needs no edit. No `supabase/migrations/**`, no `src/types/database.types.ts`, no `scripts/new-migration.sh`, no `supabase-dev` MCP apply, no `pnpm db:types`.

---

## Execution DAG (working agreement #6)

**Dependency edges (Consumes / Produces):**

- **Task 1 — limiter policy.** Consumes: nothing. Produces: the `"oauthRegister"` member of the `Endpoint` union, `RATE_LIMITS.oauthRegister`, the `"global"` dimension, and fail-closed behavior for that endpoint. This is what makes `checkRateLimit({ endpoint: "oauthRegister" })` a legal, correct call.
- **Task 2 — env doc comment.** Consumes: nothing. Produces: a widened doc comment in `src/lib/env.server.ts`. _Independent of Tasks 1 and 3_ — different file, no shared symbol.
- **Task 3 — route gate.** Consumes: Task 1's `"oauthRegister"` endpoint. This is a **hard** edge, not a stylistic one: `checkRateLimit({ endpoint: "oauthRegister" })` fails `tsc` until Task 1 lands, because `Endpoint` is a closed union. Produces: the gated route + its tests.

**Dependency graph:**

```
Task 1 ──> Task 3
Task 2 (independent)
```

**Parallel batches (waves of concurrent agents):**

- **Batch A (parallel):** Task 1, Task 2 — disjoint files (`src/lib/rate-limit/*` vs `src/lib/env.server.ts`), no shared symbol, safe to run as two concurrent agents in the one worktree.
- **Batch B:** Task 3 — depends on Task 1.

**Critical path (wall-clock floor):** Task 1 → Task 3 (**depth 2**). Task 2 folds into Batch A for free.

This change is small and the DAG is honestly shallow. Splitting it further to manufacture parallelism would be theatre — two of the three tasks touch a single file each, and Task 3 cannot start before Task 1 typechecks. If you are executing solo rather than dispatching agents, run 1 → 3 → 2 sequentially; it is a handful of minutes either way.

**Mapping to the spec's independent units (§10):** spec Unit 1 = Task 1, spec Unit 2 (route) = **Task 3**, spec Unit 3 (doc comment) = **Task 2**. The plan reorders 2 and 3 so the two Batch-A tasks are numbered adjacently.

---

## Performance & data-fetching budget (working agreement #5)

Restated here so an executing agent does not have to open the spec (full reasoning in §8 there):

- **(a) First paint vs. interaction — N/A, and that is the honest answer.** This is a
  machine-to-machine JSON endpoint, not a UI. There are no views, tabs, filters, or sorts over the
  same data, hence no in-page toggles and no RSC navigation to avoid. The "0 new server round-trips
  on an in-page toggle" clause has no subject here.
- **(b) Does the interaction change server data?** Yes — registration is a write. It already lives
  in a `POST` Route Handler because the OAuth/MCP specs mandate that shape (external clients call
  the URL directly, so a Server Action is not an option). The gate adds one more write, the counter
  upsert. Neither participates in RSC caching and there is nothing to revalidate — no page in the
  app reads `oauth_clients`.
- **(c) Is the hot-path read bounded over indexed columns?** Yes, trivially. Each rule is a single
  `insert … on conflict (bucket_key) do update` against `auth_rate_limits`, whose **primary key is
  `bucket_key`** — a one-row, index-only O(1) upsert. No `select *`, no scan, no unbounded read over
  a growing table. The generated `check_rate_limit` types are already committed, so no query is
  hand-rolled.
- **Added cost:** 1 RPC when the `ip` rule denies (`checkRateLimit` returns on first denial), 2
  otherwise. This is a **cold path** — once per connector install — on a request that already does a
  DB INSERT plus a client network round-trip, so the relative overhead is negligible. It is on no
  user-facing render path.
- **Row growth in `auth_rate_limits`:** bounded by (distinct client IPs in a 10-minute window) + 1
  global row, ~100 bytes each. These are the rows that _prevent_ the far larger `oauth_clients`
  growth. Bulk pruning of expired rows remains the pre-existing follow-up documented in
  `20260715151219_auth_rate_limits.sql`; this change does not materially worsen it.
- **Accepted cost — single-row contention on the global bucket.** Every registration upserts the
  _same_ `bucket_key`, so concurrent requests serialize on one row lock. Postgres single-row upsert
  throughput is orders of magnitude above the 200/h cap, so the lock is never the bottleneck for
  legitimate traffic; under a flood the serialization is desirable — it is admission control on a
  low-volume endpoint. Do not "optimize" this away by dropping the global rule; it is the only rule
  IP rotation cannot evade.

---

## Task 1: Limiter policy — `oauthRegister` endpoint, `global` dimension, fail-CLOSED

**Files:**

- Modify: `src/lib/rate-limit/auth-rate-limit.ts`
- Test: `src/lib/rate-limit/auth-rate-limit.test.ts` (append a new `describe` block; do not alter existing tests)

**Context you need before starting:** read `src/lib/rate-limit/auth-rate-limit.ts` end to end (161 lines). It evaluates an ordered array of `Rule`s per endpoint and **returns on the first denial**, so rule order is load-bearing. It currently fails **open** on any RPC error (`continue` past the rule) or throw (swallow) — Task 1's job is to make that fail mode a per-endpoint policy without changing the default for existing endpoints.

- [ ] **Step 1: Write the failing tests**

Append this block to the **end** of `src/lib/rate-limit/auth-rate-limit.test.ts`. The file already provides everything these tests use: the hoisted `rpc` / `headerMap` / `serverEnv` mocks, the `allow` and `deny(retry)` fixtures, and a `beforeEach` that resets `rpc` to always-allow, clears the headers, and empties the env.

```ts
describe("oauthRegister (RFC 7591 dynamic client registration)", () => {
  it("configures an ip burst rule and a global ceiling rule", () => {
    expect(RATE_LIMITS.oauthRegister).toEqual([
      { dimension: "ip", limit: 10, windowSeconds: 600 },
      { dimension: "global", limit: 200, windowSeconds: 3600 },
    ]);
  });

  it("evaluates ip then global, with a hashed ip key and a literal global key", async () => {
    headerMap.set("x-forwarded-for", "203.0.113.7");
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "check_rate_limit", {
      p_key: `oauthRegister:ip:${hashIdentifier("203.0.113.7")}`,
      p_limit: 10,
      p_window_seconds: 600,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "check_rate_limit", {
      p_key: "oauthRegister:global",
      p_limit: 200,
      p_window_seconds: 3600,
    });
  });

  it("never puts a plaintext IP in the bucket key", async () => {
    headerMap.set("x-forwarded-for", "203.0.113.7");
    await checkRateLimit({ endpoint: "oauthRegister" });
    const [, args] = rpc.mock.calls[0] as [string, { p_key: string }];
    expect(args.p_key).not.toContain("203.0.113.7");
    expect(args.p_key).toMatch(/^oauthRegister:ip:[0-9a-f]{64}$/);
  });

  it("denies on the ip rule and short-circuits the global RPC", async () => {
    rpc.mockReset().mockResolvedValueOnce(deny(120));
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 120 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("denies when ONLY the global ceiling trips", async () => {
    // ip allowed, global DENIED — a one-rule config could never reach this
    // second call, so a pass proves the global backstop is actually wired.
    rpc
      .mockReset()
      .mockResolvedValueOnce(allow) // ip
      .mockResolvedValueOnce(deny(3000)); // global
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 3000 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("scales both caps by AUTH_RATE_LIMIT_MULTIPLIER", async () => {
    serverEnv.value = { AUTH_RATE_LIMIT_MULTIPLIER: 2 };
    await checkRateLimit({ endpoint: "oauthRegister" });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "check_rate_limit",
      expect.objectContaining({ p_limit: 20 }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "check_rate_limit",
      expect.objectContaining({ p_limit: 400 }),
    );
  });

  it("fails CLOSED when the RPC errors", async () => {
    rpc
      .mockReset()
      .mockResolvedValue({ data: null, error: { message: "db down" } });
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("fails CLOSED when the RPC throws", async () => {
    rpc.mockReset().mockRejectedValue(new Error("network timeout"));
    const d = await checkRateLimit({ endpoint: "oauthRegister" });
    expect(d).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("leaves every other endpoint failing OPEN (the divergence is endpoint-scoped)", async () => {
    rpc
      .mockReset()
      .mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(
      checkRateLimit({ endpoint: "signIn", email: "a@b.co" }),
    ).resolves.toEqual({ allowed: true });
    rpc.mockReset().mockRejectedValue(new Error("boom"));
    await expect(
      checkRateLimit({ endpoint: "signUp", email: "a@b.co" }),
    ).resolves.toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/rate-limit/auth-rate-limit.test.ts`

Expected: the new `oauthRegister` block fails. Because `Endpoint` is a closed union, most failures surface as a TypeScript error surfaced by Vitest's transform or as `RATE_LIMITS.oauthRegister` being `undefined` (`Cannot read properties of undefined (reading 'map')` / `TypeError: rules is not iterable`). The nine pre-existing tests in the file must still **pass**.

- [ ] **Step 3: Extend the `Dimension` and `Endpoint` unions**

In `src/lib/rate-limit/auth-rate-limit.ts`, replace:

```ts
/** A single limit rule: a dimension (which key to bucket on) + the cap. */
type Dimension = "ip" | "ip_email" | "email" | "user";
type Rule = { dimension: Dimension; limit: number; windowSeconds: number };
type Endpoint =
  | "signIn"
  | "signUp"
  | "requestPasswordReset"
  | "changeOwnPassword";
```

with:

```ts
/** A single limit rule: a dimension (which key to bucket on) + the cap.
 *  `global` is a single shared bucket for ALL callers — the only dimension an
 *  IP-rotating caller cannot evade. Use it as a ceiling, never as the primary
 *  rule: it is deliberately griefable in exchange for a hard bound. */
type Dimension = "ip" | "ip_email" | "email" | "user" | "global";
type Rule = { dimension: Dimension; limit: number; windowSeconds: number };
type Endpoint =
  | "signIn"
  | "signUp"
  | "requestPasswordReset"
  | "changeOwnPassword"
  | "oauthRegister";
```

- [ ] **Step 4: Add the `oauthRegister` rule set**

In the same file, inside `RATE_LIMITS`, add a new entry immediately after the `changeOwnPassword` line. Replace:

```ts
  changeOwnPassword: [{ dimension: "user", limit: 10, windowSeconds: HOUR }],
};
```

with:

```ts
  changeOwnPassword: [{ dimension: "user", limit: 10, windowSeconds: HOUR }],
  // RFC 7591 dynamic client registration (/api/oauth/register). Spec-mandated
  // PUBLIC and unauthenticated: the body is entirely caller-supplied, there is
  // no session/token/account, so IP is the only per-caller signal that exists.
  // Two rules, in this order (checkRateLimit returns on the FIRST denial, so a
  // single-host flood costs one RPC and never reaches the global bucket):
  //   1. ip — burst control. A legitimate MCP client needs exactly ONE
  //      registration; 10 is 10x headroom for retries and for several concurrent
  //      setups behind one NAT. The window is deliberately SHORT (10 min, not an
  //      hour) because claude.ai registers from its own BACKEND — one shared
  //      Anthropic egress IP fronts every claude.ai user connecting to this
  //      deployment, so an overshoot there must self-heal in minutes rather than
  //      lock onboarding out for an hour.
  //   2. global — the only rule IP rotation cannot evade, and therefore the
  //      actual bound on oauth_clients growth (<= 4,800 rows/day worst case
  //      instead of unbounded). Kept generous: real volume here is single digits
  //      per day, so 200/h is ~2 orders of magnitude of headroom. This bucket IS
  //      griefable — an attacker can burn it to block new registrations — but
  //      only until the fixed window elapses (check_rate_limit never pushes
  //      window_start forward on a denial), and only for NEW connector setups;
  //      live connections go through /api/oauth/token + /api/mcp, untouched.
  oauthRegister: [
    { dimension: "ip", limit: 10, windowSeconds: 10 * MINUTE },
    { dimension: "global", limit: 200, windowSeconds: HOUR },
  ],
};
```

- [ ] **Step 5: Add the `global` case to `bucketKey`**

Still in `src/lib/rate-limit/auth-rate-limit.ts`, in the `switch (rule.dimension)` inside `bucketKey`, add the new case after the `"user"` case. Replace:

```ts
    case "user":
      return input.userId ? `${endpoint}:user:${input.userId}` : null;
  }
```

with:

```ts
    case "user":
      return input.userId ? `${endpoint}:user:${input.userId}` : null;
    case "global":
      // No identifier, so nothing to hash. Kept literal (not a digest) so the
      // bucket stays inspectable and manually resettable during an incident:
      //   delete from auth_rate_limits where bucket_key = 'oauthRegister:global';
      return `${endpoint}:global`;
  }
```

Note: `bucketKey` is annotated `Promise<string | null>` with no `default`, so under `strict` the compiler would have rejected the new union member without this case. That is the intended guard — do not add a `default`.

- [ ] **Step 6: Add the fail-CLOSED policy**

Still in the same file, insert this block immediately **after** the `RATE_LIMITS` object and **before** `export function hashIdentifier`:

```ts
/**
 * Endpoints that DENY when the limiter itself is unavailable (RPC error/throw).
 *
 * The module default is fail-OPEN — availability beats perfect throttling on a
 * login page, and GoTrue's own project limits backstop it. An endpoint opts in
 * here only when an unmetered failure mode IS the vulnerability.
 *
 * `oauthRegister` qualifies: it is unauthenticated and every success writes an
 * `oauth_clients` row, so a fail-open limiter fault silently restores exactly
 * the unbounded-anonymous-write hole the limit exists to close. The objection
 * "if Postgres is down the INSERT fails anyway" misses the mode that matters —
 * one where ONLY the limiter is broken (`check_rate_limit` missing or its
 * `execute` grant revoked after a migration drift; lock/bloat confined to
 * `auth_rate_limits`). This repo has shipped that class of bug
 * ([[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]]), and
 * fail-closed makes it loud on the first request instead of silently unlimited.
 *
 * The blast radius of denying is small and does not cascade: only NEW MCP client
 * registrations fail. /api/oauth/{authorize,token} and /api/mcp are untouched,
 * so no live agent connection and no signed-in user is affected — the cost is
 * one more click on "Connect", and the 429 carries Retry-After.
 */
const FAIL_CLOSED: ReadonlySet<Endpoint> = new Set<Endpoint>(["oauthRegister"]);

/** Retry-After for a fail-CLOSED denial. No real window information exists in
 *  this branch, so use a fixed conservative backoff. */
const UNAVAILABLE_RETRY_AFTER_SECONDS = 60;
```

- [ ] **Step 7: Branch both failure paths on the policy**

Still in the same file, in `checkRateLimit`. First replace the RPC-error branch:

```ts
if (error || !data) {
  console.error("[auth-rate-limit] fail-open: RPC error", {
    endpoint: input.endpoint,
    dimension: rule.dimension,
    error: error?.message,
  });
  continue; // fail open on this rule
}
```

with:

```ts
if (error || !data) {
  if (FAIL_CLOSED.has(input.endpoint)) {
    console.error("[auth-rate-limit] fail-closed: limiter unavailable", {
      event: "rate_limit_backend_unavailable",
      endpoint: input.endpoint,
      dimension: rule.dimension,
      error: error?.message,
    });
    return {
      allowed: false,
      retryAfterSeconds: UNAVAILABLE_RETRY_AFTER_SECONDS,
    };
  }
  console.error("[auth-rate-limit] fail-open: RPC error", {
    endpoint: input.endpoint,
    dimension: rule.dimension,
    error: error?.message,
  });
  continue; // fail open on this rule
}
```

Then replace the `catch` block:

```ts
    } catch (err) {
      console.error("[auth-rate-limit] fail-open: threw", {
        endpoint: input.endpoint,
        dimension: rule.dimension,
        err,
      });
      // fail open
    }
```

with:

```ts
    } catch (err) {
      if (FAIL_CLOSED.has(input.endpoint)) {
        console.error("[auth-rate-limit] fail-closed: limiter threw", {
          event: "rate_limit_backend_unavailable",
          endpoint: input.endpoint,
          dimension: rule.dimension,
          err,
        });
        return {
          allowed: false,
          retryAfterSeconds: UNAVAILABLE_RETRY_AFTER_SECONDS,
        };
      }
      console.error("[auth-rate-limit] fail-open: threw", {
        endpoint: input.endpoint,
        dimension: rule.dimension,
        err,
      });
      // fail open
    }
```

The distinct `fail-closed:` log tag plus the `rate_limit_backend_unavailable` event field is the observability that lets an operator tell a **limiter outage** apart from an **actual flood** (`[auth-rate-limit] throttled` / `auth_rate_limited`) in Vercel logs.

- [ ] **Step 8: Update the two stale doc comments**

Still in `src/lib/rate-limit/auth-rate-limit.ts`. Replace the `RATE_LIMITS` doc comment:

```ts
/** Per-endpoint limits (spec §4). Conservative starting defaults. */
```

with:

```ts
/** Per-endpoint limits. Conservative starting defaults. This module is the
 *  app-level limiter of record — the four auth server actions AND the public
 *  OAuth dynamic-registration endpoint. Rule ORDER matters: evaluation stops at
 *  the first denial, so put the cheapest/most-likely-to-trip rule first. */
```

Then replace the `checkRateLimit` doc comment:

```ts
/**
 * Evaluate all rules for an endpoint; the most restrictive (first denial) wins.
 * Fails OPEN: any RPC error allows the request (availability > perfect
 * throttling for a login page; GoTrue's project limit still backstops).
 */
```

with:

```ts
/**
 * Evaluate all rules for an endpoint; the most restrictive (first denial) wins.
 * Fails OPEN by default: an RPC error allows the request (availability >
 * perfect throttling for a login page; GoTrue's project limit still backstops).
 * Endpoints listed in FAIL_CLOSED invert that and DENY on limiter failure — see
 * that constant for why /api/oauth/register is one of them.
 */
```

Finally, extend the `throttleResult` doc comment so nobody reaches for it from an HTTP route. Replace:

```ts
/** Generic, enumeration-safe throttle response. Identical regardless of
 *  account existence; carries no email/account signal. */
```

with:

```ts
/** Generic, enumeration-safe throttle response. Identical regardless of
 *  account existence; carries no email/account signal.
 *
 *  AuthState is the React form-state shape for the auth UI — it is NOT an HTTP
 *  body. HTTP endpoints (e.g. /api/oauth/register) must render their own OAuth
 *  error response (429 + Retry-After + {error, error_description}) instead. */
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/rate-limit/auth-rate-limit.test.ts`

Expected: PASS — all 9 pre-existing tests plus the 9 new `oauthRegister` tests. (`console.error` output from the fail-open/fail-closed tests is expected and not a failure.)

- [ ] **Step 10: Verify the untouched limiter still passes**

Run: `pnpm vitest run src/lib/rate-limit/mcp-rate-limit.test.ts src/lib/mcp/context.test.ts`

Expected: PASS, unchanged. This confirms `RateLimitDecision` was not altered and the `/api/mcp` path is unaffected.

- [ ] **Step 11: Typecheck**

Run: `pnpm typecheck`

Expected: no errors. If you see `Function lacks ending return statement` in `bucketKey`, Step 5's `case "global"` is missing.

- [ ] **Step 12: Commit**

```bash
git add src/lib/rate-limit/auth-rate-limit.ts src/lib/rate-limit/auth-rate-limit.test.ts
git commit -m "$(cat <<'EOF'
feat(rate-limit): oauthRegister endpoint with a global ceiling, fail-closed

Adds an "oauthRegister" entry to the canonical limiter: ip 10/10min for
burst control plus a new "global" dimension at 200/h, the only rule an
IP-rotating caller cannot evade and therefore the actual bound on
oauth_clients growth. The short ip window is deliberate — claude.ai
registers from its own backend, so one shared egress IP fronts every
claude.ai user and must self-heal in minutes.

Also introduces a per-endpoint FAIL_CLOSED policy. Everything existing
keeps failing open; oauthRegister denies on limiter failure, because it is
unauthenticated and every success writes a row, so fail-open there would
silently restore the exact hole the limit closes. Reuses the generic
check_rate_limit RPC — no migration.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Widen the `AUTH_RATE_LIMIT_MULTIPLIER` doc comment

**Files:**

- Modify: `src/lib/env.server.ts`

**Why:** the var now scales the OAuth registration caps too, so the comment saying "auth rate limits" is actively misleading — someone tuning it in an incident needs to know it moves `/api/oauth/register` as well. The var **name** stays as-is: renaming it is a breaking ops change (it is already set in Vercel envs) for a cosmetic gain. Comment-only change, no test.

- [ ] **Step 1: Edit the comment**

In `src/lib/env.server.ts`, replace:

```ts
// Optional ops lever for auth rate limits: multiplies every compiled default
// limit (e.g. "2" doubles all caps, "0.5" halves them). Absent → 1× defaults.
// Feature works fully without it, like the DIGEST_* optionals above.
```

with:

```ts
// Optional ops lever for ALL app-level rate limits in
// src/lib/rate-limit/auth-rate-limit.ts — the four auth server actions AND
// the public OAuth dynamic-registration endpoint (/api/oauth/register).
// Multiplies every compiled default limit (e.g. "2" doubles all caps, "0.5"
// halves them). Absent → 1× defaults. Feature works fully without it, like
// the DIGEST_* optionals above. Name kept AUTH_-prefixed for continuity —
// renaming it would break already-provisioned Vercel envs.
```

- [ ] **Step 2: Verify nothing broke**

Run: `pnpm typecheck && pnpm vitest run src/lib/env.server.test.ts`

Expected: typecheck clean, and the existing `env.server` suite PASSES unchanged. This step changes only a comment, so any failure here means you edited code by accident — revert and redo.

- [ ] **Step 3: Commit**

```bash
git add src/lib/env.server.ts
git commit -m "$(cat <<'EOF'
docs(env): AUTH_RATE_LIMIT_MULTIPLIER covers oauth registration too

The multiplier now scales /api/oauth/register's caps as well as the auth
actions'. Name kept for continuity — it is already provisioned in Vercel.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Gate the route and render the OAuth 429

**Depends on:** Task 1 (`checkRateLimit({ endpoint: "oauthRegister" })` will not typecheck before it).

**Files:**

- Modify: `src/app/api/oauth/register/route.ts`
- Create: `src/app/api/oauth/register/route.test.ts`

**Context you need before starting:** the current route is 33 lines — `req.json()` → `registerClientSchema.safeParse` → 400 `invalid_client_metadata` on failure → `registerOauthClient()` → 201 with a fixed metadata body. **None of that changes.** You are prepending a gate and adding one local helper. The test pattern to follow is `src/app/api/ai/embed/route.test.ts`: mock the collaborators with `vi.mock`, build a real `Request`, call the exported `POST` directly.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/oauth/register/route.test.ts` with exactly this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// checkRateLimit is mocked WHOLESALE rather than at the RPC level: the real one
// resolves the client IP through next/headers, which needs a request scope a
// route unit test has no business faking. The rule/bucket-key/fail-closed
// behavior is covered in src/lib/rate-limit/auth-rate-limit.test.ts.
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit/auth-rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

const registerOauthClient = vi.fn();
vi.mock("@/lib/mcp/oauth/client-store", () => ({
  registerOauthClient: (...a: unknown[]) => registerOauthClient(...a),
}));

import { POST } from "./route";

const VALID = {
  client_name: "Claude Desktop",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
};

/** Build a POST Request. Pass a string to send a deliberately unparseable body. */
function req(body: unknown) {
  return new Request("http://x/api/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const throttle = (retryAfterSeconds: number) => ({
  allowed: false,
  retryAfterSeconds,
});

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ allowed: true });
  registerOauthClient.mockResolvedValue({
    client_id: "c1",
    client_name: VALID.client_name,
    redirect_uris: VALID.redirect_uris,
  });
});

describe("POST /api/oauth/register — rate limit gate", () => {
  it("gates on the oauthRegister endpoint exactly once", async () => {
    await POST(req(VALID));
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith({ endpoint: "oauthRegister" });
  });

  it("returns 429 with Retry-After and the OAuth error body when throttled", async () => {
    checkRateLimit.mockResolvedValue(throttle(47));
    const res = await POST(req(VALID));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("47");
    const body = (await res.json()) as Record<string, string>;
    expect(body.error).toBe("temporarily_unavailable");
    expect(body.error_description).toContain("47");
  });

  it("writes NO client row when throttled", async () => {
    checkRateLimit.mockResolvedValue(throttle(47));
    await POST(req(VALID));
    expect(registerOauthClient).not.toHaveBeenCalled();
  });

  it("marks the throttle response no-store", async () => {
    checkRateLimit.mockResolvedValue(throttle(47));
    const res = await POST(req(VALID));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaks no dimension or remaining count in the throttle body", async () => {
    checkRateLimit.mockResolvedValue(throttle(47));
    const res = await POST(req(VALID));
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["error", "error_description"]);
    expect(JSON.stringify(body)).not.toMatch(/remaining|global|\bip\b/i);
  });

  it("gates BEFORE parsing the body — a malformed body while throttled is 429, not 400", async () => {
    checkRateLimit.mockResolvedValue(throttle(5));
    const res = await POST(req("not json"));
    expect(res.status).toBe(429);
  });
});

describe("POST /api/oauth/register — existing behavior is unchanged", () => {
  it("registers and returns 201 when the gate allows", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      client_id: "c1",
      client_name: "Claude Desktop",
      redirect_uris: VALID.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(registerOauthClient).toHaveBeenCalledWith(VALID);
  });

  it("still rejects invalid metadata with 400 invalid_client_metadata", async () => {
    const res = await POST(req({ client_name: "", redirect_uris: [] }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_client_metadata",
    });
    expect(registerOauthClient).not.toHaveBeenCalled();
  });

  it("still rejects an unparseable body with 400 when the gate allows", async () => {
    const res = await POST(req("not json"));
    expect(res.status).toBe(400);
    expect(registerOauthClient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/app/api/oauth/register/route.test.ts`

Expected: the gate tests FAIL — the throttle tests return `201` instead of `429` and `checkRateLimit` records 0 calls, because the route does not call it yet. The three "existing behavior" tests should already PASS.

- [ ] **Step 3: Rewrite the route with the gate**

Replace the entire contents of `src/app/api/oauth/register/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { registerClientSchema } from "@/lib/validations/mcp-oauth";
import { registerOauthClient } from "@/lib/mcp/oauth/client-store";
import { checkRateLimit } from "@/lib/rate-limit/auth-rate-limit";

/**
 * The throttle response.
 *
 * RFC 7591 §3.2.2 shapes registration ERRORS as HTTP 400 with a closed code set
 * (invalid_redirect_uri / invalid_client_metadata / invalid_software_statement /
 * unapproved_software_statement). A throttle is not a registration error — the
 * submitted metadata IS valid — so answering 400/invalid_client_metadata would
 * tell the client to fix something it cannot fix, and would collide with this
 * route's real use of that code below.
 *
 * So: use the HTTP-registered signal for throttling — 429 + Retry-After (RFC
 * 6585 §4), which is what generic HTTP clients and MCP client retry logic key
 * on — while keeping the OAuth JSON envelope every other /api/oauth/* error
 * uses. `temporarily_unavailable` is the only REGISTERED OAuth 2.0 error code
 * (RFC 6749) meaning "temporarily unable to handle the request", i.e. retryable
 * rather than malformed. (`slow_down` was rejected: RFC 8628 scopes it to the
 * device authorization grant.)
 *
 * no-store stops an intermediary caching a transient throttle into a sticky
 * failure for a later legitimate connect. The body is identical whichever rule
 * fired and carries no remaining-count, so it cannot be used to probe how close
 * the global ceiling is.
 */
function throttled(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      error: "temporarily_unavailable",
      error_description: `Too many registration requests. Please retry in ${retryAfterSeconds} seconds.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * RFC 7591 dynamic client registration — MCP clients (Claude Desktop,
 * claude.ai) call this once on first connect, no manual app setup.
 *
 * Unauthenticated by design, so it is rate limited FIRST — before the body is
 * even read. This deliberately differs from the auth server actions, which gate
 * AFTER their Zod parse because the parse yields the `email` dimension the gate
 * needs; here no dimension comes from the body, a flood of malformed bodies is
 * still a flood that must be counted, and a throttled request should never pay
 * for JSON parsing.
 */
export async function POST(req: Request) {
  const gate = await checkRateLimit({ endpoint: "oauthRegister" });
  if (!gate.allowed) return throttled(gate.retryAfterSeconds);

  const body = await req.json().catch(() => null);
  const parsed = registerClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: parsed.error.issues[0]?.message,
      },
      { status: 400 },
    );
  }
  const client = await registerOauthClient(parsed.data);
  return NextResponse.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/app/api/oauth/register/route.test.ts`

Expected: PASS — all 9 tests.

- [ ] **Step 5: Run the full four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

Expected: all four green. Notes on what to expect:

- `pnpm lint` may emit pre-existing `max-lines` warnings elsewhere in the repo — warnings do not fail the gate (`pnpm lint` runs bare `eslint` with no `--max-warnings`).
- `pnpm test` runs the **unit** project only unless a `.env.test` exists; the integration suites skip cleanly. That is expected and correct — this change ships no SQL, so there is nothing new to integration-test.
- If `pnpm typecheck` reports errors under `.next/types`, run `rm -rf .next/types` and retry (a known stale-type trap; `finish-task.sh` already does this).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/oauth/register/route.ts src/app/api/oauth/register/route.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): rate-limit /api/oauth/register

Gates RFC 7591 dynamic client registration as the handler's FIRST statement,
before the body is read, so malformed floods are counted too. A throttled
request answers 429 + Retry-After + Cache-Control: no-store with the OAuth
envelope {error: temporarily_unavailable}: RFC 7591's registration-error
codes are all 400-class and describe bad metadata, which a throttle is not.
The body is identical whichever rule fired and carries no remaining count.

Closes the unbounded anonymous oauth_clients insert.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**No `Changelog:` trailer on purpose.** The `/updates` page is opt-in and user-facing; this is a hardening control on a machine-to-machine endpoint with no observable change for a Pulse user (a legitimate connect behaves exactly as before). Adding a trailer would publish a non-event and force a `pnpm changelog:gen` round-trip. Do not add one.

---

## Closing the task

- [ ] **Run `scripts/finish-task.sh` from inside the worktree.** It rebases `task/oauth-register-ratelimit` onto the latest `develop`, runs all four gates against the merged state, merges, pushes, and removes the worktree + branch. Do not hand-rebase; if it stops on a real conflict, resolve `git rebase develop` and re-run.
- [ ] **Hand the user the "How to test" walkthrough** below (also copy it into the `/wrapup` session note).
- [ ] **Strike the north-star line.** `vault/00-north-star.md` §"Owed" currently reads "`/api/oauth/register` has no rate limit" — remove that clause during `/wrapup`.

---

## How to test this (manual walkthrough)

This is an HTTP-level control on a machine-to-machine endpoint, so acceptance is a `curl` pass plus one real-connector smoke test. Setup: pull `develop`, then `pnpm dev` (dev server on `http://localhost:3000`, pointed at the **DEV** Supabase project via `.env.local`).

1. **Confirm the happy path still works.**

   ```bash
   curl -i -X POST http://localhost:3000/api/oauth/register \
     -H 'content-type: application/json' \
     -d '{"client_name":"Manual Test","redirect_uris":["https://example.com/cb"]}'
   ```

   **Expect:** `HTTP/1.1 201 Created`, and a JSON body with a fresh `client_id`, `"token_endpoint_auth_method":"none"`, and your `redirect_uris`.

2. **Trip the per-IP rule.** Run the same request 11 times:

   ```bash
   for i in $(seq 1 11); do
     curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:3000/api/oauth/register \
       -H 'content-type: application/json' \
       -d '{"client_name":"Flood '"$i"'","redirect_uris":["https://example.com/cb"]}'
   done; echo
   ```

   **Expect:** `201 201 201 201 201 201 201 201 201 201 429` — the first ten succeed, the eleventh is throttled. Step 1's request shares the same bucket, so the `429` may arrive one request earlier.

3. **Inspect the throttled response.** Repeat the `curl -i` from step 1.

   **Expect:** `HTTP/1.1 429 Too Many Requests`, a `Retry-After:` header with a number of seconds (≤ 600), `Cache-Control: no-store`, and the body `{"error":"temporarily_unavailable","error_description":"Too many registration requests. Please retry in N seconds."}`.

4. **Confirm no row is written while throttled.** In the Supabase **DEV** SQL editor, run `select count(*) from public.oauth_clients;`, fire two more throttled `curl`s, then run it again.

   **Expect:** the count is identical — throttled requests write nothing.

5. **Confirm the window releases (and does not extend under load).** Either wait 10 minutes, or reset the bucket in the DEV SQL editor:

   ```sql
   delete from public.auth_rate_limits where bucket_key like 'oauthRegister:%';
   ```

   Then repeat step 1. **Expect:** `201` again.

6. **Confirm existing connectors are unaffected by a throttle.** With the `oauthRegister:ip` bucket still tripped, open Pulse → **Settings → MCP** and run a tool call from an already-connected Claude client.

   **Expect:** it works normally. The limit gates registration only — never an established connection.

7. **Real-client smoke test (once, after promoting to `main`).** Add the Pulse MCP server as a **fresh** custom connector in Claude Desktop or claude.ai and complete the OAuth consent flow.

   **Expect:** the first-time connect succeeds on the first attempt with no throttle — this is the check that the headroom in the limits is doing its job.

8. **Cleanup.** In the DEV SQL editor:

   ```sql
   delete from public.oauth_clients
    where client_name like 'Manual Test%' or client_name like 'Flood %';
   delete from public.auth_rate_limits where bucket_key like 'oauthRegister:%';
   ```

   (`oauth_codes` / `oauth_tokens` cascade from `oauth_clients`.)
