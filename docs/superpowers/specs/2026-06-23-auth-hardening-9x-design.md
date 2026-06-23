# Auth hardening 9x — Phase 9.1 deferred follow-ups (design)

**Status:** approved design (scope-to-plan; no user dialogue — recommendations + decision gates inline)
**Date:** 2026-06-23
**Branch / worktree:** `task/auth-hardening-9x` @ `.claude/worktrees/auth-hardening-9x`
**Parent:** `docs/superpowers/specs/2026-06-22-phase-9-performance-optimization-design.md` (§9.1)

## Motivation

Phase 9.1 (the auth fast-path) shipped: `src/lib/auth/session.ts` `getUser()` now verifies the
JWT **locally** via `getClaims()` (no per-request `/user` network call), and `src/proxy.ts` keeps
`auth.getUser()` "because that's what refreshes expiring tokens." Two defense-in-depth follow-ups
were noted in the §9.1 design and deferred:

1. **proxy: refresh-only-when-near-expiry** — the proxy calls `getUser()` (a network round-trip) on
   more requests than needed; refresh only when the token is actually near expiry, otherwise
   local-verify.
2. **`getUser()` revalidation on the most sensitive admin actions** — defense-in-depth network
   re-validation on high-blast-radius platform/admin server actions (current admin authz is already
   RPC/RLS-backed, so this is hardening, not a hole).

This spec grounds both items in the **actually-installed** `@supabase/auth-js@2.108.1` source and
makes an honest build/defer call on each. **Headline finding: the premises behind both deferred
items are largely already satisfied by the library and the existing code.** The valuable, real work
is small and narrow.

## Evidence — how token refresh actually works here (cited)

Installed: `@supabase/ssr@0.12.0`, `@supabase/supabase-js@2.108.1`, `@supabase/auth-js@2.108.1`.
Project uses **asymmetric (ES256) JWT signing keys** (§9.1 prerequisite, confirmed shipped — local
verify is live).

Reading `node_modules/.pnpm/@supabase+auth-js@2.108.1/node_modules/@supabase/auth-js/dist/module/GoTrueClient.js`:

- **`getClaims()` already refreshes near expiry.** `getClaims(jwt?, options?)` with **no `jwt`
  argument** (exactly how `session.ts:37` calls it) first does `await this.getSession()`
  (`GoTrueClient.js:5083-5089`) to obtain the access token, _then_ verifies the signature locally
  against the cached JWKS (`:5101-5141`). `getSession()` → `__loadSession()` (`:2407-2471`) computes
  `hasExpired = expires_at*1000 - Date.now() < EXPIRY_MARGIN_MS` (`:2434-2436`) and **only** calls
  `_callRefreshToken(refresh_token)` when within the margin (`:2438`, `:2462`). Otherwise it returns
  the stored session with **no network call**.
- **`EXPIRY_MARGIN_MS` = 90 s** (`lib/constants.js`: `AUTO_REFRESH_TICK_THRESHOLD(3) *
AUTO_REFRESH_TICK_DURATION_MS(30 000)`).
- **`getUser()` is strictly more expensive than `getClaims()`.** `getUser()` (no jwt) →
  `_getUser()` → `_useSession()` → the **same** `__loadSession()` near-expiry refresh, **plus an
  unconditional `GET {url}/user` network request every time** (`:2587-2591`). So per request:
  - `getClaims()` = (near-expiry-only refresh) + local crypto verify. **0 network calls** in the
    common case (token not near expiry).
  - `getUser()` = (near-expiry-only refresh) + **always 1 `/user` round-trip**.

**Implication for item (1):** the proxy's `auth.getUser()` (`proxy.ts:44-46`) does **not** add any
refresh logic that `getClaims()` lacks — both share the identical `__loadSession()` near-expiry
gate. The proxy's `getUser()` simply pays one **extra, unconditional** `/user` round-trip on every
matched request that `getClaims()` would not. "Refresh-only-when-near-expiry" is therefore **not a
new gate to build** — it is already the library's behavior. The real win is **swapping the proxy's
`getUser()` for `getClaims()`** so the proxy stops paying the redundant `/user` call, while refresh
(which lives in `getSession`/`__loadSession`, invoked by both) is preserved untouched.

### The one subtlety that makes this correct (and the risk)

The proxy is where the refreshed cookies are **written back to the browser** (`proxy.ts:28-38`
`setAll`). Refresh only happens when `__loadSession()` decides the token is near expiry — and that
decision is reached **whether we call `getUser()` or `getClaims()`**, because both route through
`getSession()`. So replacing `getUser()` with `getClaims()` in the proxy keeps the refresh-and-set-
cookie path intact. **The risk is entirely about not silently disabling refresh:** if a future edit
passed the token _into_ `getClaims(token)` (the one-arg form), it would **skip `getSession()` and
thus skip refresh** (`:5082-5089` only calls `getSession()` when `!token`). The plan must lock this
with a test, because getting it wrong logs users out ~1 h after sign-in with no error.

## Evidence — item (2): admin actions already revalidate (cited)

The §9.1 "accepted decision" was: _keep `getUser()` server-revalidation on the most sensitive
actions (admin console, user suspend/delete)._ Reading the current code, **this is already true**:

- `src/lib/platform/guard.ts:requirePlatformAdmin()` calls `supabase.auth.getUser()` (network) →
  `isPlatformAdmin()` RPC. Every `/admin` route is gated by it.
- `src/lib/platform/actions.ts` — every mutating platform action
  (`platformDeactivateUser`/`platformReactivateUser` via `setUserBan` `:50-55`,
  `platformResetUserPassword` `:102-107`, `platformSetUserPassword` `:140-145`, `platformDeleteUser`
  `:186-191`) calls `supabase.auth.getUser()` for the **actor** and re-checks `isPlatformAdmin()`
  before doing anything. `platformSetOrgRole` (`:26`) re-checks `isPlatformAdmin()` and runs through
  a SECURITY-DEFINER RPC (`platform_set_org_role`) that re-authorizes server-side.
- `src/lib/org/admin-actions.ts` — org-admin mutations call `getUser()` for the actor
  (`inviteMember` `:98`, `revokeInvite` `:140`, `resetMemberPassword` `:172`) and/or go through
  SECURITY-DEFINER RPCs (`set_member_role`, `remove_member`, `deactivate_member`,
  `reactivate_member`) and `has_org_role` that re-authorize under RLS.

So the **authz boundary is RPC/RLS** (the actual security guarantee, unaffected by JWT staleness),
and the most sensitive actions **already** call the network `getUser()`. There is **no hole** and
no missing revalidation on the hot paths the §9.1 note named.

## Approaches considered

**Item (1) — proxy redundant round-trip.**

- **A1 (recommended): swap `proxy.ts` `auth.getUser()` → `auth.getClaims()`; map result to a
  boolean `isAuthenticated` (`!!data?.claims`).** Removes the unconditional `/user` round-trip from
  every matched authenticated request; refresh preserved (shared `getSession` path). ~5-line change
  - tests. Honest, real, small win.
- **A2: hand-roll a "decode token, check `exp`, refresh only if near" gate in the proxy.** Rejected
  — this **re-implements `__loadSession()`** that the library already runs. Pure complexity with no
  benefit, and a new place to get refresh timing wrong. This is the literal "refresh-only-when-near-
  expiry" framing, and the grounding shows it's already done inside the SDK.
- **A3: do nothing.** The proxy round-trip is real per-request waste on the hot path; A1 is cheap
  and safe enough to be worth it. Rejected.

**Item (2) — admin-action revalidation.**

- **B1 (recommended): no-op / document.** The code already calls network `getUser()` on the
  sensitive actions and authz is RPC/RLS-backed. Building "add revalidation" would mean adding
  `getUser()` calls that are **already present** — manufactured work. Recommend **defer/close** with
  this spec as the written rationale, plus (optional, near-free) a single shared
  `requireFreshUser()` helper if we want to _standardize_ the pattern (see B2).
- **B2 (optional, low value): extract the repeated `getUser()`-actor + `isPlatformAdmin()` preamble
  into one `requireFreshPlatformAdmin()` / `requireFreshUser()` helper** and call it at the top of
  each sensitive action. Net effect on security: **zero** (same network call). Net effect on code:
  mild de-duplication. Worth doing **only** if bundled as a tidy-up, not as a security task. Honest
  call: borderline YAGNI; include as an explicit go/no-go.

## Recommendation (honest)

- **Item (1): BUILD.** Swap proxy `getUser()` → `getClaims()` (approach A1). Real, measurable
  per-request saving (1 auth-server `/user` round-trip on every matched authenticated request),
  ~5 LOC, refresh provably preserved. The "near-expiry gate" framing resolves to "the library
  already does this; stop paying the extra `/user` call."
- **Item (2): DEFER / CLOSE.** RLS + SECURITY-DEFINER RPCs are the real boundary and the sensitive
  actions already call network `getUser()`. No hole, nothing to add. This spec is the written
  rationale. Optional B2 helper is a borderline tidy-up, flagged as a decision, not recommended on
  its own.

## Data-fetching / performance budget (the whole point — fewer auth round-trips)

Per **matched, authenticated** request (proxy runs; common case = token NOT within 90 s of expiry):

| Path                           | Before (today)                                                         | After (item 1)                                                       |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `proxy.ts` auth check          | `getUser()` = **1 `/user` network round-trip** (+ near-expiry refresh) | `getClaims()` = **0 network** (local verify) (+ near-expiry refresh) |
| RSC page/layout (`session.ts`) | `getClaims()` = 0 network (already shipped)                            | unchanged — 0 network                                                |
| **Total auth round-trips/req** | **1** (proxy) + 0 (page) = **1**                                       | **0** (proxy) + 0 (page) = **0**                                     |

When the token **is** within 90 s of expiry: both before and after do exactly **1** refresh
round-trip (in `getSession`/`__loadSession`), shared by both code paths — no regression, just the
necessary refresh. Item (2) is **0** change to the round-trip budget (it already calls the network).

Net: removes the **last** per-request auth network call from the hot path for the steady-state case.
No new server data fetched; no `<Link>`/router navigation introduced; the proxy stays Node-runtime
session-refresh-and-redirect only (no DB/org lookups added — invariant preserved).

## Tests (mandatory) — and how we prove refresh is NOT broken

Item (1) is **defense-against-silent-logout**, so tests are the gate:

1. **`src/proxy.test.ts` (extend the existing suite).** Update the `@supabase/ssr` mock to expose
   `auth.getClaims()` (returning `{ data: { claims }, error }`) instead of / in addition to
   `getUser()`. Re-assert all four existing behaviors against `getClaims`:
   - authenticated on `/` → 307 → `/home`;
   - anonymous on `/` → pass-through (no redirect);
   - anonymous on protected route → 307 → `/login`;
   - authenticated on protected route → pass-through.
   - **New:** `getClaims` returning `{ data: null, error }` is treated as unauthenticated
     (→ `/login` on a protected route) — i.e. `isAuthenticated = !!data?.claims`.
2. **Refresh-preservation test (the silent-logout guard).** A focused test proving the proxy invokes
   `getClaims()` with **no jwt argument** (the form that routes through `getSession()` →
   near-expiry refresh), and that when the mocked client's `setAll` fires (simulating a refresh),
   the proxy still rebuilds the response and propagates set-cookies. Concretely: spy that
   `auth.getClaims` was called with `()` (zero args); and assert cookies written via the cookie
   adapter appear on the returned response. This is what catches a future regression to the
   token-passing (`getClaims(token)`) form that would disable refresh.
3. **Matcher tests** — unchanged, still pass (no matcher change).

If B2 helper is chosen: a unit test that `requireFreshUser()` returns the actor on a valid session
and the `fail("Not authenticated.")` / redirect path on a null user.

All four gates must pass in-worktree: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Risk register

| Risk                                                                      | Likelihood                                                           | Mitigation                                                                                                                               |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Silent logout** — proxy stops refreshing, users drop ~1 h after sign-in | Low (refresh lives in shared `getSession`) but **high blast radius** | Test #2 asserts `getClaims()` is called with no jwt arg + cookies propagate. Manual: sign in, idle past token TTL, confirm still authed. |
| Anonymous/error result mis-mapped → wrongful redirect                     | Low                                                                  | Test #1 covers null-claims and error cases explicitly.                                                                                   |
| Scope creep into hand-rolled exp gate (A2)                                | Medium (tempting)                                                    | Spec explicitly rejects A2; plan task forbids re-implementing `__loadSession`.                                                           |

## Units / boundaries (for the DAG)

- **Unit U1 — proxy auth check.** Input: `NextRequest` + cookies. Output: `NextResponse`
  (pass/redirect) + refreshed cookies. Internals swap `getUser()`→`getClaims()`. Consumers: none
  (terminal). Fully testable in isolation (`proxy.test.ts`).
- **Unit U2 (optional) — `requireFreshUser()` helper.** Only if B2 is greenlit. Independent of U1.

These do not share state. U1 is the whole build; U2 is optional and parallel. See plan's Execution
DAG.

## Open questions / decisions for review (go/no-go)

1. **Item (1) — BUILD?** Recommended **yes** (swap proxy `getUser()`→`getClaims()`; ~5 LOC + tests;
   removes the last hot-path auth round-trip; refresh provably preserved). _Decision:_ ▢ build ▢ skip
2. **Item (2) — DEFER/CLOSE?** Recommended **yes, close** (RLS/RPC is the boundary; sensitive actions
   already call network `getUser()`; nothing to add). _Decision:_ ▢ close with this rationale ▢ build B2
3. **Optional B2 helper (`requireFreshUser()` de-dup)?** Borderline YAGNI; **not recommended** on its
   own. _Decision:_ ▢ include as tidy-up ▢ skip
4. **Refresh-margin tuning?** The 90 s `EXPIRY_MARGIN_MS` is the library default and is fine; we are
   **not** proposing to change it (would require a custom client option and risks the silent-logout
   failure mode). _Decision:_ ▢ leave default (recommended) ▢ revisit later
