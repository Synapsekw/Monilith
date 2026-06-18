import { describe, it, expect } from "vitest";
import { isValidTimeZone, updateOrgTimezoneSchema } from "./org";

describe("isValidTimeZone", () => {
  it("accepts a real IANA zone", () => {
    expect(isValidTimeZone("Europe/Belgrade")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });
  it("rejects a bogus zone", () => {
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("updateOrgTimezoneSchema", () => {
  it("accepts a valid payload", () => {
    const r = updateOrgTimezoneSchema.safeParse({
      orgId: "00000000-0000-4000-8000-000000000001",
      timezone: "America/New_York",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an invalid timezone", () => {
    const r = updateOrgTimezoneSchema.safeParse({
      orgId: "00000000-0000-4000-8000-000000000001",
      timezone: "Not/AZone",
    });
    expect(r.success).toBe(false);
  });
  it("rejects a non-uuid orgId", () => {
    const r = updateOrgTimezoneSchema.safeParse({
      orgId: "nope",
      timezone: "UTC",
    });
    expect(r.success).toBe(false);
  });
});
