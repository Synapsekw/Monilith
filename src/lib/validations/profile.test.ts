import { describe, it, expect } from "vitest";
import {
  THEME_REACH_VALUES,
  updateProfileCelebrateDoneSchema,
  updateProfileFullNameSchema,
  updateProfileThemeReachSchema,
  updateProfileTimezoneSchema,
} from "./profile";

describe("updateProfileFullNameSchema", () => {
  it("trims surrounding whitespace", () => {
    const r = updateProfileFullNameSchema.safeParse({
      fullName: "  Ada Lovelace  ",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.fullName).toBe("Ada Lovelace");
  });

  it("coerces an empty / whitespace-only string to null (clear)", () => {
    for (const fullName of ["", "   "]) {
      const r = updateProfileFullNameSchema.safeParse({ fullName });
      expect(r.success).toBe(true);
      expect(r.success && r.data.fullName).toBeNull();
    }
  });

  it("passes null through as null", () => {
    const r = updateProfileFullNameSchema.safeParse({ fullName: null });
    expect(r.success).toBe(true);
    expect(r.success && r.data.fullName).toBeNull();
  });

  it("accepts a name at the 120-char boundary", () => {
    const name = "a".repeat(120);
    const r = updateProfileFullNameSchema.safeParse({ fullName: name });
    expect(r.success).toBe(true);
    expect(r.success && r.data.fullName).toBe(name);
  });

  it("rejects a name longer than 120 chars (measured after trim)", () => {
    const r = updateProfileFullNameSchema.safeParse({
      fullName: `  ${"a".repeat(121)}  `,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-string, non-null value", () => {
    const r = updateProfileFullNameSchema.safeParse({ fullName: 42 });
    expect(r.success).toBe(false);
  });
});

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

describe("updateProfileThemeReachSchema", () => {
  it("accepts each of the three reach ids", () => {
    expect(THEME_REACH_VALUES).toEqual(["subtle", "tinted", "vivid"]);
    for (const themeReach of ["subtle", "tinted", "vivid"]) {
      const r = updateProfileThemeReachSchema.safeParse({ themeReach });
      expect(r.success).toBe(true);
      expect(r.success && r.data.themeReach).toBe(themeReach);
    }
  });

  it("rejects an unknown reach id", () => {
    expect(
      updateProfileThemeReachSchema.safeParse({ themeReach: "loud" }).success,
    ).toBe(false);
  });

  it("rejects a missing or non-string value", () => {
    expect(updateProfileThemeReachSchema.safeParse({}).success).toBe(false);
    expect(
      updateProfileThemeReachSchema.safeParse({ themeReach: null }).success,
    ).toBe(false);
  });
});

describe("updateProfileCelebrateDoneSchema", () => {
  it("accepts true and false", () => {
    for (const celebrateDone of [true, false]) {
      const r = updateProfileCelebrateDoneSchema.safeParse({ celebrateDone });
      expect(r.success).toBe(true);
      expect(r.success && r.data.celebrateDone).toBe(celebrateDone);
    }
  });

  it("rejects non-boolean values (no string coercion)", () => {
    for (const celebrateDone of ["true", 1, null, undefined]) {
      expect(
        updateProfileCelebrateDoneSchema.safeParse({ celebrateDone }).success,
      ).toBe(false);
    }
  });
});
