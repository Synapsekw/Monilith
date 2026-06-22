import { describe, it, expect } from "vitest";
import { itemPresenceTargetSchema } from "./presence";

describe("itemPresenceTargetSchema", () => {
  it("accepts a non-empty item id", () => {
    expect(itemPresenceTargetSchema.parse("item-123")).toBe("item-123");
  });

  it("rejects an empty string", () => {
    expect(itemPresenceTargetSchema.safeParse("").success).toBe(false);
  });
});
