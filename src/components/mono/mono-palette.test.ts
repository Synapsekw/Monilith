import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONO_COLOR,
  MONO_PRESET_COLORS,
  isMonoColor,
  monoPalette,
} from "./mono-palette";

describe("monoPalette", () => {
  it("derives every shade from one hex", () => {
    const p = monoPalette("#7395ff");
    expect(p.glow).toBe("#7395ff");
    expect(p.glowRgb).toEqual([115, 149, 255]);
    expect(p.beltDeep).toBe("rgb(17,22,38)"); // 85% towards black
    expect(p.beltLight).toBe("rgb(178,197,255)"); // 45% towards white
  });

  it("rejects anything but #rrggbb", () => {
    expect(() => monoPalette("blue")).toThrow();
    expect(() => monoPalette("#abc")).toThrow();
  });

  it("ships seven presets, all valid", () => {
    expect(MONO_PRESET_COLORS).toHaveLength(7);
    for (const c of MONO_PRESET_COLORS)
      expect(() => monoPalette(c.hex)).not.toThrow();
  });
});
describe("isMonoColor", () => {
  it("accepts #rrggbb in either case and nothing else", () => {
    expect(isMonoColor("#7395ff")).toBe(true);
    expect(isMonoColor("#A77BFF")).toBe(true);
    expect(isMonoColor("blue")).toBe(false);
    expect(isMonoColor("#abc")).toBe(false);
    expect(isMonoColor(DEFAULT_MONO_COLOR)).toBe(true);
  });
});
