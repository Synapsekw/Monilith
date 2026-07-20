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
