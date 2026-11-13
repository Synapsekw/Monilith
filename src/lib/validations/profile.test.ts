import { describe, it, expect } from "vitest";
import { THEME_REACH_IDS } from "@/lib/theme/presets";
import * as profileValidations from "./profile";
import {
  updateProfileCelebrateDoneSchema,
  updateProfileFullNameSchema,
  updateProfileThemePresetSchema,
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
    expect(THEME_REACH_IDS).toEqual(["subtle", "tinted", "vivid"]);
    for (const themeReach of THEME_REACH_IDS) {
      const r = updateProfileThemeReachSchema.safeParse({ themeReach });
      expect(r.success).toBe(true);
      expect(r.success && r.data.themeReach).toBe(themeReach);
    }
  });

  // `THEME_REACH_IDS` in the theme registry is the one id list. A second name
  // for it here invited a second default and a second narrowing check.
  it("re-exports no alias of the reach id list", () => {
    expect(profileValidations).not.toHaveProperty("THEME_REACH_VALUES");
    expect(updateProfileThemeReachSchema.shape.themeReach.options).toEqual([
      ...THEME_REACH_IDS,
    ]);
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

describe("updateProfileThemePresetSchema", () => {
  it("accepts the two-accent presets — the enum derives from THEME_PRESET_IDS", () => {
    for (const themePreset of ["aurora", "sunset", "nebula"]) {
      const r = updateProfileThemePresetSchema.safeParse({ themePreset });
      expect(r.success, themePreset).toBe(true);
      expect(r.success && r.data.themePreset).toBe(themePreset);
    }
  });

  it("still accepts a single-accent preset and rejects an unknown id", () => {
    expect(
      updateProfileThemePresetSchema.safeParse({ themePreset: "ocean" })
        .success,
    ).toBe(true);
    expect(
      updateProfileThemePresetSchema.safeParse({ themePreset: "teal" }).success,
    ).toBe(false);
  });
});
