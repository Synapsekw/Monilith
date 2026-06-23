# Auth hardening 9x Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the last per-request auth network round-trip by swapping `src/proxy.ts`'s
`auth.getUser()` for `auth.getClaims()` (local JWT verify), with tests that prove token refresh is
preserved (no silent logout).

**Architecture:** `getClaims()` and `getUser()` both route through `getSession()` →
`__loadSession()`, which is where near-expiry refresh and cookie-set happen — so the swap keeps
refresh intact while dropping the unconditional `GET /user` round-trip `getUser()` adds. The proxy
only needs a boolean "is there an authenticated identity?", so `!!data?.claims` replaces the `user`
object. No new server data is fetched; proxy stays session-refresh-and-redirect only.

**Tech Stack:** Next.js 16 proxy (`src/proxy.ts`), `@supabase/ssr@0.12.0` /
`@supabase/auth-js@2.108.1`, Vitest (`src/proxy.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-23-auth-hardening-9x-design.md`

---

## Scope decision (read before starting)

Per the spec's "Open questions / decisions":

- **Item (1) — BUILD** → **Task 1** below. This is the entire required build.
- **Item (2) — DEFER/CLOSE** → no task. RLS + SECURITY-DEFINER RPCs are the security boundary and
  the sensitive platform/org actions already call network `auth.getUser()`. The spec is the written
  rationale. **Do not** add revalidation code — it already exists.
- **Optional B2 helper** — **not recommended**; **Task 2** is included only if the reviewer
  explicitly greenlights decision #3. Skip it by default.

## File Structure

- **Modify:** `src/proxy.ts` (lines 44-46: the `auth.getUser()` call and its destructure; downstream
  `user` truthiness checks at `:54`, `:63`). One responsibility: gate requests on an authenticated
  identity + refresh session cookies.
- **Modify (tests):** `src/proxy.test.ts` — update the `@supabase/ssr` mock to expose
  `auth.getClaims`, re-assert the four existing behaviors, add the null-claims and
  refresh-preservation tests.
- **(Optional, Task 2 only):** `src/lib/auth/session.ts` + `src/lib/auth/session.test.ts` —
  `requireFreshUser()` helper. Only if decision #3 = include.

No migrations, no type regen, no new files in the default (Task 1 only) path.

---

### Task 1: Swap proxy `getUser()` → `getClaims()` (preserve refresh)

**Files:**

- Modify: `src/proxy.ts` (auth check `:44-46`; consumers `:54`, `:63`)
- Test: `src/proxy.test.ts` (existing suite — update mock + add cases)

- [ ] **Step 1: Update the test mock and existing assertions to drive `getClaims` (write failing tests first)**

Replace the top-of-file mock + the four behavior tests in `src/proxy.test.ts` so they exercise
`auth.getClaims()` instead of `auth.getUser()`. The mock must also expose a cookie adapter we can
assert on for the refresh-preservation test. New full top section:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

// Hold the auth.getClaims() result the mocked Supabase client returns per test,
// and capture the cookie adapter so we can simulate a refresh writing cookies.
const { getClaims, capturedCookieAdapter } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  capturedCookieAdapter: {
    current: null as null | { setAll: (c: unknown[]) => void },
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { getAll: () => unknown[]; setAll: (c: unknown[]) => void };
    },
  ) => {
    capturedCookieAdapter.current = opts.cookies;
    return { auth: { getClaims: () => getClaims() } };
  },
}));
// Env validation runs at import; supply the two public vars the proxy reads.
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

import { NextRequest } from "next/server";
import { proxy, config } from "./proxy";

function req(path: string) {
  return new NextRequest(new URL(path, "http://localhost"));
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedCookieAdapter.current = null;
});

describe("proxy()", () => {
  it("redirects an authenticated visitor on / to /home", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });
    const res = await proxy(req("/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/home");
  });

  it("lets an anonymous visitor through on / (static landing, no redirect)", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await proxy(req("/"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an anonymous visitor on a protected route to /login", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await proxy(req("/boards/b1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("treats a getClaims error as unauthenticated (redirect to /login)", async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: "bad jwt" } });
    const res = await proxy(req("/boards/b1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });

  it("lets an authenticated visitor through on a protected route", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });
    const res = await proxy(req("/boards/b1"));
    expect(res.headers.get("location")).toBeNull();
  });
});
```

Keep the existing `describe("proxy matcher", ...)` block unchanged.

- [ ] **Step 2: Run the updated tests to verify they fail**

Run: `pnpm test -- src/proxy.test.ts`
Expected: FAIL — the current `proxy.ts` calls `auth.getUser()`, which the new mock no longer
provides (`getClaims` is undefined on the real call path / `getUser` is gone), so the behavior
assertions error out.

- [ ] **Step 3: Implement the swap in `src/proxy.ts`**

Replace the auth-check block (current `:43-46`):

```typescript
// Do NOT run any DB/org lookups here — session refresh + redirect only.
const {
  data: { user },
} = await supabase.auth.getUser();
```

with:

```typescript
// Do NOT run any DB/org lookups here — session refresh + redirect only.
//
// getClaims() verifies the JWT LOCALLY against the cached JWKS (asymmetric
// ES256 signing keys are enabled), so it adds NO network call in the common
// case. Crucially it still routes through getSession() → __loadSession(),
// which is where near-expiry token refresh happens and where the refreshed
// cookies get written back via the cookie adapter above — so swapping
// getUser() (which paid an extra unconditional GET /user every request) for
// getClaims() keeps refresh intact while dropping that round-trip.
// NB: never pass a token into getClaims() — the one-arg form skips
// getSession() and would DISABLE refresh (silent logout). Call it with ().
const { data: claimsData } = await supabase.auth.getClaims();
const isAuthenticated = !!claimsData?.claims;
```

Then update the two consumers to use `isAuthenticated` instead of `user`:

- `:54` `if (pathname === "/" && user) {` → `if (pathname === "/" && isAuthenticated) {`
- `:63` `if (!user && !isAuthRoute && !isPublicRoute) {` → `if (!isAuthenticated && !isAuthRoute && !isPublicRoute) {`

Update the file's top-of-function comment (`:16-17`) if it references `getUser`; leave the matcher
comment block (`:70-79`) untouched except the inline mention of "server-resolved `user`" may stay —
it is still accurate (we resolve an authenticated identity).

- [ ] **Step 4: Run the behavior tests to verify they pass**

Run: `pnpm test -- src/proxy.test.ts`
Expected: PASS — all five `proxy()` cases + the unchanged matcher cases green.

- [ ] **Step 5: Add the refresh-preservation test (silent-logout guard)**

Append inside `describe("proxy()", ...)` in `src/proxy.test.ts`:

```typescript
it("calls getClaims with NO jwt arg (preserves getSession refresh path)", async () => {
  getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
  await proxy(req("/boards/b1"));
  // The zero-arg form is the one that routes through getSession() →
  // __loadSession() near-expiry refresh. Passing a token would skip refresh.
  expect(getClaims).toHaveBeenCalledTimes(1);
  expect(getClaims.mock.calls[0]).toHaveLength(0);
});

it("propagates refreshed cookies onto the response (refresh write-back works)", async () => {
  getClaims.mockImplementation(async () => {
    // Simulate @supabase/ssr writing a refreshed session via the adapter.
    capturedCookieAdapter.current?.setAll([
      { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
    ]);
    return { data: { claims: { sub: "u1" } }, error: null };
  });
  const res = await proxy(req("/boards/b1"));
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("sb-access-token=refreshed");
});
```

Note: the mock's `getClaims` is defined as `() => getClaims()` in the `createServerClient` mock,
which forwards zero args — so `getClaims.mock.calls[0]` has length 0, matching the real zero-arg
call the proxy makes. The cookie-propagation test relies on the proxy's existing `setAll`
(`proxy.ts:28-38`) rebuilding `response` and copying cookies — unchanged by this task.

- [ ] **Step 6: Run the full proxy suite + the four gates**

Run: `pnpm test -- src/proxy.test.ts`
Expected: PASS — seven `proxy()` cases + matcher cases.

Then the full gate set in the worktree:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green. (If `pnpm test -- <file>` is not the configured filter form, fall back to
`pnpm test` and confirm `src/proxy.test.ts` passes.)

- [ ] **Step 7: Commit**

```bash
git add src/proxy.ts src/proxy.test.ts
git commit -m "perf(auth): proxy verifies JWT locally via getClaims (drops per-request /user round-trip)"
```

(Commit identity is pinned by the worktree to `Danijel Jovanovic <info@synapse-solutions.ai>` — do
not override.)

---

### Task 2 (OPTIONAL — only if decision #3 = include): `requireFreshUser()` de-dup helper

> Skip this task by default. It has **zero** security effect (same network `getUser()` call already
> made) — it only de-duplicates the actor-fetch preamble. Build only if the reviewer explicitly
> greenlights spec decision #3.

**Files:**

- Modify: `src/lib/auth/session.ts` (add helper)
- Test: `src/lib/auth/session.test.ts` (add cases)
- Modify (call sites): `src/lib/platform/actions.ts` actor-fetch preambles (`:50-55`, `:102-107`,
  `:140-145`, `:186-191`)

- [ ] **Step 1: Write the failing test**

Add to `src/lib/auth/session.test.ts`:

```typescript
import { requireFreshUser } from "./session";

describe("requireFreshUser", () => {
  it("returns the actor when the network session is valid", async () => {
    // mock createClient().auth.getUser() → { data: { user: { id: "u1" } } }
    await expect(requireFreshUser()).resolves.toEqual({ id: "u1" });
  });

  it("returns null when there is no network session", async () => {
    // mock createClient().auth.getUser() → { data: { user: null } }
    await expect(requireFreshUser()).resolves.toBeNull();
  });
});
```

Wire the `@/lib/supabase/server` mock the same way the existing `session.test.ts` mocks it (match
the file's established pattern — read it first; do not invent a new mock shape).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/auth/session.test.ts`
Expected: FAIL — `requireFreshUser` not exported.

- [ ] **Step 3: Implement the helper in `src/lib/auth/session.ts`**

```typescript
/**
 * Network-revalidated actor for the most sensitive server actions: unlike
 * getUser() (which is getClaims-backed / local-verify), this calls
 * auth.getUser() against the Supabase auth server so a just-revoked session is
 * caught immediately. Returns the auth user id (or null). Defense-in-depth on
 * top of the RLS/RPC authz boundary — NOT the boundary itself.
 */
export async function requireFreshUser(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/lib/auth/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace the actor-fetch preambles in `src/lib/platform/actions.ts`**

For each of `setUserBan`, `platformResetUserPassword`, `platformSetUserPassword`,
`platformDeleteUser`, replace:

```typescript
const supabase = await createClient();
const {
  data: { user: actor },
} = await supabase.auth.getUser();
if (!actor) return fail("Not authenticated.");
```

with:

```typescript
const actor = await requireFreshUser();
if (!actor) return fail("Not authenticated.");
```

…and keep any later `const supabase = await createClient();` only where the function still needs a
request-scoped client (e.g. `platformDeleteUser`'s `supabase.rpc("platform_user_sole_owned_orgs")`,
`platform*`'s `resetPasswordForEmail`). Add `import { requireFreshUser } from "@/lib/auth/session";`.
Do **not** touch the `isPlatformAdmin()` checks — they stay.

- [ ] **Step 6: Run the gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green; existing `src/lib/platform/*` tests still pass (behavior unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/session.ts src/lib/auth/session.test.ts src/lib/platform/actions.ts
git commit -m "refactor(auth): extract requireFreshUser() for sensitive-action actor revalidation"
```

---

## Execution DAG

- **Task 1** — no dependencies. The entire required build. (Item 1: BUILD.)
- **Task 2** — OPTIONAL, gated on reviewer decision #3. Independent of Task 1 (different files:
  `session.ts`/`platform/actions.ts` vs `proxy.ts`). If both run, they are **parallelizable**.

**Dependency graph:** `T1` (standalone). `T2` (standalone, optional).
**Parallel batches:** Batch 1 = `{T1}` (and `{T2}` iff greenlit — same batch, no shared files).
**Critical path:** `T1` alone (~one short build session). This is a 1-task plan in the default case;
the DAG is trivial by design (small hardening change), stated explicitly per working-agreement #6.

## Finish

From inside the worktree, once all gates pass:

```bash
scripts/finish-task.sh
```

This rebases `task/auth-hardening-9x` onto latest `develop`, re-runs the gates against the merged
state, merges to `develop`, pushes, and removes the worktree/branch.

## How to test this (manual acceptance)

Mostly **not user-observable** — it's a per-request performance/hardening change with identical
auth semantics. Acceptance is the test suite (`pnpm test`, esp. `src/proxy.test.ts`). One manual
sanity check for the silent-logout risk:

1. Pull `develop`, run the app locally (or use a preview deploy).
2. Sign in. Confirm you land on `/home` and can navigate protected routes (e.g. `/boards/...`).
3. Sign out (or hit a protected route while logged out) → confirm redirect to `/login`.
4. **Refresh check:** stay signed in and idle past the access-token TTL (~1 h; or shorten the TTL in
   a non-prod Supabase project), then navigate to a protected route → you must remain authenticated
   (the proxy refreshed the session). If you get bounced to `/login`, refresh broke — investigate
   before promoting.
