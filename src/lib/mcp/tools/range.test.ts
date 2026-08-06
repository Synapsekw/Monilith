import { describe, expect, it } from "vitest";
import { validateRange } from "./range";

describe("validateRange", () => {
  it("accepts a range inside the cap", () => {
    expect(validateRange("2026-01-01", "2026-01-31", 92)).toBeNull();
  });

  it("accepts a single day", () => {
    expect(validateRange("2026-01-01", "2026-01-01", 92)).toBeNull();
  });

  it("rejects a reversed range", () => {
    expect(validateRange("2026-02-01", "2026-01-01", 92)).toContain("before");
  });

  it("rejects a range longer than the cap, naming the cap", () => {
    const msg = validateRange("2026-01-01", "2026-12-31", 92);
    expect(msg).toContain("92");
  });
});
