# Rate-limit `/api/oauth/register` — Design Spec

- **Date:** 2026-07-25
- **Status:** Draft — awaiting review
- **Origin:** MCP-server follow-up owed in `vault/00-north-star.md` ("`/api/oauth/register` has no
  rate limit"), from [[2026-07-25-1056-settings-redesign-mcp-guide]]
- **Surface:** `src/app/api/oauth/register/route.ts`, `src/lib/rate-limit/auth-rate-limit.ts`
- **Predecessor specs:** `2026-07-15-auth-rate-limiting-design.md` (the limiter this reuses),
  `2026-07-24-mcp-server-design.md` (the OAuth server this protects)

## 1. Problem

`POST /api/oauth/register` implements RFC 7591 dynamic client registration for the MCP server. It
is **unauthenticated by design** — an MCP client (Claude Desktop, Claude Code, a claude.ai custom
connector) self-registers on first connect so the user never has to hand-register an app. The
current handler is 33 lines: parse body → Zod → `registerOauthClient()` → `201`. There is **no
throttling of any kind**.

Consequences today:

- **Unbounded anonymous writes.** Every accepted request inserts a row into `public.oauth_clients`
  (`randomUUID()` client_id, attacker-supplied `client_name` up to 200 chars and up to 10 redirect
  URIs). A trivial loop grows that table without limit — storage abuse and DB cost, from an
  unauthenticated caller.
- **It is the only unmetered endpoint left on the OAuth/MCP surface.** `/api/mcp` is already
  per-token limited (`src/lib/rate-limit/mcp-rate-limit.ts`), and `/api/oauth/{authorize,token}`
  are both gated by possession of a `client_id` that only `register` can mint — so `register` is
  the front door and the only path that admits new state anonymously.
- **It is publicly advertised.** `src/app/.well-known/oauth-authorization-server/route.ts`
  publishes `registration_endpoint`, so discovery is automatic for anyone, not just legitimate
  clients.

### Goals

1. Bound the rate at which anonymous callers can create `oauth_clients` rows — including from a
   caller that rotates source IPs.
2. Do not break legitimate first-time connects from Claude Desktop / Claude Code / claude.ai.
3. Respond in a shape a conforming OAuth 2.1 / MCP client understands well enough to retry.
4. **Zero new infrastructure, zero new migration, zero new env vars, no third rate-limit module.**

### Non-goals (YAGNI)

- **No redirect-URI allowlisting / client attestation.** Dynamic registration is _meant_ to be
  open (that is the whole point of RFC 7591 in the MCP flow); restricting who may register is a
  different, product-level decision.
- **No CAPTCHA, proof-of-work, or software statements** (RFC 7591 §2.3).
- **No registration-record pruning/GC** for `oauth_clients` (unreferenced-client cleanup is a
  separate follow-up; this spec bounds the _inflow_).
- **No edge/WAF-layer throttling.** A Vercel Firewall rule would be a good complementary control
  but is ops config, not this deliverable.
- **No change to `/api/oauth/authorize` or `/api/oauth/token`.** They are reachable only with an
  already-registered `client_id`, so bounding registration bounds them transitively.

## 2. Real footprint (grounded in code)

| File                                                      | Current state                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/oauth/register/route.ts`                     | 33-line `POST`. `req.json()` → `registerClientSchema.safeParse` → 400 `invalid_client_metadata` on failure → `registerOauthClient()` → 201. No gate.                                                                                               |
| `src/lib/rate-limit/auth-rate-limit.ts`                   | Canonical limiter. Exports `RATE_LIMITS` (`Record<Endpoint, Rule[]>`, closed `Endpoint` union), `checkRateLimit`, `getClientIp`, `hashIdentifier`, `throttleResult`, `RateLimitDecision`. Fails OPEN.                                              |
| `src/lib/rate-limit/mcp-rate-limit.ts`                    | Second, single-rule limiter for `/api/mcp` (per-token, 120/60 s). Fails OPEN. Imports `RateLimitDecision` from the module above.                                                                                                                   |
| `supabase/migrations/20260715151219_auth_rate_limits.sql` | `public.auth_rate_limits (bucket_key pk, count, window_start)`, RLS on with **zero** policies, plus `public.check_rate_limit(p_key text, p_limit int, p_window_seconds int)` SECURITY DEFINER, `execute` revoked from `public/anon/authenticated`. |
| `src/types/database.types.ts`                             | Already contains `check_rate_limit` under `Functions` (args + `{allowed, retry_after, remaining}[]`), so `typedRpc` is fully typed today.                                                                                                          |
| `supabase/migrations/20260724133321_mcp_oauth.sql`        | `oauth_clients (id, client_id unique, client_name, redirect_uris, created_at)`, RLS on, zero policies, service-role only.                                                                                                                          |

**Migration verdict: none needed.** `check_rate_limit` is keyed on an _arbitrary opaque bucket
key_ and takes limit + window as arguments — it is already a general-purpose fixed-window counter,
not an auth-specific one. Its name (`check_rate_limit`, not `check_auth_rate_limit`) and the
`mcp-rate-limit.ts` precedent both confirm the intent. The types are already generated. So this
change is **application code only**: no `scripts/new-migration.sh`, no `supabase-dev` MCP apply, no
`pnpm db:types`, no ledger reconcile.

## 3. Approach — extend the canonical limiter (chosen)

Three options were considered.

- **(A) Extend `auth-rate-limit.ts` with an `"oauthRegister"` endpoint — CHOSEN.** Add the entry
  to `RATE_LIMITS`, add one new `Dimension`, and add a per-endpoint fail-mode policy. The route
  calls `checkRateLimit({ endpoint: "oauthRegister" })` and renders its own OAuth-shaped 429.
  Smallest diff, one limiter of record, reuses `getClientIp`/`hashIdentifier`/the multiplier
  ops lever for free.
- **(B) A new `oauth-register-rate-limit.ts` module modelled on `mcp-rate-limit.ts`.** Rejected:
  AGENTS.md is explicit — _reuse canonical modules, grep before writing a helper._ A third
  limiter module would triple the places a limit policy can hide, and this endpoint needs _two_
  rules (see §4), which is exactly the multi-rule evaluation `checkRateLimit` already implements
  and `mcp-rate-limit.ts` does not.
- **(C) Inline the `typedRpc(check_rate_limit)` call in the route handler.** Rejected: puts
  security policy in a route file, untestable without a request scope, and duplicates the
  fail-mode and logging logic.

The `Endpoint` union being closed is the feature here, not an obstacle: adding `"oauthRegister"`
makes `RATE_LIMITS` exhaustively typed against it, so the compiler refuses a missing rule set.

### Naming note

`auth-rate-limit.ts` now covers a non-`/auth` endpoint. Renaming the file would touch every
importer for no behavior change; instead the module doc comment is widened to state that it is the
**app-level limiter of record** (auth actions + the OAuth registration endpoint), and the
`AUTH_RATE_LIMIT_MULTIPLIER` doc comment in `src/lib/env.server.ts` is widened from "auth rate
limits" to "app-level rate limits". The env var name itself is unchanged (renaming it would be a
breaking ops change for a cosmetic gain).

## 4. Limits, windows, and bucket keys

### Who actually calls this endpoint

This is the load-bearing input, and it is asymmetric across clients:

- **Claude Desktop / Claude Code** register from the **end user's own machine** — a residential or
  office IP. One registration per connector install; 2–3 if the user retries a failed setup.
- **claude.ai custom connectors** perform discovery + registration from **claude.ai's backend**,
  not the user's browser. The source IP is therefore a **shared Anthropic egress address for every
  claude.ai user who connects to this deployment**. A per-IP bucket collapses that entire channel
  into one bucket.

Two consequences: (a) the per-IP cap must have real headroom, and (b) its **window must be short**,
so an egress IP that briefly overshoots recovers in minutes rather than being locked out for an
hour. A tight/long per-IP rule is the single most likely way to break legitimate onboarding.

Meanwhile IP is a weak identity: NAT hides many hosts behind one address, and IPv6 /64 rotation
plus commodity proxies make per-IP limits cheap to evade. Per-IP alone therefore cannot bound
table growth. Nothing else on this request is a trustworthy identity — the body is entirely
attacker-controlled (`client_name`, `redirect_uris`) and there is no session, token, or account.
So the only remaining dimension that actually bounds the damage is a **global ceiling**.

### Chosen rules

```ts
oauthRegister: [
  { dimension: "ip",     limit: 10,  windowSeconds: 10 * MINUTE },
  { dimension: "global", limit: 200, windowSeconds: HOUR },
],
```

| Rule                   | Bucket key                      | Rationale                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`ip` — 10 / 10 min** | `oauthRegister:ip:<sha256(ip)>` | Burst control against a single host. A legitimate client needs **1**; 10 gives 10× headroom for retries and for several concurrent setups behind one NAT or the claude.ai egress. The **10-minute** window is deliberate: a squeezed shared egress IP self-heals within 10 min. Sustained ceiling is 60/h/IP — still bounds one host to ~1.4k rows/day worst case. |
| **`global` — 200 / h** | `oauthRegister:global`          | The only rule an IP-rotating attacker cannot evade, and therefore the actual bound on `oauth_clients` growth: **≤ 4,800 rows/day** worst case instead of unbounded. Kept generous — realistic legitimate volume for this deployment is single digits per day, so 200/h is ~2 orders of magnitude of headroom, which minimizes the griefing surface (see below).    |

The bucket-key format reuses the existing `${endpoint}:${dimension}:${identifier}` scheme, so
`oauthRegister` keys can never collide with `signIn:ip:…` even for the same IP. The `ip` value is
sha256-hashed, preserving the migration's stated privacy property (**no plaintext IP at rest**).
The `global` key carries no identifier — there is nothing to protect — so it stays literal
(`oauthRegister:global`), which also makes it inspectable and manually resettable in an incident.

**Rule order is `ip` then `global`, and it matters.** `checkRateLimit` returns on the first denial,
so a single-host flood costs **one** RPC (the `ip` rule denies and `global` is never evaluated),
while normal traffic and a distributed flood cost two.

### Why a global rule is safe here (two non-obvious properties)

1. **A flood cannot extend the lockout.** In `check_rate_limit`, `window_start` is only reset when
   the window has already _expired_; a denied call increments `count` but leaves `window_start`
   alone. So the global bucket unblocks on schedule after ≤1 hour regardless of how hard it is
   hammered — it is a fixed window, not a sliding lockout that an attacker can hold open forever.
   This is what makes a global dimension acceptable rather than a self-inflicted DoS.
2. **Griefing is bounded and strictly better than the status quo.** An attacker can deliberately
   burn the global bucket to block legitimate first-time connects for the remainder of the hour.
   That is a real cost, accepted knowingly: a blocked registration is a retryable, self-healing,
   ≤1-hour delay on _new connector setup only_ — existing connections are untouched — whereas an
   unbounded table is permanent. The 200/h ceiling and the `AUTH_RATE_LIMIT_MULTIPLIER` escape
   hatch (below) are the mitigations.

### Ops lever

`checkRateLimit` already multiplies every compiled limit by the optional
`AUTH_RATE_LIMIT_MULTIPLIER` env var. `oauthRegister` inherits this **intentionally**: if a
legitimate claude.ai egress IP or a large customer ever gets squeezed, the caps can be raised (or
effectively disabled in e2e) without shipping new numbers. No new env var is introduced.

## 5. Fail mode — this endpoint fails **CLOSED**

Both existing limiters fail **open** (an RPC error allows the request). `oauthRegister` diverges
and **denies** when the limiter itself is unavailable.

**Why fail-closed here:**

1. **The blast radius is small and does not cascade.** A limiter outage blocks only the creation of
   _new_ MCP client registrations. Every already-registered client keeps working —
   `/api/oauth/authorize`, `/api/oauth/token`, and `/api/mcp` are untouched, no signed-in user
   loses access, no tool call breaks. Contrast the endpoints that correctly fail open: fail-open on
   `signIn` means everyone can still log in; fail-open on `/api/mcp` means live agents keep
   working. Fail-closed on `register` means "the _Connect_ button needs another click".
2. **Fail-open on this endpoint reinstates the exact vulnerability being fixed.** The asset under
   protection is an _unbounded write by an unauthenticated caller_. A fail-open limiter converts
   any limiter fault directly into unmetered anonymous registration — silently.
3. **The failure mode that matters is limiter-only breakage, and this repo has shipped it.** The
   common objection is "if Postgres is down, the `oauth_clients` INSERT fails anyway, so fail-open
   admits nothing." True — and irrelevant. The dangerous mode is one where _only_ the limiter is
   broken: `check_rate_limit` missing or its `execute` grant revoked after a migration drift (see
   [[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]] — a DEV-applied migration
   with no committed file is precisely this class), or lock/bloat trouble confined to
   `auth_rate_limits`. In that mode fail-open is silently unlimited; fail-closed makes the drift
   loud on the first request.
4. **The retry semantics are honest.** A first-time connect is a human-initiated, retryable action,
   and the response carries `Retry-After`. There is no background hot path to starve.
5. **It closes the counter-overflow edge.** A sufficiently absurd flood would eventually overflow
   `count` (`integer`) and make the RPC raise. Under fail-open that fault _admits_ traffic; under
   fail-closed it denies.

**Scoping is mandatory.** The divergence is **per-endpoint**, expressed as an explicit policy set
inside `auth-rate-limit.ts` — not a change to the module's default. Everything not listed keeps
fail-open, and a regression test asserts `signIn` still fails open on an RPC error.

On limiter unavailability the decision is `{ allowed: false, retryAfterSeconds: 60 }` — a fixed
conservative 60 s, since no real window information exists — and the event is logged at `error`
level with a distinct `fail-closed: limiter unavailable` tag so an operator can tell a limiter
outage apart from an actual flood in Vercel logs.

**Rejected alternative:** adding a `reason: "limit" | "unavailable"` discriminator to the denied
variant of `RateLimitDecision`. It would be honest typing, but the route's behavior is identical in
both cases (429 + `Retry-After`), the observability need is already met by the distinct log tag
inside the limiter, and the change would ripple into `mcp-rate-limit.ts` plus three existing
`toEqual` assertions for zero behavior gain. `RateLimitDecision` stays exactly as it is.

## 6. HTTP response for a throttled request

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 47
Cache-Control: no-store
Content-Type: application/json

{
  "error": "temporarily_unavailable",
  "error_description": "Too many registration requests. Please retry in 47 seconds."
}
```

Element-by-element justification:

- **`429`, not `400`.** RFC 7591 §3.2.2 defines the _registration error_ response as an HTTP **400**
  carrying an OAuth-style JSON body, with a closed code set — `invalid_redirect_uri`,
  `invalid_client_metadata`, `invalid_software_statement`, `unapproved_software_statement`. None
  describes throttling, and the submitted metadata **is** valid. Returning 400 /
  `invalid_client_metadata` would tell the client to fix metadata it cannot fix — and would collide
  with the route's existing, correct use of that code for its real case. Throttling is a transport
  condition, so it takes the HTTP-registered signal: **429** (RFC 6585 §4).
- **`Retry-After`.** The header generic HTTP clients and MCP client retry logic actually key on;
  RFC 6585 §4 explicitly pairs it with 429. Value = `retryAfterSeconds` from the limiter decision
  (delta-seconds form).
- **The OAuth JSON envelope is kept.** RFC 7591 §3.2.2 responses are `{error, error_description}`,
  and every other error in `src/app/api/oauth/*` uses that shape (`invalid_request`,
  `invalid_grant`, `invalid_client_metadata`). A client that parses the body on a non-2xx gets
  something structured rather than a parse failure.
- **`temporarily_unavailable`.** The only **registered** OAuth 2.0 error code (RFC 6749) that fits:
  "the authorization server is currently unable to handle the request due to a temporary
  overloading or maintenance". Semantically exact, and it signals _retryable_ rather than
  _malformed_. (`slow_down` was considered and rejected — RFC 8628 scopes it to the device
  authorization grant.)
- **`Cache-Control: no-store`.** Prevents any intermediary from caching a transient throttle and
  turning it into a sticky failure for a later legitimate connect.
- **The response is identical whichever rule fired.** No indication of `ip` vs `global`, no
  `remaining` count. This mirrors `throttleResult`'s enumeration-safe stance: an attacker must not
  be able to probe how close the global ceiling is, or which dimension is binding.
- **`throttleResult()` is deliberately NOT reused.** It returns `AuthState` (`{ error: string }`) —
  the React form-state shape for the auth UI, not an HTTP OAuth error body. The 429 is built by a
  small local `throttled()` helper in the route file. It has exactly one call site, so per YAGNI it
  stays local; it graduates to a shared `src/lib/mcp/oauth/` helper the day a second `/api/oauth/*`
  endpoint needs it.

## 7. Gate placement — before the body is read

```ts
export async function POST(req: Request) {
  const gate = await checkRateLimit({ endpoint: "oauthRegister" });
  if (!gate.allowed) return throttled(gate.retryAfterSeconds);
  // …existing body parse → Zod → registerOauthClient → 201, unchanged
}
```

The gate runs **first**, before `req.json()`. This deliberately differs from
`src/app/auth/actions.ts`, where the gate sits _after_ the Zod parse — there the parse produces the
`email` the gate needs as a dimension. Here no dimension comes from the body, and:

- a flood of malformed bodies is still a flood, and must be counted;
- the limiter sees 100% of requests, so the count matches reality;
- a throttled request never pays for JSON parsing.

`checkRateLimit` resolves the IP via `getClientIp()`, which reads `next/headers` — available in a
Route Handler request scope, and already the trusted-leftmost-`x-forwarded-for` logic used by the
auth gates. Nothing else in the route changes: the 201 body, the 400 path, and
`registerOauthClient` are untouched.

## 8. Performance & data-fetching budget (working agreement #5)

- **(a) First paint vs. interaction — N/A, stated explicitly.** This is a machine-to-machine JSON
  endpoint, not a UI. There are no views, tabs, filters, or sorts, hence no in-page toggles and no
  RSC navigation to avoid. The "0 new server round-trips on interaction" clause has no subject
  here.
- **(b) Does the interaction change server data?** Yes — registration is a write, and it already
  runs in a `POST` Route Handler (the OAuth-spec-mandated shape; MCP clients call it directly, so a
  Server Action is not an option). The limiter adds a second write (the counter upsert). Neither
  participates in RSC caching and there is nothing to revalidate — no page reads `oauth_clients`.
- **(c) Is the hot-path read bounded over indexed columns?** Yes, trivially. Each rule is one
  `insert … on conflict (bucket_key) do update` against `auth_rate_limits`, whose **primary key
  is** `bucket_key` — a single-row, index-only O(1) upsert. No `select *`, no scan, no unbounded
  read on a growing table.
- **Added cost per request:** 1 RPC when the `ip` rule denies (short-circuit), 2 otherwise. This is
  a **cold path** — once per connector install — on a request that already performs a DB INSERT
  plus a client network round-trip, so the relative overhead is negligible. It is not on any
  user-facing render path.
- **`auth_rate_limits` row growth:** bounded by (distinct client IPs in a 10-minute window) + 1
  global row, at ~100 bytes each. The migration already documents bulk pruning of expired rows as a
  follow-up; this change does not materially worsen it, and the rows it adds are what prevent the
  far larger `oauth_clients` growth.
- **Known cost of the global rule — single-row contention.** Every registration request upserts the
  _same_ `bucket_key`, so concurrent requests serialize on one row lock. Accepted: Postgres
  single-row upsert throughput (thousands/s) is orders of magnitude above the 200/h cap, so the
  lock is never the bottleneck for legitimate traffic, and under a flood the serialization is
  desirable — it is admission control on a low-volume endpoint.

## 9. Testing (working agreement #4 — TDD)

All unit tests; **no new integration test.** The `check_rate_limit` RPC's windowing, grants, and
DB-level behavior are already covered by `src/lib/rate-limit/auth-rate-limit.integration.test.ts`,
and this change adds no SQL. Existing tests must keep passing unchanged — `RateLimitDecision` and
both existing fail-open behaviors are untouched.

**`src/lib/rate-limit/auth-rate-limit.test.ts` (extend; the file already mocks
`createServiceClient: () => ({ rpc })` and `next/headers`):**

1. `RATE_LIMITS.oauthRegister` contains both an `ip` rule (10 / 600 s) and a `global` rule
   (200 / 3600 s) — guards against the global backstop being silently dropped.
2. Both rules are evaluated in order with the expected `p_key`s: `oauthRegister:ip:<64 hex>` then
   the literal `oauthRegister:global`, with the matching `p_limit` / `p_window_seconds`.
3. Allows when both rules are under cap.
4. Denies with the RPC's `retry_after` when the **`ip`** rule trips, **and** asserts the second RPC
   was never issued (short-circuit).
5. Denies when **only** the `global` rule trips (first call allowed, second denied) — proves the
   global rule is actually wired, mirroring the existing `signIn` per-email-cap test.
6. **Fails CLOSED** for `oauthRegister` on an RPC `error` → `{ allowed: false, retryAfterSeconds: 60 }`.
7. **Fails CLOSED** for `oauthRegister` on an RPC throw/rejection → same.
8. **Regression: `signIn` still fails OPEN** on an RPC error — proves the divergence is
   endpoint-scoped, not a module-wide default flip.
9. `AUTH_RATE_LIMIT_MULTIPLIER` scales the `oauthRegister` caps (e.g. `2` → `p_limit` 20 / 400).
10. The `ip` bucket key is hashed, not plaintext (no raw IP substring in `p_key`).

**`src/app/api/oauth/register/route.test.ts` (new; follows the `src/app/api/ai/embed/route.test.ts`
pattern — mock the collaborators, construct a real `Request`, call the exported `POST`):**

Mocks `@/lib/rate-limit/auth-rate-limit` (`checkRateLimit`) and `@/lib/mcp/oauth/client-store`
(`registerOauthClient`). The limiter is mocked wholesale rather than at the RPC level because
`getClientIp()` needs a `next/headers` request scope that a route unit test has no business
faking — the RPC-level behavior is already covered above.

1. Allowed → **201** with the existing body (`client_id`, `client_name`, `redirect_uris`,
   `token_endpoint_auth_method: "none"`, `grant_types`, `response_types`) — happy-path regression.
2. Throttled → **429**, `Retry-After: <n>`, body exactly
   `{ error: "temporarily_unavailable", error_description: <string containing n> }`.
3. Throttled → `registerOauthClient` was **never called** — the load-bearing assertion: no row is
   written.
4. Throttled → `Cache-Control: no-store` is set.
5. **Gate ordering:** a request with an unparseable body while throttled returns **429**, not 400 —
   proves the gate precedes the parse.
6. Allowed + invalid metadata → still **400** `invalid_client_metadata` — regression.
7. `checkRateLimit` is called exactly once, with exactly `{ endpoint: "oauthRegister" }`.
8. The throttle body leaks no dimension: no `remaining`, no `ip`/`global` mention.

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## 10. Independent units (for the plan's execution DAG)

- **Unit 1 — limiter policy.** `src/lib/rate-limit/auth-rate-limit.ts` + its test: the new
  `Endpoint`, the new `global` `Dimension` and its `bucketKey` case, `RATE_LIMITS.oauthRegister`,
  and the fail-closed policy set. Produces `checkRateLimit({ endpoint: "oauthRegister" })`.
- **Unit 2 — route gate.** `src/app/api/oauth/register/route.ts` + a new route test. **Consumes**
  Unit 1's `"oauthRegister"` endpoint (it will not typecheck before Unit 1 lands), so this is a
  genuine sequential edge, not an artificial one.
- **Unit 3 — doc-comment widening.** The `AUTH_RATE_LIMIT_MULTIPLIER` comment in
  `src/lib/env.server.ts`. Independent of both — different file, no shared state, safe to run
  concurrently with Unit 1.

This is a small change and the DAG is honestly shallow (depth 2). Padding it into more "parallel"
tasks would be theatre; the plan states the real graph.

## 11. Risks

- **A tighter-than-expected legitimate pattern.** If claude.ai's egress ever registers on behalf of
  many users in one burst, the 10 / 10 min per-IP rule could bite. Mitigations, in order:
  `AUTH_RATE_LIMIT_MULTIPLIER` (no deploy), then raising the compiled `ip` limit. The 10-minute
  window keeps any such incident short and self-healing. Detection: the existing
  `[auth-rate-limit] throttled` warn log carries the endpoint and dimension.
- **Global-bucket griefing.** Accepted and analysed in §4; bounded to ≤1 hour, affects new
  registrations only.
- **Fail-closed masking a drift as "traffic".** Mitigated by the distinct `fail-closed: limiter
unavailable` error-level log tag (§5), which is what an operator greps for.
- **Nothing diffs `list_migrations` against `supabase/migrations/`** (a known standing follow-up).
  Not triggered here — this change ships no SQL — but it is why §5's fail-closed argument leans on
  drift being a real, observed failure mode in this repo.

## 12. How to test (manual walkthrough)

Not user-observable in the Pulse UI — it is an HTTP-level control on a machine-to-machine endpoint
— so acceptance is a `curl` pass against a running dev server, plus a real connector smoke test.

1. Pull `develop` and start the app: `pnpm dev` (dev server on `http://localhost:3000`, pointed at
   the DEV Supabase project via `.env.local`).
2. **Happy path still works.** Run:

   ```bash
   curl -i -X POST http://localhost:3000/api/oauth/register \
     -H 'content-type: application/json' \
     -d '{"client_name":"Manual Test","redirect_uris":["https://example.com/cb"]}'
   ```

   **Expect:** `HTTP/1.1 201 Created` and a JSON body containing a fresh `client_id`,
   `"token_endpoint_auth_method":"none"`, and your `redirect_uris`.

3. **Trip the per-IP rule.** Run the same command 11 times in a row:

   ```bash
   for i in $(seq 1 11); do
     curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:3000/api/oauth/register \
       -H 'content-type: application/json' \
       -d '{"client_name":"Flood '"$i"'","redirect_uris":["https://example.com/cb"]}'
   done; echo
   ```

   **Expect:** `201 201 201 201 201 201 201 201 201 201 429` — the first ten succeed, the eleventh
   is throttled. (Requests from step 2 count toward the same bucket, so you may see the `429`
   arrive a request or two earlier.)

4. **Inspect the throttled response.** Repeat the single `curl -i` from step 2.
   **Expect:** `HTTP/1.1 429 Too Many Requests`, a `Retry-After:` header with a number of seconds
   (≤ 600), `Cache-Control: no-store`, and the body
   `{"error":"temporarily_unavailable","error_description":"Too many registration requests. …"}`.

5. **Confirm no row was written while throttled.** In the Supabase **DEV** SQL editor run
   `select count(*) from public.oauth_clients;` before and after two more throttled `curl`s.
   **Expect:** the count is unchanged by throttled requests.

6. **Confirm the window releases.** Wait 10 minutes (or, faster, run
   `delete from public.auth_rate_limits where bucket_key like 'oauthRegister:%';` in the DEV SQL
   editor) and repeat step 2. **Expect:** `201` again.

7. **Confirm existing connectors are unaffected.** With the `oauthRegister:ip` bucket still
   throttled, open Pulse → **Settings → MCP** and complete a tool call from an
   already-connected Claude client. **Expect:** it works normally — the limit gates registration
   only, never an established connection.

8. **Real client smoke test (once, after promote).** Add the Pulse MCP server as a fresh custom
   connector in Claude Desktop or claude.ai and complete the OAuth consent flow.
   **Expect:** first-time connect succeeds on the first attempt with no throttle — the headroom in
   §4 is doing its job.

9. **Cleanup.** In the DEV SQL editor:
   `delete from public.oauth_clients where client_name like 'Manual Test%' or client_name like 'Flood %';`
   (`oauth_codes` / `oauth_tokens` cascade.) Then
   `delete from public.auth_rate_limits where bucket_key like 'oauthRegister:%';`
