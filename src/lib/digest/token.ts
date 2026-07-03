import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 over "unsub:<userId>" — the one-click unsubscribe capability.
 * No expiry by design: the link must keep working from an old email, and it can
 * only ever flip one flag off. */
export function unsubscribeSignature(secret: string, userId: string): string {
  return createHmac("sha256", secret).update(`unsub:${userId}`).digest("hex");
}

export function verifyUnsubscribeSignature(
  secret: string,
  userId: string,
  sig: string,
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = Buffer.from(unsubscribeSignature(secret, userId), "hex");
  const given = Buffer.from(sig, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
