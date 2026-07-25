# `/login?next=` Post-Sign-In Redirect — Design

**Date:** 2026-07-25
**Branch:** `task/login-next-param`
**Status:** approved for planning

---

## 1. Problem

`/login` ignores `?next=`. A signed-out user who starts the MCP OAuth connect flow lands on the
dashboard after signing in instead of resuming at the consent screen, and has to re-click "Connect"
in their MCP client.

This is an app-wide gap, not an OAuth-specific one: **every** gate that bounces an unauthenticated
visitor to `/login` throws away where they were going. The OAuth flow is simply the first place it
bites an _external_ client, where "just click it again" is a worse experience than in-app.

The fix has one headline risk — an unvalidated `next` is an **open redirect** (phishing: land on
`app.pulse/login`, sign in, get bounced to `evil.com/login` and re-enter credentials). Every
accepted `next` must pass a sanitizer, and the sanitizer needs tests that encode the attack cases.

---

## 2. What was verified (and three corrections to the assumed footprint)

Everything below was read in this worktree at `develop@a78e1bd`; the two findings marked **NEW** were
proved with a runnable probe, not inferred.

### 2.1 Confirmed footprint

| File                                      | State on `develop`                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/(auth)/login/page.tsx`           | `searchParams: Promise<{ error?: string }>` — no `next`. Streams `<AuthForm>` behind `<Suspense>`.                                           |
| `src/components/auth/auth-form.tsx`       | Builds `FormData` **by hand** in `onSubmit`, then `formAction(formData)`.                                                                    |
| `src/app/auth/actions.ts`                 | `signIn` hardcodes `redirect("/")` (line 80); `signUp` hardcodes `redirect("/")` (131) and `emailRedirectTo: ${origin}/auth/callback` (109). |
| `src/app/auth/callback/route.ts`          | Exports `safeNextPath` — reusable, already tested (`route.test.ts`).                                                                         |
| `src/lib/auth/session.ts`                 | `requireUser()` → bare `redirect("/login")` (line 68).                                                                                       |
| `src/lib/platform/guard.ts`               | `requirePlatformAdmin()` → bare `redirect("/login")` (line 47).                                                                              |
| `src/app/home/page.tsx`                   | bare `redirect("/login")` (line 23).                                                                                                         |
| `src/app/(auth)/change-password/page.tsx` | bare `redirect("/login")` (line 18).                                                                                                         |
| `src/app/api/oauth/authorize/route.ts`    | Already emits `redirect(/login?next=<pathname+search>)` — correct, and **currently dead** (see 2.2).                                         |
| `src/app/oauth/consent/page.tsx`          | The resume target; gates on `requireUser()`.                                                                                                 |

**Correction 1 — call-site count.** `requireUser` appears **99 times across 48 non-test files**
(imports + calls), not ~47 call sites. The conclusion is unchanged and stronger: its signature must
not change.

### 2.2 NEW — `src/proxy.ts` is the real gate, and it pre-empts every one of those redirects

`src/proxy.ts:78` is the redirect that actually fires for a signed-out visitor:

```ts
if (!isAuthenticated && !isAuthRoute && !isPublicRoute) {
  return NextResponse.redirect(new URL("/login", request.url)); // no `next`
}
```

The proxy runs **before** any RSC or route handler. Its matcher (`src/proxy.ts:114`) excludes only
`_next/*`, `favicon.ico`, `manifest.webmanifest`, `login`, `signup`, `updates` and static assets.
Verified against the live regex:

```
/api/oauth/authorize  => PROXY RUNS      /oauth/consent  => PROXY RUNS
/api/oauth/token      => PROXY RUNS      /api/mcp        => PROXY RUNS
/.well-known/oauth-authorization-server => PROXY RUNS
```

Two consequences:

1. **`/api/oauth/authorize`'s own correct `?next=` redirect is unreachable code today.** The proxy
   307s the signed-out request to a bare `/login` first. So the bug is not only "`/login` ignores
   `next`" — nothing is producing `next` in the first place. **Any fix that only touches `/login`
   and `requireUser()` will not fix the reported symptom.**
2. **The MCP OAuth flow is currently unreachable end-to-end for a cookieless client.** `/api/mcp`,
   `/api/oauth/token`, `/api/oauth/register` and both `/.well-known/oauth-*` metadata routes are
   authenticated by Bearer token / PKCE / not at all — never by a session cookie — so the proxy sees
   `!isAuthenticated` and 307s them to `/login`. An MCP client asking for
   `/.well-known/oauth-protected-resource` gets an HTML login redirect instead of metadata, and
   `/api/mcp` never gets to emit its `401 WWW-Authenticate` challenge (`withMcpAuth`,
   `src/app/api/mcp/route.ts:16`). The 2026-07-24 MCP plan never touched the proxy allowlist.

Finding 2 is a pre-existing P0 that is **in scope here**, narrowly: without it the required
acceptance walkthrough ("a signed-out user completes the MCP OAuth connect flow") cannot be
performed at all. It is a ~5-line allowlist change in the same file this task already edits. It is
kept as its own task so it can be split out if desired.

### 2.3 NEW — the existing `safeNextPath` has a live open-redirect bypass

`safeNextPath` rejects `//evil.com`, `/\evil.com`, absolute URLs and non-rooted values. It does
**not** reject ASCII control characters — and both browsers and the WHATWG URL parser _strip_
TAB/LF/CR from a URL before parsing, so a stripped value can become protocol-relative. Probe output
(`node`, real `new URL`):

```
raw="/\n/evil.com"      sanitized="/\n/evil.com"      resolved=https://evil.com/     OFFSITE=true
raw="/\t/evil.com"      sanitized="/\t/evil.com"      resolved=https://evil.com/     OFFSITE=true
raw="/\r/evil.com"      sanitized="/\r/evil.com"      resolved=https://evil.com/     OFFSITE=true
raw="/%2f%2fevil.com"   sanitized="/%2f%2fevil.com"   resolved=https://app/%2f%2f…   OFFSITE=false
raw="/..//evil.com"     sanitized="/..//evil.com"     resolved=https://app//evil.com OFFSITE=false
```

`GET /auth/callback?next=%2F%0A%2Fevil.com` therefore 307s to `https://evil.com/` **on `develop`
today** — no session, no `code`, anyone can send the link. Hardening the sanitizer is not
speculative future-proofing for this feature; it closes a shipped hole before we widen the
sanitizer's blast radius from one route to six.

(For the Server-Action path the same value would instead throw: `Headers.set` rejects a `Location`
containing LF. A 500 is not an open redirect, but it is still a bug, and it means "it didn't
redirect off-site" is not evidence the value was rejected.)

### 2.4 Correction 3 — a hidden `<input name="next">` would be silently ignored

`auth-form.tsx` does not submit the DOM form. `onSubmit` runs react-hook-form validation and then
constructs `FormData` field by field (`formData.set("email", …)`) before calling the
`useActionState` dispatcher. Any field not explicitly `set()` never reaches the server action. `next`
must be added to that builder, not to the markup.

---

## 3. Next.js 16 API confirmation (`next@16.2.9`, docs read in `node_modules/next/dist/docs/`)

- **`searchParams` is a Promise** and its values are `string | string[] | undefined`
  (`01-app/03-api-reference/03-file-conventions/page.md:75,111-120`). It is a request-time API that
  opts the page into dynamic rendering — which is why `login/page.tsx` already resolves it inside a
  `<Suspense>` boundary under Cache Components. **`?next=a&next=b` yields an array**, so the
  sanitizer must accept `string | string[] | null | undefined` and reject arrays.
- **`redirect(path, type?)`** — `'replace'` by default, `'push'` in Server Actions; serves **303** in
  a Server Action, **307** elsewhere, and inserts a client-side meta redirect in a streaming context
  (`01-app/03-api-reference/04-functions/redirect.md:11,26-31`). The 303 matters: after `signIn`, the
  browser re-issues the request to `next` as a **GET**, which is what makes
  `next=/api/oauth/authorize?…` (a GET route handler) resume correctly.
- `redirect` throws, must sit outside `try/catch`, and accepts absolute/external URLs — the reason a
  sanitizer is mandatory rather than defence in depth.
- **Proxy → RSC request headers**: `NextResponse.next({ request: { headers } })` propagates a header
  upstream to the application; `NextResponse.next({ headers })` would leak it to the client
  (`01-app/03-api-reference/03-file-conventions/proxy.md:384-436`). Setting request headers is the
  documented way to pass information from proxy to app.
- `proxy.ts` (not `middleware.ts`) is the Next 16 convention; the repo already uses it.

---

## 4. Design

### 4.1 Overview

One pure module owns the rules; five call sites use it.

```
src/lib/auth/next-path.ts   (pure, no next/* imports — importable from proxy AND app)
  ├── safeNextPath(value)          → a guaranteed same-origin rooted path, or "/"
  ├── loginPath(next)              → "/login" | "/login?next=<encoded>"
  └── NEXT_PATH_HEADER             → "x-pulse-path"

producers of `next`
  ├── src/proxy.ts                 → loginPath(pathname + search)   ← the gate that actually fires
  ├── src/lib/auth/session.ts      → loginRedirectPath() reads NEXT_PATH_HEADER via headers()
  │     └── used by requireUser(), guard.ts, home/page.tsx, change-password/page.tsx
  └── src/app/api/oauth/authorize  → already correct; becomes reachable once 4.6 lands

carriers of `next`
  ├── /login page  → sanitize searchParams.next → prop → AuthForm
  └── AuthForm     → formData.set("next", next) in the manual builder

consumers of `next`
  ├── signIn()          → redirect(safeNextPath(formData.get("next")))
  ├── signUp()          → emailRedirectTo=/auth/callback?next=…  and the instant-session redirect
  └── /auth/callback    → already consumes it (hardened sanitizer)
```

### 4.2 Decision D1 — how `requireUser()` learns where the user was going

**Chosen: derive it inside `requireUser()` from a proxy-set request header. Signature unchanged.**

`src/proxy.ts` stamps the resolved path onto the forwarded request
(`x-pulse-path: <pathname><search>`); `session.ts` exports
`loginRedirectPath(): Promise<string>` which reads `headers()`, runs the value through
`safeNextPath`, and returns `loginPath(...)`. `requireUser()` becomes
`if (!user) redirect(await loginRedirectPath())`. Zero changes at 48 files. When the header is absent
(route outside the proxy matcher, unit test, direct invocation) it degrades to bare `/login` —
today's behaviour, so nothing can regress.

Why not the alternatives:

- **Optional parameter — `requireUser({ next })` at each call site.** Rejected. RSC has no
  `usePathname` equivalent, so each caller would have to obtain the path from… the same proxy header,
  making this strictly the header approach _plus_ 48 files of churn. Hardcoding literals instead
  (`requireUser({ next: "/boards" })`) is wrong for dynamic segments and query strings, and gives 48
  future call sites a rule to forget. A default-correct gate beats an opt-in one.
- **Proxy only; leave `requireUser()` bare.** Tempting (2 files, ~10 lines) and it does fix the
  reported symptom, because the proxy pre-empts. Rejected because it leaves the stated app-wide gap
  open exactly where it is hardest to notice: `requireUser()` fires when the proxy judged the request
  authenticated but the RSC read did not — a token expiring between proxy and render, a JWKS blip —
  and that user is silently dropped at `/` after re-login. Covering it costs one `headers()` read in
  a function that already reads cookies (so it adds no new dynamic-ness and no round trip).
- **Cookie instead of header** (proxy writes the attempted path to a short-lived cookie; `/login`
  reads it). Rejected: cookies are ambient. Two tabs racing two gated routes overwrite each other's
  destination, and it means a `Set-Cookie` on every gated request. A header is per-request by
  construction.

### 4.3 Decision D2 — query param, form field, or both?

**Both, sanitized at both boundaries.**

`next` must be a **query param** on the way in: that is the only channel a redirecting gate (proxy,
route handler, RSC) can use, and it survives the user reloading `/login`. It must become a **form
field** to cross the sign-in POST: `signIn` is a Server Action invoked through `useActionState`, so it
has no reliable access to the page's URL (`referer` is spoofable and absent under some privacy
settings), and `FormData` is the action's designed input channel.

Sanitize **twice**, because the two reads are independently attacker-controlled:

1. In the page, on `searchParams.next` — so the value handed to the client component is already safe
   and no unvalidated string is embedded in the payload.
2. In `signIn`, on `formData.get("next")` — the form field is fully client-controlled and can be
   forged with no bearing on the page's query string. **This is the security-critical check**; the
   page-level one is hygiene.

`safeNextPath` stays a _total_ function with a safe fallback (`"/"`) rather than a throwing Zod
schema: a malformed `next` must never turn a valid sign-in into an error page. This matches the
existing callback-route contract and keeps one behaviour across six call sites. (The credential
schemas in `src/lib/validations/auth.ts` are deliberately untouched — `next` is not a credential and
must not be able to fail sign-in validation.)

### 4.4 Decision D3 — the sanitizer: one hardened module, moved out of the route file

`safeNextPath` moves from `src/app/auth/callback/route.ts` to **`src/lib/auth/next-path.ts`**
(the route imports it instead of declaring it; its sanitizer tests move with it, and `route.test.ts`
is rewritten to cover the handler's own redirect behaviour). Reasons: a
security primitive used by the proxy cannot live in a route file (the proxy must not import a route
module, and `next-path.ts` must stay free of `next/*` imports so both runtimes can use it); and
`src/lib/auth/` is where the other auth primitives already live.

Hardened rules, in order:

1. `null` / `undefined` / `""` / **array** (`?next=a&next=b`) → `"/"`.
2. Contains any ASCII control character (`/[\u0000-\u001F\u007F]/`) → `"/"`. **(Closes 2.3.)**
3. Does not start with `/`, or starts with `//`, or starts with `/\` → `"/"`.
4. Resolves off-origin against a probe origin → `"/"`. Belt-and-braces:
   `new URL(value, "https://pulse.invalid")` must keep `origin === "https://pulse.invalid"`; a throw
   also means `"/"`. This makes the guarantee structural rather than a list of known tricks, so the
   next unknown parser quirk fails closed.
5. Resolves to an auth-flow path (`/login`, `/signup`, `/auth/*`, `/forgot-password`) → `"/"`, so a
   crafted `next` can't build a redirect loop or a "sign in twice" phishing surface.
6. Build the **canonicalized** same-origin form `pathname + search + hash` from step 4 — already-safe
   values such as `/boards/123?tab=x#c` round-trip unchanged.
7. **Re-check the canonical form**: if it starts with `//` → `"/"`. Non-obvious and mandatory —
   `new URL("/..//evil.com", probe).pathname` is `"//evil.com"` (verified), so canonicalization can
   _manufacture_ a protocol-relative value that step 3 never saw. Returning it would hand
   `redirect()` an off-site target.

Length is capped at 2048 chars (→ `"/"`) so a hostile `next` can't push the `Location` header toward
a 431.

### 4.5 Decision D4 — sign-up in scope, forced password change out

**Sign-up: in scope.** A brand-new user connecting an MCP client for the first time is a real path,
and dropping `next` there would leave the feature half-working.

- `/signup?next=` is read and forwarded to `AuthForm` exactly like `/login`. This makes
  `signup/page.tsx` dynamic, so it adopts the same `<Suspense>` shape `login/page.tsx` already uses
  (Cache Components: no uncached read outside a boundary).
- Both pages' footer links preserve `next` (`/signup?next=…` ⇄ `/login?next=…`) so switching forms
  doesn't silently drop the destination.
- `signUp` threads `next` into `emailRedirectTo`:
  `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}` — the exact shape
  `requestPasswordReset` already uses (`actions.ts:169-173`), so `/auth/callback` resumes after email
  confirmation. Sanitize **before** embedding: an unvalidated value here would mint an off-site
  redirect inside an email we send.
- The instant-session branch (`if (data.session) redirect("/")`) honours `next`.
- `/auth/callback`'s provisioning-failure redirect preserves it:
  `/login?error=provisioning&next=…`.

**Forced password change: explicitly out of scope.** `enforcePasswordChange` → `/change-password`
and `changeOwnPassword` → `redirect("/")` keep today's behaviour. Reasons: (a) the flag is set by a
platform admin, so this is a rare interruption that already breaks flow by design; (b) preserving
`next` needs a _second_ carrier through a different form, and `/change-password` already uses its
query string for `recovery=1`, so `next` would have to be double-nested through
`/auth/callback?next=/change-password?recovery=1&next=…` — cost far above the benefit; (c) YAGNI —
nothing in the OAuth payoff path is flagged. What we _do_ guarantee is no regression: an
unauthenticated hit on `/change-password` uses the shared helper, so it bounces to
`/login?next=/change-password?recovery=1` and returns correctly.

### 4.6 Decision D5 — proxy allowlist for cookieless OAuth/MCP endpoints (discovered blocker)

Add prefix-matched public routes so the proxy stops 307-ing endpoints that are never
cookie-authenticated:

| Path                   | Why it must not be cookie-gated                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/.well-known/oauth-*` | RFC 8414 / RFC 9728 metadata — public by specification.                                                                                                                                                                                                                         |
| `/api/oauth/*`         | `register` + `token` are client-to-server (PKCE / client_id). `authorize` must reach its own handler so it can validate `client_id`/`redirect_uri` **before** bouncing to login — a bogus client should get `400`, not a login page — and it already builds the correct `next`. |
| `/api/mcp`             | Bearer-token authenticated; must be free to answer `401 WWW-Authenticate` so the client can begin discovery.                                                                                                                                                                    |

`/oauth/consent` stays gated: it is a page, and the proxy's now-`next`-carrying redirect plus
`requireUser()` are exactly the right treatment for it.

This is intentionally the minimum needed to make the acceptance path executable. No new endpoint is
exposed — each of these already performs its own authentication.

---

## 5. Attack cases and the tests that must prove them

Every row is a required test in `src/lib/auth/next-path.test.ts` (`expect(safeNextPath(x)).toBe("/")`
unless stated).

| #   | Input                                                       | Why it's dangerous                                       |
| --- | ----------------------------------------------------------- | -------------------------------------------------------- |
| 1   | `https://evil.com`, `http://evil.com/x`                     | Absolute URL — `redirect()` accepts external URLs.       |
| 2   | `//evil.com`, `//evil.com/path`                             | Protocol-relative → off-origin.                          |
| 3   | `/\evil.com`, `/\\evil.com`                                 | Browsers normalize `\` → `/`.                            |
| 4   | `"/" + "\n" + "/evil.com"` (URL form `/%0A/evil.com`)       | **Live bypass (2.3)** — LF stripped → `//evil.com`.      |
| 5   | same with `"\t"` (`%09`) and `"\r"` (`%0D`)                 | Same trick via TAB and CR.                               |
| 6   | `"/" + "\n\n" + "//evil.com"`                               | Multiple control chars.                                  |
| 7   | `javascript:alert(1)`, `data:text/html,…`                   | Scheme injection on a non-rooted value.                  |
| 8   | `evil.com`, `../evil.com`                                   | Non-rooted / relative escape.                            |
| 9   | `["/a","/b"]` (array)                                       | `?next=a&next=b` — `searchParams` yields `string[]`.     |
| 10  | `/login`, `/signup`, `/auth/callback`, `/login?next=/login` | Redirect loop / double-sign-in phishing surface.         |
| 11  | `"/" + "a".repeat(4000)`                                    | Oversized `Location` header (431).                       |
| 12  | `null`, `undefined`, `""`                                   | Missing value → default `"/"`.                           |
| 13  | `/%2f%2fevil.com` → **unchanged**                           | Must NOT over-block: stays same-origin (probe-verified). |
| 14  | `/boards/123?tab=x#c`, `/` → **unchanged**                  | Must NOT over-block the legitimate case.                 |
| 15  | `/..//evil.com`                                             | `..` canonicalizes to `//evil.com` — see rule 7 (D3).    |

Plus, at the other five boundaries:

- **`signIn`** (`src/app/auth/actions.test.ts`): honours a safe `next`; falls back to `/` for a hostile field
  value (assert `redirect` called with `/`, i.e. the sanitizer runs on the FormData read, not just in
  the page); no `next` → `/` (unchanged contract).
- **`signUp`**: safe `next` reaches `emailRedirectTo` encoded; hostile `next` yields a plain
  `/auth/callback`; instant-session branch honours `next`.
- **`proxy`**: anonymous on `/boards/b1` → `location = /login?next=%2Fboards%2Fb1`; query string
  preserved; anonymous on `/api/oauth/authorize?…` → **no redirect** (allowlisted, D5); `/api/mcp`
  and `/.well-known/oauth-protected-resource` → no redirect; `x-pulse-path` is set on the forwarded
  request and _not_ on the client-visible response; the existing "authenticated `/` → `/home`" and
  last-board-cookie assertions still pass.
- **`requireUser`** (`session.test.ts`): with `x-pulse-path` present → `/login?next=…`; absent →
  bare `/login` (regression guard); hostile header value → bare `/login`.
- **`AuthForm`**: submitting with `next` set includes it in the dispatched `FormData`; without it,
  `next` is absent (not `""`).

---

## 6. Units and their independence (for the plan's DAG)

- **U1 `next-path.ts`** — pure functions + header-name constant. Depends on nothing. Everything else
  depends on it.
- **U2 proxy gate + allowlist** — depends on U1 only. Disjoint file from U3/U4.
- **U3 login/signup pages + AuthForm + `signIn`/`signUp`** — depends on U1. Independent of U2.
- **U4 server-side gates** (`session.ts`, `guard.ts`, `home/page.tsx`, `change-password/page.tsx`) —
  depends on U1 for logic and on U2 for the header to exist at runtime.
- **U5 callback-route re-export + provisioning-error `next`** — depends on U1. Independent of U2–U4.

U2 and U3 (and U5) touch disjoint files and can run concurrently; U4 lands after U2.

---

## 7. Performance & data-fetching budget (working agreement #5)

**(a) First paint vs. interaction.** No new server round trip anywhere. `/login` already resolves
`searchParams` inside its `<Suspense>` boundary — reading one more key from the same resolved object
adds nothing. `/signup` moves from static to dynamic (it must read `searchParams`), which is a real
change: it is mitigated by keeping the identical Suspense shape, so the shell still streams
immediately and only the form segment awaits. Signing in is already one Server Action; `next` changes
only the redirect target. Carrying `next` through a **hidden FormData field, not a client
navigation**, means zero extra RSC requests — no `<Link>`, no `router.push`, no `history` write is
added.

**(b) Does the interaction change server data?** Sign-in already does (Server Action, session
cookie). `next` itself is inert: it is never persisted, never written to a cookie (see D1's rejected
alternative), and triggers no revalidation.

**(c) Bounded, indexed hot-path reads.** **Zero new DB queries.** `requireUser()` gains one
`await headers()` — an in-process read of the current request, no network, in a function that already
reads cookies (so no new dynamic-rendering opt-in). The proxy gains one `new Headers(request.headers)`
clone per request: in-memory, proportional to header count, on a code path that already constructs
`NextResponse.next()` objects. No `select *`, no new table access, no unbounded read.

---

## 8. Out of scope

- Forced-password-change `next` preservation (D4).
- OAuth consent-screen redesign, scope selection, or per-client consent memory.
- Rewriting the proxy's route-matching model (the allowlist is additive; the matcher regex is
  untouched).
- Playwright e2e coverage — `e2e/` is not part of the `pnpm test` gate and has no auth spec; the
  OAuth resume is verified by the manual walkthrough in §9.
- Rate-limiting or auditing of `next` values.

---

## 9. How to test (manual acceptance)

Setup: `git checkout develop && git pull && pnpm install && pnpm dev` (DEV Supabase via
`.env.local`). Use a private window so you start signed out.

**A — the app-wide gap (2 minutes)**

1. Sign out. Visit `http://localhost:3000/boards` directly.
   → You land on `/login?next=%2Fboards` (check the address bar — the `next` param is the fix).
2. Sign in.
   → You land on **`/boards`**, not the dashboard.
3. Click "Sign up" in the login footer.
   → The URL keeps `?next=%2Fboards`.

**B — open-redirect refusal (1 minute)**

4. Visit `http://localhost:3000/login?next=https://example.com` and sign in.
   → You land on `/` (in-app). No off-site navigation.
5. Repeat with `?next=//example.com`, `?next=/%5Cexample.com`, and
   `?next=%2F%0A%2Fexample.com` (the encoded-newline bypass).
   → All land on `/`. Nothing leaves the origin.
6. Visit `http://localhost:3000/auth/callback?next=%2F%0A%2Fexample.com`.
   → You land on `/`. (On `develop` today this sends you to `https://example.com/`.)

**C — the real payoff: MCP OAuth connect while signed out (5 minutes)**

7. Still signed out, confirm discovery is no longer login-walled:
   `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/.well-known/oauth-protected-resource`
   → `200` (on `develop` today: `307` to `/login`).
   `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/mcp`
   → `401` with a `WWW-Authenticate` header, not a redirect.
8. Sign in once, open **Settings → MCP**, and copy the server URL shown there.
9. Sign out again (private window, or Settings → sign out) so the browser has no Pulse session.
10. Add the copied URL as an MCP connector in your MCP client (Claude Desktop → Settings →
    Connectors → Add custom connector, or claude.ai → Connectors). Click **Connect**.
11. The client opens the browser at `/api/oauth/authorize?client_id=…&code_challenge=…`.
    → Because you're signed out you land on **`/login?next=%2Fapi%2Foauth%2Fauthorize%3F…`** with the
    full authorize query intact in `next`.
12. Enter your credentials and submit.
    → **You land directly on the "… wants to access your Pulse account" consent screen** — you do
    **not** pass through the dashboard and you do **not** touch the MCP client again. This single step
    is the whole point of the task.
13. Click **Allow access**.
    → The browser returns to the MCP client's redirect URI with `code=…`; the client reports the
    connector as connected.
14. In the MCP client, ask it to list your Pulse boards.
    → It returns your boards, proving the token exchange completed on the same uninterrupted pass.

**D — no regressions (2 minutes)**

15. Sign out, visit `/` → the static landing renders (no redirect). Sign in from `/login` with no
    `next` → you land where you always did (last board / onboarding / welcome).
16. Trigger "Forgot password?", follow the emailed link → you land on `/change-password` with the
    self-serve copy, exactly as before.

---

## 10. Risks

| Risk                                                                                                                                                      | Mitigation                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloning request headers in the proxy **before** Supabase's `setAll` writes refreshed cookies would ship a stale `Cookie` header upstream → silent logout. | Clone `request.headers` **at each `NextResponse.next(...)` construction site**, i.e. inside `setAll` after `request.cookies.set(...)`, never once at the top. Regression test: the existing "refresh writes cookies" proxy test must still pass. |
| Over-blocking the sanitizer breaks legitimate targets (`%2f`, `#hash`, query strings).                                                                    | Tests 13–15 in §5 pin the must-pass cases. Canonicalize via `new URL` rather than string surgery.                                                                                                                                                |
| `/signup` becomes dynamic → prerender lost.                                                                                                               | Reuse the exact `<Suspense>` shape from `login/page.tsx`; `pnpm build` output reviewed for the route change.                                                                                                                                     |
| A submit landing _before_ the Suspense boundary resolves would post without `next`.                                                                       | Same pre-existing shape as `initialError`; the streamed segment arrives in the same response and the form can only submit after hydration. Accepted, documented.                                                                                 |
| Widening the proxy allowlist (D5) exposes something unintended.                                                                                           | Prefix-scoped to `/.well-known/oauth-`, `/api/oauth/`, `/api/mcp` — each already authenticates itself. Proxy tests assert `/boards/*` and `/settings/*` stay gated.                                                                              |
| Scope creep: D5 is a separate pre-existing bug.                                                                                                           | Isolated in its own plan task; can be dropped without touching the rest, at the cost of §9-C being unverifiable.                                                                                                                                 |
