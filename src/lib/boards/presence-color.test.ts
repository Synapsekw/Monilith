import { describe, expect, it } from "vitest";
import { PRESENCE_PALETTE, presenceColor } from "./presence-color";

describe("presenceColor", () => {
  it("is deterministic for a given userId", () => {
    expect(presenceColor("user-abc")).toBe(presenceColor("user-abc"));
  });
  it("always returns a value from the palette", () => {
    for (const id of ["a", "b", "c", "user-1", "user-2", "zzz"]) {
      expect(PRESENCE_PALETTE).toContain(presenceColor(id));
    }
  });
  it("distributes different ids across the palette (not all one color)", () => {
    const colors = new Set(
      Array.from({ length: 50 }, (_, i) => presenceColor(`user-${i}`)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
