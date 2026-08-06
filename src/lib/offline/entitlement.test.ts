import { describe, expect, it } from "vitest";
import { OFFLINE_WINDOW_MS } from "./constants";
import { isWithinGrace } from "./entitlement";

const NOW = 1_700_000_000_000;

describe("isWithinGrace", () => {
  it("accepts an active entitlement checked just now", () => {
    expect(
      isWithinGrace({ plan: "pro", status: "active", checkedAt: NOW }, NOW),
    ).toBe(true);
  });

  it("accepts one checked one minute inside the window", () => {
    const checkedAt = NOW - OFFLINE_WINDOW_MS + 60_000;
    expect(
      isWithinGrace({ plan: "pro", status: "active", checkedAt }, NOW),
    ).toBe(true);
  });

  it("rejects one checked one minute outside the window", () => {
    const checkedAt = NOW - OFFLINE_WINDOW_MS - 60_000;
    expect(
      isWithinGrace({ plan: "pro", status: "active", checkedAt }, NOW),
    ).toBe(false);
  });

  it("accepts exactly the boundary — checkedAt === now - OFFLINE_WINDOW_MS (inclusive, pinned deliberately)", () => {
    const checkedAt = NOW - OFFLINE_WINDOW_MS;
    expect(
      isWithinGrace({ plan: "pro", status: "active", checkedAt }, NOW),
    ).toBe(true);
  });

  it("rejects a slightly-future checkedAt (clock skew)", () => {
    const checkedAt = NOW + 60_000;
    expect(
      isWithinGrace({ plan: "pro", status: "active", checkedAt }, NOW),
    ).toBe(false);
  });

  it("rejects a far-future checkedAt (tampered localStorage) rather than granting unbounded access", () => {
    const checkedAt = NOW + 100 * OFFLINE_WINDOW_MS;
    expect(
      isWithinGrace({ plan: "pro", status: "active", checkedAt }, NOW),
    ).toBe(false);
  });

  it("rejects a non-active status even when freshly checked", () => {
    expect(
      isWithinGrace({ plan: "pro", status: "canceled", checkedAt: NOW }, NOW),
    ).toBe(false);
  });

  it("rejects a missing entitlement", () => {
    expect(isWithinGrace(null, NOW)).toBe(false);
  });
});
