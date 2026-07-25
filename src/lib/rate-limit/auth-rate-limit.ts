import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getServerEnv } from "@/lib/env.server";
import type { AuthState } from "@/app/auth/actions";

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

const MINUTE = 60;
const HOUR = 3600;

/** Per-endpoint limits. Conservative starting defaults. This module is the
 *  app-level limiter of record — the four auth server actions AND the public
 *  OAuth dynamic-registration endpoint. Rule ORDER matters: evaluation stops at
 *  the first denial, so put the cheapest/most-likely-to-trip rule first. */
export const RATE_LIMITS: Record<Endpoint, Rule[]> = {
  signIn: [
    { dimension: "ip_email", limit: 5, windowSeconds: 15 * MINUTE },
    { dimension: "ip", limit: 20, windowSeconds: 15 * MINUTE },
    // Global per-email cap (owner decision, spec §12 option a): a generous
    // short-window ceiling keyed on email alone, so a DISTRIBUTED botnet
    // rotating IPs against one account is still bounded. Kept generous (30 /
    // 15 min) to minimize the griefing surface — a real user retrying their own
    // password won't hit it, but an attack storm will.
    { dimension: "email", limit: 30, windowSeconds: 15 * MINUTE },
  ],
  signUp: [{ dimension: "ip", limit: 5, windowSeconds: HOUR }],
  requestPasswordReset: [
    { dimension: "ip", limit: 5, windowSeconds: HOUR },
    { dimension: "email", limit: 3, windowSeconds: HOUR },
  ],
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

/** sha256 hex of a normalized identifier — table stores no plaintext PII. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Best-effort client IP from request headers. On Vercel (Next.js 16 / Fluid
 * Compute) the platform sets the trusted client IP as the leftmost hop of
 * `x-forwarded-for`; we take that, falling back to `x-real-ip`, then to a
 * constant sentinel so the limiter still functions locally / in tests.
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
    case "global":
      // No identifier, so nothing to hash. Kept literal (not a digest) so the
      // bucket stays inspectable and manually resettable during an incident:
      //   delete from auth_rate_limits where bucket_key = 'oauthRegister:global';
      return `${endpoint}:global`;
  }
}

/**
 * Evaluate all rules for an endpoint; the most restrictive (first denial) wins.
 * Fails OPEN by default: an RPC error allows the request (availability >
 * perfect throttling for a login page; GoTrue's project limit still backstops).
 * Endpoints listed in FAIL_CLOSED invert that and DENY on limiter failure — see
 * that constant for why /api/oauth/register is one of them.
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
  }
  return { allowed: true };
}

/** Generic, enumeration-safe throttle response. Identical regardless of
 *  account existence; carries no email/account signal.
 *
 *  AuthState is the React form-state shape for the auth UI — it is NOT an HTTP
 *  body. HTTP endpoints (e.g. /api/oauth/register) must render their own OAuth
 *  error response (429 + Retry-After + {error, error_description}) instead. */
export function throttleResult(
  _endpoint: Endpoint,
  retryAfterSeconds: number,
): AuthState {
  const mins = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return {
    error: `Too many attempts. Please try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
  };
}
