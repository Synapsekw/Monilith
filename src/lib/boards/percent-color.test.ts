import { describe, expect, it } from "vitest";
import { percentBandColor } from "./percent-color";

describe("percentBandColor", () => {
  it.each([
    [0, "bg-[var(--progress-red)]"],
    [19, "bg-[var(--progress-red)]"],
    [20, "bg-[var(--progress-orange)]"],
    [39, "bg-[var(--progress-orange)]"],
    [40, "bg-[var(--progress-amber)]"],
    [59, "bg-[var(--progress-amber)]"],
    [60, "bg-[var(--progress-lime)]"],
    [79, "bg-[var(--progress-lime)]"],
    [80, "bg-[var(--progress-green)]"],
    [99, "bg-[var(--progress-green)]"],
    [100, "bg-[var(--progress-complete)]"],
  ])("maps %i%% to its band", (value, expected) => {
    expect(percentBandColor(value)).toBe(expected);
  });

  it("clamps below 0 to the red band", () => {
    expect(percentBandColor(-10)).toBe("bg-[var(--progress-red)]");
  });

  it("clamps above 100 to the complete band", () => {
    expect(percentBandColor(150)).toBe("bg-[var(--progress-complete)]");
  });
});
