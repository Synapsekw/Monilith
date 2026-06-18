// src/components/landing/mono/sequence.test.ts
import { describe, expect, it } from "vitest";
import { buildSequence } from "./sequence";

describe("buildSequence", () => {
  const seq = buildSequence({ climbDistance: 120 });

  it("has the six choreography segments in order", () => {
    expect(seq).toHaveLength(6);
    expect(seq.map((s) => s[0])).toEqual([
      ".rope",
      ".mono",
      ".mono",
      ".mono",
      ".subtitle",
      ".mono",
    ]);
  });

  it("draws the rope on first via pathLength", () => {
    expect(seq[0][1]).toMatchObject({ pathLength: [0.001, 1] });
  });

  it("descends mono along the path in parallel with the rope draw", () => {
    expect(seq[1][1]).toMatchObject({ offsetDistance: ["0%", "100%"] });
    expect(seq[1][2]).toMatchObject({ at: "<" });
  });

  it("climbs by the measured distance then reveals the subtitle", () => {
    expect(seq[3][1]).toMatchObject({ y: [0, 120] });
    expect(seq[4][0]).toBe(".subtitle");
    expect(seq[4][1]).toMatchObject({ opacity: [0, 1] });
  });

  it("returns mono to the O to perch (y back to 0)", () => {
    expect(seq[5][1]).toMatchObject({ y: [120, 0] });
  });
});
