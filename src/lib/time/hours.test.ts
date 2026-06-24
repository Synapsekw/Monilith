import { describe, expect, it } from "vitest";

import { parseHours, hoursToSecs, secsToHours, formatHours } from "./hours";

describe("parseHours", () => {
  it("parses a decimal string to hours", () => {
    expect(parseHours("2.5")).toBe(2.5);
  });
  it("parses an integer string", () => {
    expect(parseHours("8")).toBe(8);
  });
  it("returns null for empty/whitespace", () => {
    expect(parseHours("")).toBeNull();
    expect(parseHours("   ")).toBeNull();
  });
  it("returns null for non-numeric", () => {
    expect(parseHours("abc")).toBeNull();
    expect(parseHours("1.2.3")).toBeNull();
  });
  it("returns null for out-of-range (<0 or >24)", () => {
    expect(parseHours("-1")).toBeNull();
    expect(parseHours("24.1")).toBeNull();
  });
  it("accepts the boundaries 0 and 24", () => {
    expect(parseHours("0")).toBe(0);
    expect(parseHours("24")).toBe(24);
  });
});

describe("hoursToSecs / secsToHours", () => {
  it("converts 2.5h to 9000s", () => {
    expect(hoursToSecs(2.5)).toBe(9000);
  });
  it("rounds to whole seconds", () => {
    expect(hoursToSecs(0.001)).toBe(4); // 3.6 -> 4
  });
  it("round-trips back to hours", () => {
    expect(secsToHours(9000)).toBe(2.5);
  });
});

describe("formatHours", () => {
  it("formats whole hours without trailing zeros", () => {
    expect(formatHours(8 * 3600)).toBe("8");
  });
  it("formats fractional hours", () => {
    expect(formatHours(9000)).toBe("2.5");
  });
  it("formats zero as empty string", () => {
    expect(formatHours(0)).toBe("");
  });
});
