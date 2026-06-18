// src/components/landing/mono/measure.test.ts
import { describe, expect, it } from "vitest";
import { topCenter, center, ropePath } from "./measure";

const stage = { left: 100, top: 50, width: 800, height: 600 };

describe("measure", () => {
  it("topCenter returns the top-middle of a rect in stage space", () => {
    const rect = { left: 300, top: 150, width: 40, height: 60 };
    expect(topCenter(rect, stage)).toEqual({ x: 300 - 100 + 20, y: 150 - 50 });
  });

  it("center returns the middle of a rect in stage space", () => {
    const rect = { left: 300, top: 150, width: 40, height: 60 };
    expect(center(rect, stage)).toEqual({ x: 220, y: 130 });
  });

  it("ropePath builds a cubic bezier from `from` to `to`", () => {
    const d = ropePath({ x: 400, y: 0 }, { x: 220, y: 130 });
    expect(d.startsWith("M 400,0 C ")).toBe(true);
    expect(d.endsWith("220,130")).toBe(true);
  });
});
