import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A random, URL-safe, 256-bit opaque token (access or refresh token). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest — tokens are stored hashed, never in plaintext. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** RFC 7636 S256 PKCE check: base64url(sha256(verifier)) === challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
