import { describe, expect, it } from "vitest";
import {
  unsubscribeSignature,
  verifyUnsubscribeSignature,
} from "@/lib/digest/token";

describe("unsubscribe token", () => {
  const secret = "test-secret";
  const uid = "11111111-1111-1111-1111-111111111111";

  it("round-trips", () => {
    const sig = unsubscribeSignature(secret, uid);
    expect(verifyUnsubscribeSignature(secret, uid, sig)).toBe(true);
  });

  it("rejects a tampered user id", () => {
    const sig = unsubscribeSignature(secret, uid);
    expect(
      verifyUnsubscribeSignature(
        secret,
        "22222222-2222-2222-2222-222222222222",
        sig,
      ),
    ).toBe(false);
  });

  it("rejects garbage and wrong-length signatures without throwing", () => {
    expect(verifyUnsubscribeSignature(secret, uid, "zz")).toBe(false);
    expect(verifyUnsubscribeSignature(secret, uid, "")).toBe(false);
  });
});
