# `/login?next=` Post-Sign-In Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every auth gate carry `?next=` to `/login` and make sign-in/sign-up resume there, so a signed-out user starting the MCP OAuth connect flow lands on the consent screen instead of the dashboard — without opening an open redirect.

**Architecture:** One pure module, `src/lib/auth/next-path.ts`, owns the rules (`safeNextPath`, `loginPath`, `NEXT_PATH_HEADER`). `src/proxy.ts` — the gate that actually fires — redirects to `loginPath(pathname + search)` and stamps the resolved path on the forwarded request as `x-pulse-path`; `src/lib/auth/session.ts` exposes `loginRedirectPath()`, which reads that header, so `requireUser()` keeps its signature and all 48 call sites are untouched. `/login` and `/signup` read `next` from `searchParams`, hand it to `AuthForm`, which adds it to the hand-built `FormData`; `signIn` / `signUp` re-sanitize the client-controlled field and redirect there.

**Tech Stack:** Next.js 16.2.9 (App Router, `proxy.ts`, Server Actions, Cache Components), React 19 (`useActionState`), Supabase (`@supabase/ssr`), Vitest (jsdom), Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-25-login-next-redirect-design.md`

---

## File Structure

| File                                      | Responsibility                                                                              | Task |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ---- |
| `src/lib/auth/next-path.ts`               | **New.** `safeNextPath`, `loginPath`, `NEXT_PATH_HEADER`. Pure — no `next/*` imports.       | 1    |
| `src/lib/auth/next-path.test.ts`          | **New.** The whole open-redirect attack table.                                              | 1    |
| `src/app/auth/callback/route.ts`          | Stops declaring `safeNextPath`; imports it. Provisioning-error redirect keeps `next`.       | 2    |
| `src/app/auth/callback/route.test.ts`     | Rewritten: handler redirect behaviour (sanitizer tests moved to Task 1).                    | 2    |
| `src/proxy.ts`                            | `/login?next=` redirect, `x-pulse-path` request header, cookieless-endpoint allowlist.      | 3, 4 |
| `src/proxy.test.ts`                       | `next` assertions, header propagation, allowlist, no-regression.                            | 3, 4 |
| `src/components/auth/auth-form.tsx`       | New `next?: string` prop → `formData.set("next", next)`.                                    | 5    |
| `src/components/auth/auth-form.test.tsx`  | Asserts `next` reaches the dispatched `FormData`.                                           | 5    |
| `src/app/(auth)/login/page.tsx`           | Reads + sanitizes `searchParams.next`; footer link preserves it.                            | 6    |
| `src/app/(auth)/signup/page.tsx`          | Same, behind a new `<Suspense>` boundary (becomes dynamic).                                 | 6    |
| `src/app/auth/actions.ts`                 | `signIn` redirects to `next`; `signUp` threads it into `emailRedirectTo` + instant session. | 7    |
| `src/app/auth/actions.test.ts`            | `signIn` / `signUp` `next` + hostile-value tests.                                           | 7    |
| `src/lib/auth/session.ts`                 | New `loginRedirectPath()`; `requireUser()` uses it.                                         | 8    |
| `src/lib/auth/session.test.ts`            | Header-present / header-absent / hostile-header cases.                                      | 8    |
| `src/lib/platform/guard.ts`               | `requirePlatformAdmin()` uses `loginRedirectPath()`.                                        | 8    |
| `src/app/home/page.tsx`                   | Uses `loginRedirectPath()`.                                                                 | 8    |
| `src/app/(auth)/change-password/page.tsx` | Uses `loginRedirectPath()`.                                                                 | 8    |

No migrations, no `database.types.ts` regeneration, no new dependencies.

---

## Execution DAG (working agreement #6)

**Dependency edges (Consumes / Produces):**

- **Task 1 — `next-path.ts` + attack-table tests.** Consumes: nothing. Produces: `safeNextPath`, `loginPath`, `NEXT_PATH_HEADER`.
- **Task 2 — callback route re-points at the shared module.** Consumes: Task 1 (`safeNextPath`). Produces: a route with no local sanitizer; `next`-preserving provisioning-error redirect.
- **Task 3 — proxy carries `next` + stamps `x-pulse-path`.** Consumes: Task 1 (`loginPath`, `NEXT_PATH_HEADER`). Produces: `/login?next=…` redirects; the request header every server-side gate reads.
- **Task 4 — proxy allowlist for cookieless OAuth/MCP endpoints.** Consumes: Task 3 (same file, same `if`). Produces: reachable `/.well-known/oauth-*`, `/api/oauth/*`, `/api/mcp`. _Separable: droppable without touching Tasks 1–3, 5–8, at the cost of making the §9-C acceptance path unverifiable._
- **Task 5 — `AuthForm` carries `next` in the FormData.** Consumes: nothing from other tasks (prop only). Produces: `next` prop → `FormData` entry.
- **Task 6 — `/login` + `/signup` read and forward `next`.** Consumes: Task 1 (`safeNextPath`), Task 5 (the `next` prop). Produces: `next` flowing from URL into the form.
- **Task 7 — `signIn` / `signUp` consume `next`.** Consumes: Task 1 (`safeNextPath`). Produces: the actual post-sign-in redirect. _Independent of Tasks 5–6 (different file, and the FormData key is a string contract fixed in Task 1's docs)._
- **Task 8 — server-side gates derive `next` from the header.** Consumes: Task 1 (`loginPath`), Task 3 (the header must exist at runtime). Produces: `requireUser` / `requirePlatformAdmin` / `/home` / `/change-password` redirects with `next`.
- **Task 9 — full-gate verification + wrapup.** Consumes: all.

**Dependency graph:**

```
Task 1 ──┬─> Task 2
         ├─> Task 3 ──> Task 4
         │        └────> Task 8
         ├─> Task 6 (also needs Task 5)
         └─> Task 7
Task 5 ──────> Task 6
All ─────────> Task 9
```

**Parallel batches (waves of concurrent agents):**

- **Batch A:** Task 1 alone (everything depends on it).
- **Batch B (parallel, disjoint files):** Task 2 (`auth/callback/*`), Task 3 (`proxy.*`), Task 5 (`components/auth/auth-form.*`), Task 7 (`app/auth/actions.*`).
- **Batch C (parallel, disjoint files):** Task 4 (`proxy.*`), Task 6 (`(auth)/login|signup/page.tsx`), Task 8 (`lib/auth/session.*`, `lib/platform/guard.ts`, `app/home/page.tsx`, `(auth)/change-password/page.tsx`).
- **Batch D:** Task 9.

**Critical path (wall-clock floor):** Task 1 → Task 3 → Task 8 → Task 9 (4 deep). Task 5 → Task 6 is a shorter chain that folds into Batches B/C.

**Worktree note:** all work happens in the existing worktree `.claude/worktrees/login-next-param` on `task/login-next-param`. Batch B and Batch C tasks touch disjoint files, so parallel subagents in this one worktree cannot clobber each other — **except Task 3 and Task 4, which both edit `src/proxy.ts` and must therefore stay in different batches (they already are).** Every task is small; running Tasks 1→9 sequentially in one session is also perfectly reasonable and is the recommended default here — the DAG matters mainly as the guarantee that no task is silently blocked.

---

## Task 1: `next-path.ts` — the sanitizer and the login-URL builder

**Files:**

- Create: `src/lib/auth/next-path.ts`
- Create: `src/lib/auth/next-path.test.ts`

Background you need: `safeNextPath` currently lives in `src/app/auth/callback/route.ts` and has a **live
open-redirect bypass** — it accepts `"/" + "\n" + "/evil.com"`, and both browsers and `new URL()` strip
LF/CR/TAB before parsing, so the value becomes `//evil.com` (protocol-relative → off-site). Separately,
canonicalizing `/..//evil.com` through `new URL` _produces_ `//evil.com`, so the canonical output has to
be re-checked. Both are verified facts, not theory. Do not simplify these rules away.

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth/next-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loginPath, NEXT_PATH_HEADER, safeNextPath } from "./next-path";

// Control characters are built from codepoints so the intent is visible and no
// literal control byte ends up in this source file.
const LF = "\n";
const CR = "\r";
const TAB = "\t";

describe("safeNextPath — accepts legitimate same-origin targets", () => {
  it("passes rooted paths through unchanged", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/boards/123")).toBe("/boards/123");
    expect(safeNextPath("/boards/123?tab=x#c")).toBe("/boards/123?tab=x#c");
    expect(safeNextPath("/api/oauth/authorize?client_id=abc&state=xyz")).toBe(
      "/api/oauth/authorize?client_id=abc&state=xyz",
    );
    expect(safeNextPath("/change-password?recovery=1")).toBe(
      "/change-password?recovery=1",
    );
  });

  it("does NOT over-block percent-encoded slashes (they stay same-origin)", () => {
    // Verified with `new URL`: "/%2f%2fevil.com" resolves inside our origin.
    expect(safeNextPath("/%2f%2fevil.com")).toBe("/%2f%2fevil.com");
  });

  it("does NOT over-block a space in the path", () => {
    expect(safeNextPath("/a b/c")).toBe("/a%20b/c");
  });
});

describe("safeNextPath — refuses off-origin targets (open redirect)", () => {
  it("refuses absolute URLs", () => {
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("http://evil.com/x")).toBe("/");
    expect(safeNextPath("HTTPS://evil.com")).toBe("/");
  });

  it("refuses protocol-relative targets", () => {
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("//evil.com/path")).toBe("/");
  });

  it("refuses backslash-tricked targets (browsers normalize \\ to /)", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath("/\\\\evil.com")).toBe("/");
  });

  it("refuses control characters — stripping them yields '//evil.com'", () => {
    // THE live bypass on develop: GET /auth/callback?next=%2F%0A%2Fevil.com
    // 307s to https://evil.com/ today.
    expect(safeNextPath("/" + LF + "/evil.com")).toBe("/");
    expect(safeNextPath("/" + CR + "/evil.com")).toBe("/");
    expect(safeNextPath("/" + TAB + "/evil.com")).toBe("/");
    expect(safeNextPath("/" + LF + LF + "//evil.com")).toBe("/");
    expect(safeNextPath("/boards" + LF + "X-Injected: 1")).toBe("/");
  });

  it("refuses non-rooted and scheme-bearing values", () => {
    expect(safeNextPath("evil.com")).toBe("/");
    expect(safeNextPath("../evil.com")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("refuses a canonical form that BECOMES protocol-relative", () => {
    // new URL("/..//evil.com", origin).pathname === "//evil.com" (verified),
    // so the guard has to run on the canonicalized output too.
    expect(safeNextPath("/..//evil.com")).toBe("/");
    expect(safeNextPath("/a/..//evil.com")).toBe("/");
  });
});

describe("safeNextPath — refuses loops, arrays, junk and oversized values", () => {
  it("refuses auth-flow targets (redirect loop / sign-in-twice phishing)", () => {
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/login?next=%2Flogin")).toBe("/");
    expect(safeNextPath("/signup")).toBe("/");
    expect(safeNextPath("/auth/callback")).toBe("/");
    expect(safeNextPath("/forgot-password")).toBe("/");
  });

  it("refuses repeated params (searchParams yields string[])", () => {
    expect(safeNextPath(["/a", "/b"])).toBe("/");
  });

  it("refuses oversized values", () => {
    expect(safeNextPath("/" + "a".repeat(4000))).toBe("/");
  });

  it("defaults to / for missing values", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});

describe("loginPath", () => {
  it("returns a bare /login when there is nothing worth resuming", () => {
    expect(loginPath(null)).toBe("/login");
    expect(loginPath("/")).toBe("/login");
    expect(loginPath("//evil.com")).toBe("/login");
  });

  it("encodes the sanitized target as ?next=", () => {
    expect(loginPath("/boards/b1")).toBe("/login?next=%2Fboards%2Fb1");
    expect(loginPath("/api/oauth/authorize?client_id=a&state=b")).toBe(
      "/login?next=%2Fapi%2Foauth%2Fauthorize%3Fclient_id%3Da%26state%3Db",
    );
  });
});

describe("NEXT_PATH_HEADER", () => {
  it("uses the repo's x-pulse-* custom-header convention", () => {
    expect(NEXT_PATH_HEADER).toBe("x-pulse-path");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/auth/next-path.test.ts`
Expected: FAIL — `Failed to resolve import "./next-path"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/auth/next-path.ts`:

```ts
/**
 * The `?next=` post-sign-in redirect rules, shared by every gate that bounces an
 * unauthenticated visitor to /login and by every consumer that sends them back
 * afterwards.
 *
 * This module is deliberately PURE — no `next/*` imports. `src/proxy.ts` imports
 * it, and a proxy bundle must not pull in `next/headers` or a route module. The
 * request-bound read (`loginRedirectPath`) lives in `src/lib/auth/session.ts`.
 */

/**
 * Request header `src/proxy.ts` stamps on the forwarded request so server-side
 * gates (`requireUser`, `requirePlatformAdmin`, …) can rebuild the `?next=`
 * target without a parameter at each of their ~48 call sites. RSC has no
 * `usePathname` equivalent; passing information from proxy to app via a request
 * header is the documented mechanism
 * (next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 */
export const NEXT_PATH_HEADER = "x-pulse-path";

/**
 * Origin used only to resolve a candidate against a *known* base so we can ask
 * "did this stay same-origin?". `.invalid` is reserved by RFC 2606, so it can
 * never be a real host we might confuse with a real target.
 */
const PROBE_ORIGIN = "https://pulse.invalid";

/** Refuse `next` targets inside the auth flow itself: sending a signed-in user
 * back to /login is a redirect loop, and "sign in, then land on a sign-in page"
 * is a credential-phishing shape we should never generate. */
const AUTH_FLOW_PATHS = [
  "/login",
  "/signup",
  "/auth",
  "/forgot-password",
] as const;

/** Cap on the accepted value so a hostile `next` cannot push the `Location`
 * header toward a 431 Request Header Fields Too Large. */
const MAX_LENGTH = 2048;

/**
 * Reduce an untrusted `next` value to a guaranteed same-origin, rooted path, or
 * `"/"`.
 *
 * TOTAL by design — it never throws and always returns a usable path, so a
 * malformed `next` degrades to the dashboard instead of turning a valid sign-in
 * into an error page. Call it at EVERY boundary that reads a `next`, including
 * the `FormData` field (which the browser can forge independently of the URL).
 *
 * Accepts `string[]` because Next.js `searchParams` yields an array for a
 * repeated param (`?next=a&next=b`).
 */
export function safeNextPath(
  next: string | string[] | null | undefined,
): string {
  if (typeof next !== "string" || next === "") return "/";
  if (next.length > MAX_LENGTH) return "/";

  // Browsers AND the WHATWG URL parser STRIP tab/LF/CR before parsing, so
  // "/\n/evil.com" silently becomes "//evil.com" — protocol-relative, i.e.
  // off-site. (Verified: new URL("/\n/evil.com", origin) === "https://evil.com/".)
  // A raw LF in a value that reaches a Location header is also header injection.
  // Reject the whole ASCII control range rather than trying to strip it.
  if (/[\u0000-\u001F\u007F]/.test(next)) return "/";

  // Must be rooted at a SINGLE "/": reject "//host" (protocol-relative),
  // "/\host" (browsers normalize backslashes), and anything not rooted at all
  // ("https://evil.com", "evil.com", "javascript:…").
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.startsWith("/\\")) return "/";

  // Belt-and-braces: resolve against a known origin and require it to stay
  // there. This makes the guarantee structural instead of a list of known
  // tricks, so the next unknown parser quirk fails closed.
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== PROBE_ORIGIN) return "/";

  if (
    AUTH_FLOW_PATHS.some(
      (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
    )
  ) {
    return "/";
  }

  const target = `${url.pathname}${url.search}${url.hash}`;
  // Canonicalization can MANUFACTURE a protocol-relative value the checks above
  // never saw: new URL("/..//evil.com", origin).pathname === "//evil.com".
  // Re-check the output, not just the input.
  if (target.startsWith("//")) return "/";
  return target;
}

/**
 * The `/login` URL to redirect an unauthenticated visitor to, carrying a
 * sanitized `?next=` when there is a destination worth resuming. `"/"` is the
 * post-sign-in default, so it is expressed as a bare `/login` (no noise param).
 */
export function loginPath(next: string | string[] | null | undefined): string {
  const safe = safeNextPath(next);
  return safe === "/" ? "/login" : `/login?next=${encodeURIComponent(safe)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/auth/next-path.test.ts`
Expected: PASS — 16 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/next-path.ts src/lib/auth/next-path.test.ts
git commit -m "feat(auth): hardened safeNextPath + loginPath in a shared module

Adds src/lib/auth/next-path.ts: the single owner of the ?next= rules, pure
so src/proxy.ts can import it. Hardens the sanitizer moved from the callback
route with (a) ASCII control-character rejection, which closes a live open
redirect (?next=/%0A/evil.com resolved off-site because browsers and new URL
strip LF), (b) a same-origin resolve check, (c) a re-check of the canonical
output, since new URL('/..//evil.com') yields '//evil.com', (d) auth-flow
loop refusal, array and length limits."
```

---

## Task 2: point the callback route at the shared sanitizer

**Files:**

- Modify: `src/app/auth/callback/route.ts` (delete the local `safeNextPath`, lines 6–22; import it; preserve `next` on the provisioning-error redirect)
- Rewrite: `src/app/auth/callback/route.test.ts` (the sanitizer tests moved to Task 1; this now covers the handler)

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `src/app/auth/callback/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  exchangeCodeForSession,
  redeemInvitationsForUser,
  provisionAccountForUser,
} = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  redeemInvitationsForUser: vi.fn(),
  provisionAccountForUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));
vi.mock("@/lib/auth/provision", () => ({
  provisionAccountForUser: (...a: unknown[]) => provisionAccountForUser(...a),
}));
vi.mock("@/lib/auth/redeem", () => ({
  redeemInvitationsForUser: (...a: unknown[]) => redeemInvitationsForUser(...a),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const LF = "\n";

function call(url: string) {
  return GET(new NextRequest(new URL(url, "http://localhost")));
}

beforeEach(() => {
  exchangeCodeForSession.mockReset().mockResolvedValue({
    data: { user: { id: "u1" } },
    error: null,
  });
  redeemInvitationsForUser.mockReset().mockResolvedValue(1);
  provisionAccountForUser.mockReset().mockResolvedValue({ error: null });
});

describe("GET /auth/callback — next handling", () => {
  it("redirects to a safe next", async () => {
    const res = await call("/auth/callback?next=%2Fboards%2Fb1");
    expect(res.headers.get("location")).toBe("http://localhost/boards/b1");
  });

  it("falls back to / with no next", async () => {
    const res = await call("/auth/callback");
    expect(res.headers.get("location")).toBe("http://localhost/");
  });

  it("refuses the control-character open redirect", async () => {
    // Encoded form of "/" + LF + "/evil.com" — resolves off-site unsanitized.
    const res = await call("/auth/callback?next=%2F%0A%2Fevil.com");
    expect(res.headers.get("location")).toBe("http://localhost/");
    expect(encodeURIComponent("/" + LF + "/evil.com")).toBe(
      "%2F%0A%2Fevil.com",
    );
  });

  it("refuses an absolute next", async () => {
    const res = await call("/auth/callback?next=https%3A%2F%2Fevil.com");
    expect(res.headers.get("location")).toBe("http://localhost/");
  });

  it("keeps next on the provisioning-failure bounce so the user can resume", async () => {
    redeemInvitationsForUser.mockResolvedValue(0);
    provisionAccountForUser.mockResolvedValue({ error: new Error("boom") });

    const res = await call("/auth/callback?code=abc&next=%2Fboards%2Fb1");

    expect(res.headers.get("location")).toBe(
      "http://localhost/login?error=provisioning&next=%2Fboards%2Fb1",
    );
  });

  it("drops an unsafe next from the provisioning-failure bounce", async () => {
    redeemInvitationsForUser.mockResolvedValue(0);
    provisionAccountForUser.mockResolvedValue({ error: new Error("boom") });

    const res = await call("/auth/callback?code=abc&next=%2F%2Fevil.com");

    expect(res.headers.get("location")).toBe(
      "http://localhost/login?error=provisioning",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/app/auth/callback/route.test.ts`
Expected: FAIL — the two provisioning cases fail with `location` = `http://localhost/login?error=provisioning` (no `next`) / a thrown assertion, because the route does not yet forward `next`.

- [ ] **Step 3: Write the implementation**

In `src/app/auth/callback/route.ts`, delete the local `safeNextPath` (the doc comment and function, lines 6–22) and replace the header + provisioning branch so the file reads:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { provisionAccountForUser } from "@/lib/auth/provision";
import { redeemInvitationsForUser } from "@/lib/auth/redeem";
import { safeNextPath } from "@/lib/auth/next-path";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // Redeem invitations FIRST; only self-provision a new org if none were redeemed.
      const redeemed = await redeemInvitationsForUser(supabase);
      if (redeemed === 0) {
        const { error: provisionError } = await provisionAccountForUser(
          supabase,
          data.user,
        );
        // A failed provision leaves the user with zero orgs. Don't drop them
        // into a broken empty app shell — send them to a login page that
        // renders an actionable error instead of silently redirecting to `next`.
        // Carry `next` through so re-signing in still resumes the original
        // destination (e.g. an in-flight OAuth authorize request).
        if (provisionError) {
          const bounce = new URL("/login", origin);
          bounce.searchParams.set("error", "provisioning");
          if (next !== "/") bounce.searchParams.set("next", next);
          return NextResponse.redirect(bounce);
        }
      }
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/app/auth/callback/route.test.ts`
Expected: PASS — 6 tests.

Note: `URLSearchParams` encodes `/` as `%2F`, so the expected `location` is
`…/login?error=provisioning&next=%2Fboards%2Fb1` exactly as asserted.

- [ ] **Step 5: Commit**

```bash
git add src/app/auth/callback/route.ts src/app/auth/callback/route.test.ts
git commit -m "refactor(auth): callback route uses the shared safeNextPath

Drops the route-local sanitizer in favour of src/lib/auth/next-path.ts (whose
tests now own the attack table) and keeps ?next= on the provisioning-failure
bounce so a re-sign-in still resumes the original destination. route.test.ts
now covers the handler's redirect behaviour instead of the pure function."
```

---

## Task 3: proxy carries `next` and stamps `x-pulse-path`

**Files:**

- Modify: `src/proxy.ts` (the `NextResponse.next({ request })` construction sites, and the `/login` redirect at line 79)
- Modify: `src/proxy.test.ts` (add cases; existing cases must keep passing)

**Why this task is the one that fixes the reported bug:** `src/proxy.ts` runs before any RSC or route
handler, and its matcher covers `/api/oauth/authorize`, so its bare `/login` redirect is what a
signed-out MCP user actually hits — the authorize route's own correct `?next=` redirect never runs.

**The trap you must not fall into:** do **not** clone `request.headers` once at the top of `proxy()`.
The Supabase cookie adapter writes refreshed session cookies with `request.cookies.set(...)`, which
writes through to the request's `Cookie` header. A clone taken _before_ that would forward a stale
`Cookie` upstream — a silent logout. Clone inside each `NextResponse.next(...)` construction instead.

- [ ] **Step 1: Write the failing test**

In `src/proxy.test.ts`, replace the existing `"redirects an anonymous visitor on a protected route to /login"` and `"treats a getClaims error as unauthenticated (redirect to /login)"` cases with the versions below, and append the new `describe` block. Keep every other existing test untouched.

```ts
it("redirects an anonymous visitor on a protected route to /login?next=", async () => {
  getClaims.mockResolvedValue({ data: null, error: null });

  const res = await proxy(req("/boards/b1"));

  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe(
    "http://localhost/login?next=%2Fboards%2Fb1",
  );
});

it("preserves the query string in next", async () => {
  getClaims.mockResolvedValue({ data: null, error: null });

  const res = await proxy(req("/oauth/consent?client_id=a&state=b"));

  expect(res.headers.get("location")).toBe(
    "http://localhost/login?next=%2Foauth%2Fconsent%3Fclient_id%3Da%26state%3Db",
  );
});

it("treats a getClaims error as unauthenticated (redirect to /login?next=)", async () => {
  getClaims.mockResolvedValue({ data: null, error: { message: "bad jwt" } });

  const res = await proxy(req("/boards/b1"));

  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe(
    "http://localhost/login?next=%2Fboards%2Fb1",
  );
});
```

```ts
describe("proxy() — x-pulse-path request header", () => {
  it("stamps the resolved path on the FORWARDED REQUEST for an authenticated visitor", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });

    const res = await proxy(req("/boards/b1?tab=x"));

    // NextResponse.next({ request: { headers } }) encodes upstream request
    // headers as x-middleware-request-* (verified against next@16.2.9).
    expect(res.headers.get("x-middleware-request-x-pulse-path")).toBe(
      "/boards/b1?tab=x",
    );
    // It must NOT be a client-visible response header.
    expect(res.headers.get("x-pulse-path")).toBeNull();
  });

  it("forwards the REFRESHED cookie upstream, not a stale snapshot", async () => {
    // Same idiom as the existing "propagates refreshed cookies" test: the
    // adapter writes during getClaims. This is the regression guard for cloning
    // request.headers too early — a snapshot taken before setAll() would forward
    // the OLD Cookie header to the app and silently log the user out.
    getClaims.mockImplementation(async () => {
      capturedCookieAdapter.current?.setAll([
        { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
      ]);
      return { data: { claims: { sub: "u1" } }, error: null };
    });

    const res = await proxy(req("/boards/b1"));

    expect(res.headers.get("set-cookie") ?? "").toContain(
      "sb-access-token=refreshed",
    );
    expect(res.headers.get("x-middleware-request-cookie") ?? "").toContain(
      "sb-access-token=refreshed",
    );
    expect(res.headers.get("x-middleware-request-x-pulse-path")).toBe(
      "/boards/b1",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/proxy.test.ts`
Expected: FAIL — `expected "http://localhost/login" to be "http://localhost/login?next=%2Fboards%2Fb1"`, and `x-middleware-request-x-pulse-path` is `null`.

- [ ] **Step 3: Write the implementation**

In `src/proxy.ts`, add the import:

```ts
import { loginPath, NEXT_PATH_HEADER } from "@/lib/auth/next-path";
```

Replace `let response = NextResponse.next({ request });` (line 23) with:

```ts
// Stamp the resolved path on the FORWARDED REQUEST (never on the
// client-visible response) so server-side gates — requireUser(),
// requirePlatformAdmin(), /home, /change-password — can rebuild the `?next=`
// target without a parameter at each of their ~48 call sites. RSC has no
// usePathname() equivalent; a proxy-set request header is the documented way
// to pass information from proxy to app.
//
// Built fresh at EVERY construction site rather than cloned once up front: the
// Supabase cookie adapter below calls request.cookies.set(...) on a session
// refresh, which writes through to this request's `Cookie` header. A snapshot
// taken before that would forward a STALE cookie upstream — a silent logout.
const forwardedResponse = () => {
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(
    NEXT_PATH_HEADER,
    request.nextUrl.pathname + request.nextUrl.search,
  );
  return NextResponse.next({ request: { headers: forwardedHeaders } });
};

let response = forwardedResponse();
```

Inside the cookie adapter's `setAll`, replace `response = NextResponse.next({ request });` (line 40) with:

```ts
response = forwardedResponse();
```

Replace the unauthenticated redirect (lines 78–80) with:

```ts
if (!isAuthenticated && !isAuthRoute && !isPublicRoute) {
  // Carry where they were going so /login can send them back after sign-in.
  return NextResponse.redirect(
    new URL(
      loginPath(request.nextUrl.pathname + request.nextUrl.search),
      request.url,
    ),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/proxy.test.ts`
Expected: PASS — all pre-existing cases plus the 4 new/updated ones.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts src/proxy.test.ts
git commit -m "feat(auth): proxy sends unauthenticated visitors to /login?next=

The proxy runs before any RSC or route handler, so its bare /login redirect —
not requireUser() — is what a signed-out visitor actually hits; carrying
pathname+search through loginPath() is what makes post-sign-in resume work at
all. Also stamps x-pulse-path on the forwarded request so the server-side
gates can derive the same target without touching 48 call sites. Headers are
cloned per NextResponse.next() construction, never once up front, so a session
refresh's rewritten Cookie header is not lost."
```

---

## Task 4: stop login-walling the cookieless OAuth / MCP endpoints

**Files:**

- Modify: `src/proxy.ts` (add a prefix allowlist to the unauthenticated redirect condition)
- Modify: `src/proxy.test.ts`

**Context (a pre-existing P0 discovered while scoping this task).** The proxy matcher covers
`/api/mcp`, `/api/oauth/*` and `/.well-known/oauth-*`. None of those are cookie-authenticated —
they use Bearer tokens, PKCE, or are public metadata by specification — so the proxy sees
`!isAuthenticated` and 307s them to `/login`. Consequences: an MCP client asking for
`/.well-known/oauth-protected-resource` gets an HTML login redirect instead of metadata, `/api/mcp`
never emits its `401 WWW-Authenticate` challenge, and `/api/oauth/token` cannot complete the code
exchange. The MCP OAuth flow is unreachable end-to-end without this. Allowlisting `/api/oauth/`
additionally lets `/api/oauth/authorize` reach its own handler, which validates
`client_id`/`redirect_uri` **before** bouncing to login (a bogus client should get a `400`, not a
login page) and already builds the correct `?next=`.

- [ ] **Step 1: Write the failing test**

Append to `src/proxy.test.ts`:

```ts
describe("proxy() — cookieless OAuth/MCP endpoints are not login-walled", () => {
  beforeEach(() => {
    getClaims.mockResolvedValue({ data: null, error: null });
  });

  it.each([
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/api/oauth/register",
    "/api/oauth/token",
    "/api/oauth/authorize?client_id=a&response_type=code",
    "/api/mcp",
  ])("lets an anonymous request through on %s", async (path) => {
    const res = await proxy(req(path));

    // No redirect: the endpoint authenticates itself (Bearer / PKCE / public
    // metadata) and must be free to answer 200 / 400 / 401 WWW-Authenticate.
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/boards/b1", "/settings", "/oauth/consent", "/admin"])(
    "still gates %s behind /login",
    async (path) => {
      const res = await proxy(req(path));

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login?next=");
    },
  );
});
```

Also append to the existing `describe("proxy matcher")` block, documenting _why_ the allowlist above is
needed rather than a matcher change (the matcher must keep running on `/api/*` so authenticated app
API routes still get session refresh):

```ts
it("still MATCHES the OAuth/MCP endpoints — they are allowlisted in proxy(), not excluded here", () => {
  expect(matcher.test("/api/mcp")).toBe(true);
  expect(matcher.test("/api/oauth/token")).toBe(true);
  expect(matcher.test("/.well-known/oauth-protected-resource")).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/proxy.test.ts`
Expected: FAIL — the six allowlist cases report `location` = `http://localhost/login?next=…` instead of `null`.

- [ ] **Step 3: Write the implementation**

In `src/proxy.ts`, add below the `PUBLIC_ROUTES` constant:

```ts
// Prefix-matched routes that are NEVER authenticated by a session cookie, so a
// cookie-based gate can only break them. `/.well-known/oauth-*` is public
// metadata by RFC 8414 / RFC 9728; `/api/oauth/*` is the OAuth 2.1 authorization
// server, authenticated by PKCE + client_id (and `authorize` must reach its own
// handler so it can validate client_id/redirect_uri before bouncing to login);
// `/api/mcp` is Bearer-authenticated and must be free to answer 401 with the
// WWW-Authenticate challenge that starts MCP discovery. Without these, an MCP
// client gets an HTML login redirect where it expects JSON, and the connect flow
// cannot complete. Each endpoint authenticates itself — nothing new is exposed.
const PUBLIC_PREFIXES = ["/.well-known/oauth-", "/api/oauth/", "/api/mcp"];
```

Then extend the gate condition:

```ts
const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
const isPublicPrefix = PUBLIC_PREFIXES.some((prefix) =>
  pathname.startsWith(prefix),
);

if (!isAuthenticated && !isAuthRoute && !isPublicRoute && !isPublicPrefix) {
  // Carry where they were going so /login can send them back after sign-in.
  return NextResponse.redirect(
    new URL(
      loginPath(request.nextUrl.pathname + request.nextUrl.search),
      request.url,
    ),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/proxy.test.ts`
Expected: PASS — all cases, including the 4 still-gated paths.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts src/proxy.test.ts
git commit -m "fix(proxy): stop login-walling the cookieless OAuth/MCP endpoints

/api/mcp, /api/oauth/* and /.well-known/oauth-* are authenticated by Bearer
token, PKCE, or are public metadata by RFC — never by a session cookie — so the
proxy's cookie gate 307'd them to /login, which made MCP discovery return HTML
and prevented the token exchange entirely. Prefix-allowlist them; every gated
app route stays gated (asserted)."
```

---

## Task 5: `AuthForm` carries `next` into the submitted FormData

**Files:**

- Modify: `src/components/auth/auth-form.tsx` (props type ~line 27, the `onSubmit` FormData builder ~lines 90–102)
- Modify: `src/components/auth/auth-form.test.tsx`

**Critical detail:** this form does **not** submit the DOM. `onSubmit` runs react-hook-form validation
and then builds `FormData` field by field before calling the `useActionState` dispatcher, so a hidden
`<input name="next">` would be **silently ignored**. `next` must be `set()` in that builder.

- [ ] **Step 1: Write the failing test**

**Replace** the first three lines of `src/components/auth/auth-form.test.tsx` (its existing
`vitest` / `@testing-library/react` / `./auth-form` imports) with the block below — the action module
must be mocked _before_ the component import so the dispatcher calls the spy — then append the new
`describe` at the end of the file. `@testing-library/user-event` is already a devDependency and is
used by 57 other suites in this repo.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Bare vi.fn() + mockResolvedValue in beforeEach — the same idiom as
// src/app/auth/actions.test.ts. The resolved value BECOMES the useActionState
// state, so it must be an object: returning undefined would make the component
// read `state.error` off undefined and crash the render.
const { signIn, signUp } = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/app/auth/actions", () => ({
  signIn: (prev: unknown, fd: FormData) => signIn(prev, fd),
  signUp: (prev: unknown, fd: FormData) => signUp(prev, fd),
}));

import { AuthForm } from "./auth-form";
```

```tsx
describe("AuthForm — next carrying", () => {
  beforeEach(() => {
    signIn.mockReset().mockResolvedValue({});
    signUp.mockReset().mockResolvedValue({});
  });

  async function submitLogin(props: { next?: string }) {
    render(<AuthForm mode="login" {...props} />);
    await userEvent.type(screen.getByLabelText(/email/i), "u@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenough1");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(signIn).toHaveBeenCalled());
    const fd: FormData = signIn.mock.calls[0][1];
    return fd;
  }

  it("includes next in the dispatched FormData when provided", async () => {
    const fd = await submitLogin({ next: "/boards/b1" });

    expect(fd.get("next")).toBe("/boards/b1");
    expect(fd.get("email")).toBe("u@example.com");
  });

  it("omits next entirely when not provided (not an empty string)", async () => {
    const fd = await submitLogin({});

    expect(fd.get("next")).toBeNull();
  });

  it("carries next in signup mode too", async () => {
    render(<AuthForm mode="signup" next="/boards/b1" />);
    await userEvent.type(screen.getByLabelText(/organization name/i), "Acme");
    await userEvent.type(screen.getByLabelText(/email/i), "new@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenough1");
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );
    await waitFor(() => expect(signUp).toHaveBeenCalled());

    const fd: FormData = signUp.mock.calls[0][1];
    expect(fd.get("next")).toBe("/boards/b1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/auth/auth-form.test.tsx`
Expected: FAIL — TypeScript/`next` prop does not exist and `fd.get("next")` is `null` for the first case.

- [ ] **Step 3: Write the implementation**

In `src/components/auth/auth-form.tsx`, extend the props type:

```ts
type AuthFormProps = {
  mode: "login" | "signup";
  footer?: ReactNode;
  /** Seed an error banner on first render (e.g. from a `?error=` redirect). */
  initialError?: string;
  /**
   * Already-sanitized post-sign-in destination (from the page's `?next=`). It
   * rides along as a FormData field because this form is submitted through
   * `useActionState`, which has no access to the page URL. The server action
   * sanitizes it AGAIN — a client can forge this field freely.
   */
  next?: string;
};
```

Update the signature:

```ts
export function AuthForm({ mode, footer, initialError, next }: AuthFormProps) {
```

And in the `onSubmit` FormData builder, after the `orgName` line:

```ts
if (isSignup && "orgName" in values && values.orgName) {
  formData.set("orgName", values.orgName);
}
// NOTE: this form does not submit the DOM, so a hidden <input> would
// never be read — the field has to be set here.
if (next) formData.set("next", next);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/auth/auth-form.test.tsx`
Expected: PASS — the pre-existing render tests plus the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/auth-form.tsx src/components/auth/auth-form.test.tsx
git commit -m "feat(auth): AuthForm carries next into the submitted FormData

The form builds FormData by hand for the useActionState dispatcher, so a hidden
input would be silently dropped; set the field in the builder instead."
```

---

## Task 6: `/login` and `/signup` read, sanitize and forward `next`

**Files:**

- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/(auth)/signup/page.tsx`

Both pages sanitize at the page boundary (hygiene — the security-critical check is in the action,
Task 7) and preserve `next` on the cross-link so switching between sign-in and sign-up doesn't drop
the destination. `/signup` gains a `<Suspense>` boundary because reading `searchParams` makes it
dynamic — under Cache Components, dynamic data must be awaited _inside_ a boundary, exactly as
`/login` already does.

- [ ] **Step 1: Write the implementation for `/login`**

There is no unit test for these page components (the repo tests pages through their child components
and actions); the behaviour is covered by Task 1's `safeNextPath` tests, Task 5's FormData test, Task
7's action tests, and the manual walkthrough. Replace `src/app/(auth)/login/page.tsx` with:

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { safeNextPath } from "@/lib/auth/next-path";

// Redirect-carried error codes → human copy. `provisioning` comes from
// /auth/callback when the first-sign-in org provisioning RPC fails.
const ERROR_COPY: Record<string, string> = {
  provisioning:
    "We couldn't finish setting up your account. Please sign in again to retry.",
};

// The sign-up link must carry `next` too, or switching forms silently drops the
// destination the user was originally headed to.
function Footer({ next }: { next?: string }) {
  return (
    <p className="text-muted-foreground text-center text-sm">
      Don&apos;t have an account?{" "}
      <Link
        href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
        className="text-foreground font-medium underline-offset-4 hover:underline"
      >
        Sign up
      </Link>
    </p>
  );
}

// Reading `searchParams` makes this segment dynamic. Under Next.js 16 Cache
// Components, dynamic data must be awaited *inside* a <Suspense> boundary
// (awaiting it at the page level blocks the whole route from prerendering —
// the "Uncached data accessed outside of <Suspense>" build error). So the
// page stays static and the error-aware form streams in behind Suspense.
export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<AuthForm mode="login" footer={<Footer />} />}>
      <LoginForm searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginForm({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string | string[] }>;
}) {
  const { error, next } = await searchParams;
  const initialError = error ? ERROR_COPY[error] : undefined;
  // "/" is the default destination, so treat it as "no next" and keep the
  // markup free of a redundant param.
  const safeNext = safeNextPath(next);
  const nextTarget = safeNext === "/" ? undefined : safeNext;

  return (
    <AuthForm
      mode="login"
      initialError={initialError}
      next={nextTarget}
      footer={<Footer next={nextTarget} />}
    />
  );
}
```

- [ ] **Step 2: Write the implementation for `/signup`**

Replace `src/app/(auth)/signup/page.tsx` with:

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { safeNextPath } from "@/lib/auth/next-path";

function Footer({ next }: { next?: string }) {
  return (
    <p className="text-muted-foreground text-center text-sm">
      Already have an account?{" "}
      <Link
        href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
        className="text-foreground font-medium underline-offset-4 hover:underline"
      >
        Sign in
      </Link>
    </p>
  );
}

// Reading `searchParams` makes this segment dynamic, so the form streams in
// behind a <Suspense> boundary — same Cache Components constraint as /login.
export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<AuthForm mode="signup" footer={<Footer />} />}>
      <SignupForm searchParams={searchParams} />
    </Suspense>
  );
}

async function SignupForm({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next);
  const nextTarget = safeNext === "/" ? undefined : safeNext;

  return (
    <AuthForm
      mode="signup"
      next={nextTarget}
      footer={<Footer next={nextTarget} />}
    />
  );
}
```

- [ ] **Step 3: Verify typecheck and build**

Run: `pnpm typecheck`
Expected: no errors.

Run: `rm -rf .next/types && pnpm build`
Expected: build succeeds. In the route table, `/signup` is now listed as dynamic (`ƒ`) rather than
static — that is the intended, spec-documented trade-off for reading `searchParams`. There must be no
"Uncached data accessed outside of `<Suspense>`" error.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/login/page.tsx" "src/app/(auth)/signup/page.tsx"
git commit -m "feat(auth): /login and /signup read and forward ?next=

Sanitizes at the page boundary, hands the target to AuthForm, and keeps next on
the sign-in/sign-up cross-link. /signup gains the same Suspense shape /login
already uses, since reading searchParams makes it dynamic."
```

---

## Task 7: `signIn` and `signUp` redirect to `next`

**Files:**

- Modify: `src/app/auth/actions.ts` (`signIn` ~lines 50–81, `signUp` ~lines 83–135)
- Modify: `src/app/auth/actions.test.ts`

**This is the security-critical boundary.** The `next` FormData field is fully client-controlled and
can be forged independently of the page's query string, so it must be sanitized _here_, not only in
the page.

- [ ] **Step 1: Write the failing test**

Append to `src/app/auth/actions.test.ts`:

```ts
const LF = "\n";

const loginFdWithNext = (next: string) => {
  const f = loginFd();
  f.set("next", next);
  return f;
};

describe("signIn — next handling", () => {
  it("redirects to a safe next", async () => {
    await expect(
      signInAction({}, loginFdWithNext("/boards/b1")),
    ).rejects.toThrow("REDIRECT:/boards/b1");
  });

  it("resumes an OAuth authorize request with its query string", async () => {
    const target = "/api/oauth/authorize?client_id=a&state=b";
    await expect(signInAction({}, loginFdWithNext(target))).rejects.toThrow(
      `REDIRECT:${target}`,
    );
  });

  it("redirects to / when there is no next (unchanged contract)", async () => {
    await expect(signInAction({}, loginFd())).rejects.toThrow("REDIRECT:/");
  });

  it.each([
    ["absolute URL", "https://evil.com"],
    ["protocol-relative", "//evil.com"],
    ["backslash trick", "/\\evil.com"],
    ["control character", "/" + LF + "/evil.com"],
    ["login loop", "/login"],
  ])("refuses a forged next (%s) and falls back to /", async (_label, next) => {
    // The field is client-controlled — the page-level sanitize cannot protect
    // this call path.
    await expect(signInAction({}, loginFdWithNext(next))).rejects.toThrow(
      "REDIRECT:/",
    );
  });

  it("does not redirect at all when the credentials are wrong", async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });

    const res = await signInAction({}, loginFdWithNext("/boards/b1"));

    expect(res.error).toBe("Invalid login credentials");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("signUp — next handling", () => {
  const signupFdWithNext = (next: string) => {
    const f = signupFd();
    f.set("next", next);
    return f;
  };

  it("threads a safe next into emailRedirectTo", async () => {
    serverEnv.value = { APP_BASE_URL: "https://app.example.com" };

    await signUpAction({}, signupFdWithNext("/boards/b1"));

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo:
            "https://app.example.com/auth/callback?next=%2Fboards%2Fb1",
        }),
      }),
    );
  });

  it("omits next from emailRedirectTo when it is unsafe", async () => {
    serverEnv.value = { APP_BASE_URL: "https://app.example.com" };

    await signUpAction({}, signupFdWithNext("https://evil.com"));

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.example.com/auth/callback",
        }),
      }),
    );
  });

  it("honours next when Supabase returns an immediate session", async () => {
    signUp.mockResolvedValue({
      data: { session: { access_token: "t" } },
      error: null,
    });

    await expect(
      signUpAction({}, signupFdWithNext("/boards/b1")),
    ).rejects.toThrow("REDIRECT:/boards/b1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/app/auth/actions.test.ts`
Expected: FAIL — `expected "REDIRECT:/" to be "REDIRECT:/boards/b1"` and the `emailRedirectTo` assertions mismatch.

- [ ] **Step 3: Write the implementation**

Add the import at the top of `src/app/auth/actions.ts`:

```ts
import { safeNextPath } from "@/lib/auth/next-path";
```

Add this helper below `getOrigin`:

```ts
/**
 * Read the post-sign-in destination off the submitted form.
 *
 * The field is FULLY CLIENT-CONTROLLED — the browser can forge it independently
 * of the `?next=` the page rendered — so this is the security-critical sanitize,
 * not the one in the page. `safeNextPath` is total: a hostile value degrades to
 * "/" rather than failing an otherwise valid sign-in.
 */
function nextFrom(formData: FormData): string {
  const raw = formData.get("next");
  return safeNextPath(typeof raw === "string" ? raw : null);
}
```

In `signIn`, replace the final `redirect("/")` (line 80) with:

```ts
// redirect() throws — must be called outside the try/catch above.
redirect(nextFrom(formData));
```

In `signUp`, replace the `origin` / `signUp` call block (lines 103–112) with:

```ts
const origin = await getOrigin();
const next = nextFrom(formData);
// Sanitize BEFORE embedding: an unvalidated value here would mint an off-site
// redirect inside an email we send. Same shape as requestPasswordReset below.
const emailRedirectTo =
  next === "/"
    ? `${origin}/auth/callback`
    : `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
const supabase = await createClient();
const { data, error } = await supabase.auth.signUp({
  email: parsed.data.email,
  password: parsed.data.password,
  options: {
    emailRedirectTo,
    data: { org_name: parsed.data.orgName },
  },
});
```

And replace the instant-session branch (line 130–132) with:

```ts
// When email confirmation is disabled, Supabase returns an active session.
if (data.session) {
  redirect(next);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/app/auth/actions.test.ts`
Expected: PASS — all pre-existing cases (including the anti-enumeration and rate-limit suites) plus 12 new ones (9 for `signIn`, 3 for `signUp`).

- [ ] **Step 5: Commit**

```bash
git add src/app/auth/actions.ts src/app/auth/actions.test.ts
git commit -m "feat(auth): signIn and signUp honour a sanitized next

signIn redirects to the submitted next (303 in a Server Action, so the browser
re-issues it as a GET — which is what lets next=/api/oauth/authorize resume).
signUp threads it through emailRedirectTo so email confirmation returns to the
same destination, and honours it on the instant-session path. The FormData
field is client-forgeable, so it is sanitized here, not only in the page."
```

---

## Task 8: server-side gates derive `next` from the proxy header

**Files:**

- Modify: `src/lib/auth/session.ts` (add `loginRedirectPath`; `requireUser` line 68)
- Modify: `src/lib/auth/session.test.ts`
- Modify: `src/lib/platform/guard.ts` (line 47)
- Modify: `src/app/home/page.tsx` (line 23)
- Modify: `src/app/(auth)/change-password/page.tsx` (line 18)

**Design note (do not "improve" this into a parameter):** `requireUser` has 99 references across 48
non-test files. Adding a `next` parameter would require every caller to know its own path — which RSC
cannot obtain without the same proxy header — so it would be this design _plus_ 48 files of churn and
48 chances to forget. Deriving inside the function is default-correct. When the header is absent
(route outside the proxy matcher, unit test) it degrades to today's bare `/login`.

- [ ] **Step 1: Write the failing test**

In `src/lib/auth/session.test.ts`, add a `next/headers` mock next to the existing mocks and append the new cases.

Add to the `vi.hoisted` block:

```ts
const { getClaims, redirect, from, headerMap } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  from: vi.fn(),
  headerMap: new Map<string, string>(),
}));
```

Add the mock (mirrors `src/app/auth/actions.test.ts`, where a `Map` stands in for the header store —
only `.get()` is used):

```ts
vi.mock("next/headers", () => ({ headers: async () => headerMap }));
```

Add `headerMap.clear();` to the existing `beforeEach`, then append:

```ts
describe("requireUser — ?next= carrying", () => {
  it("carries the proxy-stamped path so the user resumes after sign-in", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    headerMap.set("x-pulse-path", "/boards/b1?tab=x");
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow(
      "REDIRECT:/login?next=%2Fboards%2Fb1%3Ftab%3Dx",
    );
  });

  it("falls back to a bare /login when the header is absent", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("ignores a hostile header value", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    headerMap.set("x-pulse-path", "https://evil.com");
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("does not add next to the forced password-change redirect", async () => {
    getClaims.mockResolvedValue(
      claims({ app_metadata: { must_change_password: true } }),
    );
    headerMap.set("x-pulse-path", "/boards/b1");
    const { requireUser } = await import("./session");

    await expect(requireUser()).rejects.toThrow("REDIRECT:/change-password");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/auth/session.test.ts`
Expected: FAIL — `expected "REDIRECT:/login" to be "REDIRECT:/login?next=%2Fboards%2Fb1%3Ftab%3Dx"`.

- [ ] **Step 3: Write the implementation**

In `src/lib/auth/session.ts`, add the imports:

```ts
import { headers } from "next/headers";
import { loginPath, NEXT_PATH_HEADER } from "@/lib/auth/next-path";
```

Add above `requireUser`:

```ts
/**
 * The `/login` URL for THIS request, carrying `?next=` so the visitor resumes
 * where they were headed after signing in.
 *
 * The path comes from the `x-pulse-path` request header that `src/proxy.ts`
 * stamps on the forwarded request: RSC has no `usePathname()` equivalent, and
 * threading a parameter through `requireUser()`'s 48 call sites would be 48
 * chances to forget (and wrong for dynamic segments). When the header is absent
 * — a route outside the proxy matcher, or a unit test — this degrades to a bare
 * "/login", i.e. the pre-existing behaviour.
 *
 * Adds no round trip: `headers()` is an in-process read of the current request,
 * in call paths that already read cookies (so no new dynamic-rendering opt-in).
 */
export async function loginRedirectPath(): Promise<string> {
  const store = await headers();
  return loginPath(store.get(NEXT_PATH_HEADER));
}
```

And in `requireUser`:

```ts
/** Returns the authenticated user, redirecting to /login when absent. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  // redirect() throws — keep it outside any try/catch.
  if (!user) redirect(await loginRedirectPath());
  enforcePasswordChange(user);
  return user;
}
```

In `src/lib/platform/guard.ts`, extend the existing import and the redirect:

```ts
import { enforcePasswordChange, loginRedirectPath } from "@/lib/auth/session";
```

```ts
if (!user) redirect(await loginRedirectPath());
```

In `src/app/home/page.tsx`, extend the existing import and the redirect:

```ts
import {
  getUser,
  enforcePasswordChange,
  loginRedirectPath,
} from "@/lib/auth/session";
```

```ts
const user = await getUser();
if (!user) redirect(await loginRedirectPath());
```

In `src/app/(auth)/change-password/page.tsx`, extend the existing import and the redirect (the proxy
header includes the query string, so a recovery visit bounces to
`/login?next=%2Fchange-password%3Frecovery%3D1` and returns correctly):

```ts
import { getUser, loginRedirectPath } from "@/lib/auth/session";
```

```ts
const [{ recovery }, user] = await Promise.all([searchParams, getUser()]);
if (!user) redirect(await loginRedirectPath());
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/auth/session.test.ts`
Expected: PASS — the pre-existing `getUser` / `getUserOrgs` / `requireUser` suites plus 4 new cases.

Run: `pnpm vitest run src/lib/platform src/app/home`
Expected: PASS, unchanged. Pre-verified while scoping: every existing suite that touches
`@/lib/auth/session` mocks it (`vi.mock("@/lib/auth/session", …)`), and the two that load the real
module transitively (`src/lib/platform/guard.test.ts`, which only exercises `isPlatformAdmin` /
`isPlatformAdminCached`) never reach a redirect. Importing `next/headers` is harmless under Vitest —
only _calling_ `headers()` outside a request scope throws. So no other test file needs a new mock.
If one does fail on a missing header store, add
`vi.mock("next/headers", () => ({ headers: async () => new Map() }))` to that file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/session.ts src/lib/auth/session.test.ts src/lib/platform/guard.ts src/app/home/page.tsx "src/app/(auth)/change-password/page.tsx"
git commit -m "feat(auth): server-side gates redirect to /login?next=

requireUser(), requirePlatformAdmin(), /home and /change-password now derive
the ?next= target from the proxy-stamped x-pulse-path header via
loginRedirectPath(), so requireUser keeps its signature and none of its 48
call sites change. Absent header degrades to a bare /login."
```

---

## Task 9: full-gate verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole gate**

Run each command and read the output before claiming anything (Superpowers
`verification-before-completion`: evidence before assertions):

```bash
pnpm typecheck
pnpm lint
pnpm test
rm -rf .next/types && pnpm build
```

Expected: all four pass. `pnpm test` runs the `unit` project (the `integration` project skips without
`PULSE_TEST_DB`). If `pnpm build` reports a route-type error, the `rm -rf .next/types` above is the
known fix (stale Cache Components route types).

- [ ] **Step 2: Confirm the `/signup` rendering change is the only route-table delta**

Compare the build's route table against `develop`. Expected: `/signup` moves from static to dynamic;
nothing else changes. If any other route flipped, stop and investigate before merging.

- [ ] **Step 3: Grep for stragglers**

Run: `grep -rn 'redirect("/login")' src --include="*.ts" --include="*.tsx" | grep -v "\.test\."`
Expected: only `src/app/auth/actions.ts` — its three remaining bare `/login` redirects are
`changeOwnPassword`'s no-session guard and `signOut` / `signOutEverywhere`, which are correct
(nothing to resume after signing out, and the change-password path is explicitly out of scope per
spec §4.5).

- [ ] **Step 4: Manual acceptance walkthrough**

Execute spec §9 ("How to test") end to end — sections A, B, C and D. Section C is the payoff and the
one that must not be skipped: a signed-out user completing the MCP OAuth connect flow and landing on
the consent screen without touching the MCP client again.

- [ ] **Step 5: Finish the task**

Run: `scripts/finish-task.sh` from inside `.claude/worktrees/login-next-param`. Then hand the user the
numbered "How to test" walkthrough (spec §9) in the closing message, and record the session with
`/wrapup` — including an ADR in `vault/decisions/` for the two discovered traps, which are exactly the
kind of thing that will otherwise be rediscovered the hard way:

1. `src/proxy.ts` is the auth gate that actually fires; `requireUser()` is the second line of
   defence. Any redirect behaviour you add to a gate must be added to the proxy or it is dead code.
2. `safeNextPath` must reject ASCII control characters and re-check its canonical output — browsers
   and `new URL()` strip LF/CR/TAB, and `/..//evil.com` canonicalizes to `//evil.com`.

---

## Self-Review

**Spec coverage:**

| Spec section                                     | Task(s)                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| §2.2 proxy pre-empts / no producer of `next`     | 3                                                                              |
| §2.3 control-character bypass                    | 1, 2                                                                           |
| §2.4 hidden input would be ignored               | 5                                                                              |
| §3 Next 16 `searchParams` array shape            | 1 (array case), 6 (prop type)                                                  |
| §4.1 module layout                               | 1                                                                              |
| §4.2 D1 `requireUser` via header                 | 3 (producer), 8 (consumer)                                                     |
| §4.3 D2 query param + form field, sanitize twice | 6 (page), 5 (carrier), 7 (action)                                              |
| §4.4 D3 sanitizer rules 1–7                      | 1                                                                              |
| §4.5 D4 sign-up in scope                         | 6, 7                                                                           |
| §4.5 D4 change-password out of scope             | 9 Step 3 (asserted, not changed)                                               |
| §4.5 callback provisioning-error keeps `next`    | 2                                                                              |
| §4.6 D5 proxy allowlist                          | 4                                                                              |
| §5 attack table (15 rows)                        | 1                                                                              |
| §5 other five boundaries                         | 2, 3, 5, 7, 8                                                                  |
| §7 perf budget (no new queries/round trips)      | No task needed — no DB or fetch code is added; asserted by review of the diff. |
| §9 manual walkthrough                            | 9                                                                              |
| §10 stale-clone risk                             | 3 (explicit test)                                                              |

No gaps.

**Placeholder scan:** no TBD/TODO; every code step contains complete code; every test step contains
real assertions and an exact command with expected output.

**Type consistency:** `safeNextPath(next: string | string[] | null | undefined): string`,
`loginPath(next: string | string[] | null | undefined): string`,
`NEXT_PATH_HEADER = "x-pulse-path"`, `loginRedirectPath(): Promise<string>`, `AuthFormProps.next?:
string`, and the `nextFrom(formData: FormData): string` helper are used with those exact names and
signatures in Tasks 1–8. `store.get(NEXT_PATH_HEADER)` returns `string | null`, which
`loginPath` accepts.
