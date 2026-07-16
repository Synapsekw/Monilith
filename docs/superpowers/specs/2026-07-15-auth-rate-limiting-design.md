# Auth Rate Limiting — Design Spec

- **Date:** 2026-07-15
- **Status:** Draft — awaiting review
- **Origin:** Deferred Audit Batch B item ("Rate-limit the auth endpoints")
- **Surface:** `src/app/auth/actions.ts` server actions + `src/lib/validations/auth.ts`

## 1. Problem & Intent

The auth server actions are currently unmetered. Nothing in the app stops an
attacker from:

- **Credential stuffing / brute force** — hammering `signIn` with leaked
  password lists against one account, or spraying one password across many
  accounts from one host.
- **Signup abuse** — looping `signUp` to mint throwaway accounts/orgs and
  burn Supabase's signup-email quota.
- **Reset-email abuse** — looping `requestPasswordReset` to spam a victim's
  inbox (or drain the project email quota).

A footprint scan confirms **no rate-limit infrastructure exists today**. There
is no limiter store, no IP extraction, no throttle helper. Supabase's own
GoTrue endpoints _do_ apply project-level rate limits (the codebase already
observes `over_request_rate_limit` / `over_email_send_rate_limit` — see
`src/test/integration-auth.ts` and `actions.test.ts`), but those are
global/opaque, not tunable per-endpoint or per-identifier from app code, and
they give us no app-level observability or UX control. This work adds an
**application-level limiter in front of the Supabase calls** as an additive,
controllable layer — GoTrue remains a backstop, not the primary defense.

### Goals

1. Bound the request rate of all four mutating auth actions per client, keyed
   by the right dimension (per-IP and/or per-identifier).
2. Preserve the existing **email-enumeration-safe** behavior exactly (a
   duplicate signup / nonexistent reset stays indistinguishable from the happy
   path — see `signUp` and `requestPasswordReset` in `actions.ts`).
3. Emit enough observability to see an attack in Vercel logs.
4. Add **zero new third-party vendors or env vars** — stand the limiter up on
   infrastructure the repo already owns and tests.

### Non-goals (YAGNI)

- No CAPTCHA / proof-of-work / MFA (separate initiatives).
- No admin dashboard / UI for limits (config-in-code is enough; log-based
  observability only — an audit table is a documented follow-up, not built now).
- No distributed-botnet defense guarantee (see §7 fail-open + the open
  question); coarse edge/WAF IP throttling is a recommended ops follow-up, not
  in this deliverable.
- No change to `signOut` (idempotent, session-bound, no abuse value).

## 2. Real Footprint (grounded in code)

The mutating actions in `src/app/auth/actions.ts` (exact current names — the
Audit brief's `forgotPassword`/`changePassword` are stale):

| Action                 | Signature                      | Auth state                      | Abuse vector                | Anti-enumeration contract                                                                               |
| ---------------------- | ------------------------------ | ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `signIn`               | `(prev, FormData) → AuthState` | anonymous                       | brute force / stuffing      | surfaces `error.message` verbatim on bad creds                                                          |
| `signUp`               | `(prev, FormData) → AuthState` | anonymous                       | account/org spam            | must return `{ success: "check-email" }` regardless of account existence; only `weak_password` surfaces |
| `requestPasswordReset` | `(prev, FormData) → AuthState` | anonymous                       | reset-email spam            | must **always** return `{ success: "reset-email-sent" }`                                                |
| `changeOwnPassword`    | `(prev, FormData) → AuthState` | **authenticated** (has session) | low — needs a valid session | surfaces `error.message`                                                                                |

Return shape is `AuthState = { error?: string; success?: string }` (not the
repo-wide `ActionResult` — these predate it; we keep `AuthState` to avoid
churning the four consumer components in `src/components/auth/`).

Supporting infra we will reuse (do **not** re-invent):

- **Service client** — `createServiceClient()` in `src/lib/supabase/service.ts`
  (server-only, RLS-bypassing, no-op cookies). This is how the limiter talks to
  the DB, so the counter RPC is **never exposed to `anon`/PostgREST**.
- **Typed RPC** — `typedRpc()` in `src/lib/supabase/typed-rpc.ts` for the
  counter call (cast-free, checked against generated types after `pnpm db:types`).
- **Migrations** — minted via `scripts/new-migration.sh <slug>`, applied to DEV
  via the `supabase-dev` MCP with the same version+name, types regenerated with
  `pnpm db:types`. SECURITY DEFINER + `set search_path = ''` + execute-grant
  lockdown is the house pattern (see
  `supabase/migrations/20260709124750_create_organization_atomic_guarded.sql`).
- **Headers** — `headers()` from `next/headers` (already used in `getOrigin()`)
  is how a server action reads request headers, including the client IP.
- **Env** — server-only vars live in `src/lib/env.server.ts` (lazy, memoized,
  Zod-validated). New _optional_ tuning vars land here; the feature needs **no
  required new var**.

## 3. Chosen Approach — Supabase table + SECURITY DEFINER counter RPC

### Options weighed

| Option                                                         | Fit                                                                                                                                                                                                                                                                                         | Verdict                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **A. Supabase table + SECURITY DEFINER RPC counter**           | Native to the repo's migration / definer-RPC / typed-rpc / service-client conventions; no new vendor or env; fully testable on DEV with the existing integration harness. Auth is **not** a hot path (a handful of calls per user session), so one extra Postgres round-trip is negligible. | **CHOSEN**                                                                    |
| B. Upstash Redis via Vercel Marketplace (`@upstash/ratelimit`) | Purpose-built sliding-window, atomic, sub-ms. But adds a vendor, env vars, a new failure mode, and a second data plane the test suite doesn't cover. Overkill for auth-volume traffic.                                                                                                      | Rejected (revisit only if a general-purpose app-wide limiter is later needed) |
| C. Vercel WAF / platform rate limiting / BotID                 | Runs at the edge _before_ the function — great coarse per-IP DDoS/bot mitigation, but configured in the dashboard/API (not in code/tests), and **cannot** do per-email or app-aware logic (won't stop stuffing that rotates IPs against one account, nor per-email reset spam).             | Complementary, not primary — documented as a recommended ops follow-up        |

**Why A wins:** it keeps the security model in one place (Postgres + RLS +
definer functions the repo already audits), ships with the code in a versioned
migration, is exercised by `pnpm test` against DEV, and introduces no new
operational surface. The cost it trades away — Redis-grade latency and
distributed-attack coverage — doesn't matter at auth volume, and GoTrue's
project-level limit plus a future WAF rule cover the distributed case.

### Architecture

Three isolated units, each independently testable:

```
 signIn / signUp / requestPasswordReset / changeOwnPassword   (actions.ts)
        │  (after Zod parse, before the Supabase auth call)
        ▼
 checkRateLimit({ endpoint, dimensions, ... })   ← src/lib/rate-limit/auth-rate-limit.ts
        │  builds opaque bucket keys, resolves per-endpoint config
        ▼
 typedRpc(serviceClient, "check_rate_limit", { p_key, p_limit, p_window_seconds })
        │
        ▼
 public.check_rate_limit(...)  SECURITY DEFINER  ← migration
        │  atomic fixed-window increment on
        ▼
 public.auth_rate_limits  (bucket_key pk, count, window_start)   ← migration
```

#### Unit 1 — DB counter (migration)

- **Table `public.auth_rate_limits`**
  - `bucket_key text primary key` — opaque, PII-free (see §5).
  - `count integer not null`
  - `window_start timestamptz not null default now()`
  - No `org_id`, no RLS policies that allow client access — the table is
    **service-role-only**; `anon`/`authenticated` get no grants. (RLS enabled
    with no permissive policy = default-deny for the anon/auth roles, matching
    the repo's default-deny posture.)
- **Function `public.check_rate_limit(p_key text, p_limit int, p_window_seconds int)`**
  - `language plpgsql`, `security definer`, `set search_path = ''`.
  - **Fixed-window** algorithm (simplest correct + trivially testable):
    - Upsert the row for `p_key`. If the existing `window_start` is older than
      `p_window_seconds`, reset `count = 1, window_start = now()`; else
      `count = count + 1`.
    - `allowed := count <= p_limit`.
    - `retry_after := allowed ? 0 : ceil(window_start + interval - now())` seconds.
  - Returns a composite `(allowed boolean, retry_after integer, remaining integer)`.
  - **Opportunistic prune:** delete rows whose window expired for _this key_ on
    write; a scheduled bulk prune of all-expired rows is a documented follow-up
    (not required — the table stays tiny at auth volume).
  - **Grants:** `revoke execute ... from public, anon, authenticated;` — the
    function is invoked only through the service client. This deliberately
    sidesteps the "anon-callable RPC touching a shared table" concern in option
    A; nothing is reachable from the browser or PostgREST.
- Regenerate `src/types/database.types.ts` via `pnpm db:types` in the same PR.

Fixed-window is chosen over sliding-window on purpose: it's a single-row atomic
upsert, deterministic to unit-test, and the small burst-at-boundary imprecision
is irrelevant for auth throttling. **Lockout vs. backoff:** we use a
**window+cooldown** (return `retry_after`, no escalating lockout) — no account
lock state, so there is no new "account is locked" enumeration signal and no
persistent lockout to grief a victim with.

#### Unit 2 — Limiter helper (`src/lib/rate-limit/auth-rate-limit.ts`)

Pure, dependency-light TypeScript. Exposes:

- `getClientIp(): Promise<string>` — reads the client IP from request headers
  via `headers()`. On Vercel the platform sets a trusted client-IP header;
  the implementer **must verify the exact header against Vercel docs** (candidates:
  the first entry of `x-forwarded-for`, or `x-real-ip`). Falls back to a
  constant sentinel (`"unknown"`) when absent so the limiter still functions
  locally / in tests. **Verify-in-impl**, do not assume training-data behavior
  (this is Next 16 on Fluid Compute).
- `hashIdentifier(value: string): string` — `sha256` hex (via `node:crypto`) of
  the **normalized** identifier (see §5), so the DB stores no plaintext PII.
- `RATE_LIMITS` — a typed config map of per-endpoint limits (§4), each entry a
  list of `{ dimension, limit, windowSeconds }` rules.
- `checkRateLimit(input): Promise<RateLimitDecision>` where
  `RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }`.
  Builds one opaque bucket key per configured dimension, calls the RPC through
  `createServiceClient()` + `typedRpc` for each, and returns the **most
  restrictive** result (first `allowed:false` wins, carrying its `retry_after`).
- **Fail-open** (§7): any thrown/error from the RPC path is caught, logged
  loudly, and treated as `{ allowed: true }`.

This module owns _all_ limiter policy; the actions stay a thin call site.

#### Unit 3 — Action wiring (`src/app/auth/actions.ts`)

For each of the four actions, immediately **after** the Zod `safeParse` and
**before** the Supabase auth call, insert:

```
const gate = await checkRateLimit({ endpoint: "signIn", email: parsed.data.email });
if (!gate.allowed) return throttleResult("signIn", gate.retryAfterSeconds);
```

`throttleResult(endpoint, retryAfterSeconds)` returns an `AuthState` whose
`error` is a **generic, enumeration-safe** throttle message (§6). The same
helper is used everywhere so the four call sites stay one line each.

## 4. Per-endpoint limits (defaults)

Dimensions: **IP** = hashed client IP; **IP+email** = hashed `ip|email`;
**email** = hashed normalized email; **user** = the authenticated `user.id`.
All values are conservative starting defaults, tunable later via optional env
overrides (§8) without a redeploy of logic.

| Endpoint               | Rule(s)                                                | Rationale                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signIn`               | (a) **IP+email**: 5 / 15 min · (b) **IP**: 20 / 15 min | (a) blunts brute-force on one account from one host; (b) blunts spraying across accounts from one host. Deliberately **no global per-email cap** by default — see open question.                                 |
| `signUp`               | **IP**: 5 / hour                                       | blunts org/account spam without letting an attacker lock a victim's email out of signing up (per-email keying would enable that griefing).                                                                       |
| `requestPasswordReset` | (a) **IP**: 5 / hour · (b) **email**: 3 / hour         | (a) caps a single host; (b) caps inbox spam to one victim. Per-email here is safe griefing-wise (worst case a victim can't _request their own reset_ for an hour, and GoTrue's email limit already bounds this). |
| `changeOwnPassword`    | **user**: 10 / hour                                    | low-risk (needs a live session); a modest cap prevents pathological loops.                                                                                                                                       |

Each rule is an independent bucket; an action is throttled if **any** of its
rules trips. "Most restrictive wins" is enforced in `checkRateLimit`.

## 5. Key construction & PII

Bucket key format: `"{endpoint}:{dimension}:{hash}"`, e.g.
`"signIn:ip_email:9f86d0…"`. Construction rules:

- **Email is normalized** before hashing: `trim().toLowerCase()`. (Note: we do
  _not_ attempt provider-specific canonicalization like Gmail dot/plus
  stripping — out of scope; the email as submitted, lowercased, is the key.)
- **Hash everything identifying** with `sha256` — the table holds no plaintext
  email and no raw IP, so a DB leak reveals nothing about who was rate-limited.
- The **IP+email** dimension hashes the concatenation `"{ip}|{email}"` so it's a
  distinct bucket from either alone.
- The `endpoint` and `dimension` prefixes namespace the buckets so limits never
  collide across actions.

## 6. Error UX & anti-enumeration (critical)

**Claim:** surfacing a throttle error on _all four_ endpoints is
enumeration-safe. **Why:** a throttle response is keyed on **request volume**,
which the attacker already knows (they generated it) — it reveals nothing about
whether an account exists. So we do **not** need to fake the "success" outcome
for `signUp`/`requestPasswordReset`; we surface a generic throttle banner, which
is better UX (the user learns to slow down) and leaks nothing.

Concretely, on a throttle:

- **Message is generic and identical** regardless of account existence, e.g.
  _"Too many attempts. Please try again in about N minute(s)."_ (N derived from
  `retryAfterSeconds`, rounded up).
- The message is **the same string** whether the submitted email exists or not,
  for every endpoint. It never contains the email, the account state, or which
  rule tripped.
- The existing contracts are **strictly preserved**: when _not_ throttled,
  `signUp` still returns `{ success: "check-email" }` for both fresh and
  duplicate signups, and `requestPasswordReset` still always returns
  `{ success: "reset-email-sent" }`. The gate is a pre-check that either lets
  the request through unchanged or returns the generic throttle error — it never
  branches on account existence.
- Consumers already render `state.error` in a `role="alert"` banner
  (`src/components/auth/auth-form.tsx`, `change-password-form.tsx`,
  `forgot-password-form.tsx`), so **no component change is required** — the
  throttle message flows through the existing `AuthState.error` path.

## 7. Fail-open, observability, correctness

- **Fail-open:** if the counter RPC errors (DB unreachable, migration missing,
  types drift), `checkRateLimit` logs a loud structured error and **allows** the
  request. Availability beats perfect throttling for a login page, and GoTrue's
  project-level limit is still a backstop. This is an explicit, documented
  choice — the failure is logged, never silent.
- **Observability:** on every _throttle decision_ (not every request), emit one
  structured `console.warn` line — `{ event: "auth_rate_limited", endpoint,
dimension, keyPrefix: hash.slice(0,8), retryAfterSeconds }` — so an attack is
  visible in Vercel function logs and greppable. No PII in the log (hash prefix
  only). A durable audit table is a documented follow-up if log retention proves
  insufficient.
- **Clock/atomicity:** the window math lives entirely inside the DEFINER
  function using `now()` (one clock, one atomic statement per key), so
  concurrent requests can't race the counter.

## 8. Config & env

- Per-endpoint limits live as typed constants in the limiter module (§4).
- Optional tuning override: a single optional env var (e.g.
  `AUTH_RATE_LIMIT_MULTIPLIER`, or per-rule overrides) added to
  `src/lib/env.server.ts` as **optional** (feature works with it absent, exactly
  like the existing `DIGEST_*` optionals). Absent → compiled defaults. This lets
  ops loosen/tighten without a logic redeploy. Kept minimal — one multiplier —
  unless review wants per-rule vars.
- **No required new env var**, no new vendor, no new secret.

## 9. Performance & data-fetching budget (working agreement #5)

Auth actions are **not** a hot path and have no in-page view/tab/filter
surface, so the RSC-refetch budget is trivially satisfied. Specifics:

- **First paint / interaction:** unchanged. The limiter runs only inside the
  server action on submit — zero added client round-trips, zero added RSC
  re-renders. No `<Link>`/router navigation involved.
- **Added server work per auth submit:** 1–2 `check_rate_limit` RPC calls (one
  per configured dimension), each a single-row atomic upsert on a
  **primary-key-indexed** `bucket_key` — bounded, `O(1)`, no `select *`, no scan
  of a growing table. At auth volume this is negligible next to the GoTrue
  network call that already dominates the action.
- **Table growth is bounded** by opportunistic prune + tiny row size; the read
  is always a PK point-lookup, never a range scan.

## 10. Independent units (for the plan's execution DAG)

1. **DB migration + types** — `auth_rate_limits` table + `check_rate_limit`
   DEFINER RPC + `pnpm db:types`. _No app-code dependency._
2. **Limiter helper module** — `src/lib/rate-limit/auth-rate-limit.ts`
   (`getClientIp`, `hashIdentifier`, `RATE_LIMITS`, `checkRateLimit`,
   `throttleResult`). _Depends on Unit 1's regenerated types for the typed RPC
   call._
3. **Action wiring + anti-enumeration tests** — insert the four gate call sites
   in `actions.ts`; extend `actions.test.ts`. _Depends on Unit 2._
4. **DB-level integration test** — exercise `check_rate_limit` against DEV in a
   rolled-back transaction (windowing, reset, retry*after). \_Depends on Unit 1.*

Units 1 is the root; 2 and 4 depend on 1; 3 depends on 2. See the plan's
Execution DAG for batching.

## 11. Testing strategy

- **Unit (Vitest, mocked):** `checkRateLimit` returns allow/deny correctly given
  a mocked RPC; most-restrictive-wins; fail-open on RPC error; `hashIdentifier`
  is stable + normalized; `getClientIp` parses headers and falls back.
- **Action tests (extend `actions.test.ts`):** mock `checkRateLimit`; assert
  each action short-circuits with the **generic** throttle error when denied and
  **never calls Supabase**; assert the throttle message is byte-identical across
  existent/nonexistent emails (anti-enumeration); assert `signUp` /
  `requestPasswordReset` still return their success shapes when allowed.
- **DB integration (opt-in, DEV, rolled-back txn — matches repo `PULSE_TEST_DB`
  gating):** call `check_rate_limit` N+1 times, assert the (N+1)th denies with a
  positive `retry_after`; assert a window reset after advancing past the window;
  assert the RPC is **not** executable by `anon`/`authenticated`.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## 12. Open question for the owner

**`signIn` global per-email cap — include it or not?** A global per-email limit
(independent of IP) is the only thing that blunts a **distributed** botnet
rotating IPs against a single account. But it introduces a **griefing vector**:
an attacker can deliberately trip a victim's cap to lock the victim out of
logging in for the window. The default in §4 **omits** it (per-IP + per-(IP+email)
only), accepting that distributed stuffing on one account is bounded only by
GoTrue's project limit. Alternatives if the owner wants distributed coverage:
(a) add a generous global per-email cap with a short window (say 30 / 15 min) —
partial coverage, small griefing surface; (b) defer entirely to a Vercel WAF /
BotID rule at the edge. **Recommend (a)** as a low-risk middle ground, but this
is a genuine product/security trade-off the owner should confirm before build.

_All other open points resolved with defaults above._
