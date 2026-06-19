import { describe, expect, it } from "vitest";

import { OPTION_COLORS, nextOptionColor } from "./option-colors";

describe("nextOptionColor", () => {
  it("returns the first color when none are used", () => {
    expect(nextOptionColor([])).toBe(OPTION_COLORS[0]);
  });

  it("returns the second color when the first is used", () => {
    expect(nextOptionColor([OPTION_COLORS[0]])).toBe(OPTION_COLORS[1]);
  });

  it("falls back to the first color when all are used", () => {
    expect(nextOptionColor([...OPTION_COLORS])).toBe(OPTION_COLORS[0]);
  });
});
