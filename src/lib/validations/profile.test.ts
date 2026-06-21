import { describe, it, expect } from "vitest";
import { updateProfileTimezoneSchema } from "./profile";

describe("updateProfileTimezoneSchema", () => {
  it("accepts a valid IANA timezone", () => {
    const r = updateProfileTimezoneSchema.safeParse({
      timezone: "Europe/Belgrade",
    });
    expect(r.success).toBe(true);
  });

  it("accepts null (Automatic)", () => {
    const r = updateProfileTimezoneSchema.safeParse({ timezone: null });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown timezone", () => {
    const r = updateProfileTimezoneSchema.safeParse({
      timezone: "Mars/Olympus_Mons",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const r = updateProfileTimezoneSchema.safeParse({ timezone: "" });
    expect(r.success).toBe(false);
  });
});
