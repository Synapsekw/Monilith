import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sign a `pg_net → service endpoint` request body with a shared secret.
 *
 * The automations engine fires an async model hop from in-DB plpgsql via
 * `net.http_post(<endpoint>, <signed body {job_id}>)`. The endpoint runs with
 * the service-role key, so the ONLY thing standing between an attacker and a
 * privileged write is proof the request came from our own database — that is
 * this HMAC. Returns a hex-encoded SHA-256 HMAC of `body`.
 */
export function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Verify a signature produced by {@link signBody}. Constant-time: the compare
 * uses `timingSafeEqual` so a caller cannot probe the expected signature byte
 * by byte via response-time differences. Returns false (never throws) on any
 * mismatch, including a length mismatch or a wrong secret.
 */
export function verifyBody(
  body: string,
  signature: string,
  secret: string,
): boolean {
  const expected = signBody(body, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * How far in the PAST a signed body's `ts` may be and still be accepted.
 *
 * The two clocks are different machines — Supabase Postgres signs, a Vercel
 * function verifies — but both derive from real time over NTP, so the true
 * clock drift between them is sub-second. The budget is therefore almost
 * entirely *delivery* latency, not drift: `net.http_post` only ENQUEUES the
 * request, and the pg_net background worker drains that queue on its own poll
 * interval, so a backlogged or briefly-restarted worker can post a body
 * seconds — occasionally tens of seconds — after it was signed. 300s gives
 * roughly two orders of magnitude of headroom over the observed case while
 * cutting the replay window from *unbounded* to five minutes.
 *
 * Erring long is deliberate: too tight fails the daily refresh CLOSED, and its
 * only symptom is a silently stale model catalog — the failure nobody notices
 * for weeks. Too loose leaves a bounded replay burst on a daily, idempotent
 * job. The asymmetry of those two costs is what picks 300 over 60.
 */
export const SIGNED_BODY_MAX_AGE_SECONDS = 300;

/**
 * How far in the FUTURE a signed body's `ts` may be. Deliberately tighter than
 * the past bound: transport latency can only ever make a timestamp look older,
 * never newer, so the only thing this must absorb is genuine clock skew
 * between the two NTP-disciplined machines.
 */
export const SIGNED_BODY_MAX_FUTURE_SECONDS = 60;

/** Why {@link verifyFreshSignedBody} refused a body. Never surfaced to the caller. */
export type SignedBodyRejection =
  | "bad_signature"
  | "malformed_body"
  | "missing_timestamp"
  | "missing_nonce"
  | "stale"
  | "future";

export type SignedBodyResult =
  | { ok: true; payload: Record<string, unknown>; ts: number; nonce: string }
  | { ok: false; reason: SignedBodyRejection; ageSeconds: number | null };

export type VerifyFreshOptions = {
  /** Injected clock (ms since epoch) so tests need no fake timers. */
  nowMs?: number;
  maxAgeSeconds?: number;
  maxFutureSeconds?: number;
};

/**
 * Verify a `pg_net → service endpoint` body that carries its own freshness:
 * the HMAC first, then the timestamp window. Both `ts` (epoch SECONDS) and
 * `nonce` live INSIDE the signed payload, so neither can be altered without
 * invalidating the signature.
 *
 * ## Why this exists
 *
 * A signer that signs a CONSTANT body produces a CONSTANT signature, and one
 * captured request then replays forever. That was true of
 * `public._ai_models_refresh_tick()`, whose body was a literal
 * `{"mode":"refresh"}` — and each replay now spends a real user's borrowed
 * provider credential on outbound calls. Adding `ts` + `nonce` makes every
 * signed body unique and gives it an expiry.
 *
 * ## Order is the security property
 *
 * The HMAC is checked BEFORE any field of the body is read. Parsing an
 * unauthenticated body — even just to look at its timestamp — is exactly the
 * mistake this signature exists to prevent, so `bad_signature` short-circuits
 * before `JSON.parse`.
 *
 * ## What the nonce does and does not do
 *
 * There is no store shared between Vercel function invocations, so the nonce
 * is NOT checked for uniqueness — nothing here detects a replay. Be precise
 * about what it buys: it makes each signed body (and hence each signature)
 * unique, so a capture is worthless once its window has passed, and it removes
 * the "one signature valid forever" property. The real defence inside the
 * window is the timestamp bound alone: a captured body remains replayable for
 * up to {@link SIGNED_BODY_MAX_AGE_SECONDS} after it was signed. Closing that
 * residual window would need server-side nonce tracking (a Postgres table of
 * seen nonces, or a KV with a TTL), which is deliberately not built here.
 *
 * ## Who uses this
 *
 * Callers today: `/api/ai/models/refresh` only. The other four endpoints that
 * share this secret and `verifyBody` — `/api/ai/embed`,
 * `/api/ai/automation-step`, `/api/ai/autopilot`, `/api/ai/personal-agent` —
 * do NOT use it yet, because each signs a body carrying a job id or a batch
 * payload and each has its own idempotency downstream (e.g. the personal-agent
 * sweep's `(user_agent_id, fire_date, fire_hour)` key plus `claimRun`), which
 * already bounds a replay to re-triggering one already-claimed job. They can
 * adopt this helper unchanged once their signers also emit `ts` + `nonce`;
 * see the deployment ordering note below before doing so.
 *
 * ## Deployment ordering (signer first, always)
 *
 * The migration and the deploy do not flip atomically. Adding fields to the
 * signed body cannot break an OLD verifier, because the HMAC covers the whole
 * body string and `verifyBody` never reads the fields — so ship the signer
 * first and the verifier second. The reverse order fails every request closed.
 */
export function verifyFreshSignedBody(
  body: string,
  signature: string,
  secret: string,
  opts: VerifyFreshOptions = {},
): SignedBodyResult {
  // 1. Authenticate. Nothing below this line may read the body otherwise.
  if (!verifyBody(body, signature, secret))
    return { ok: false, reason: "bad_signature", ageSeconds: null };

  // 2. The body is now proven to be ours; parsing it is safe.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "malformed_body", ageSeconds: null };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { ok: false, reason: "malformed_body", ageSeconds: null };

  const payload = parsed as Record<string, unknown>;
  const ts = payload.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts))
    return { ok: false, reason: "missing_timestamp", ageSeconds: null };

  const nowMs = opts.nowMs ?? Date.now();
  const ageSeconds = Math.round(nowMs / 1000 - ts);
  const maxAge = opts.maxAgeSeconds ?? SIGNED_BODY_MAX_AGE_SECONDS;
  const maxFuture = opts.maxFutureSeconds ?? SIGNED_BODY_MAX_FUTURE_SECONDS;
  if (ageSeconds > maxAge) return { ok: false, reason: "stale", ageSeconds };
  if (ageSeconds < -maxFuture)
    return { ok: false, reason: "future", ageSeconds };

  // Presence-and-shape only — see "What the nonce does and does not do".
  const nonce = payload.nonce;
  if (typeof nonce !== "string" || nonce.length === 0)
    return { ok: false, reason: "missing_nonce", ageSeconds };

  return { ok: true, payload, ts, nonce };
}
