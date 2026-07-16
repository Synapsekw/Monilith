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
};

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
