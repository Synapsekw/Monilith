import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashToken, verifyPkce } from "./crypto";
import { createHash } from "node:crypto";

describe("generateOpaqueToken", () => {
  it("returns a high-entropy, url-safe string", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashToken", () => {
  it("is deterministic and does not return the input", () => {
    const token = "abc123";
    expect(hashToken(token)).toEqual(hashToken(token));
    expect(hashToken(token)).not.toEqual(token);
  });
});

describe("verifyPkce", () => {
  it("accepts a correct S256 verifier/challenge pair", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a mismatched pair", () => {
    expect(verifyPkce("wrong-verifier", "not-a-real-challenge")).toBe(false);
  });
});
