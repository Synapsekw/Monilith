import { describe, expect, it } from "vitest";
import { seamPath, type SeamSide } from "./seam-path";

/** The real shell geometry: a card beside a 240px rail, `rounded-xl` corners. */
const CARD = { width: 980, height: 620, radius: 19.6 } as const;

/** Every coordinate pair in a `d` string, in order. */
function points(d: string): [number, number][] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const out: [number, number][] = [];
  // `M x y`, an optional `L x y`, then `A rx ry rot large sweep x y`.
  const tokens = d.split(/(?=[MLA])/);
  let i = 0;
  for (const token of tokens) {
    const count = token.trimStart().startsWith("A") ? 7 : 2;
    const slice = nums.slice(i, i + count);
    i += count;
    out.push([slice[count - 2]!, slice[count - 1]!]);
  }
  return out;
}

/** The sweep flag of the arc in a `d` string, or null when it has no arc. */
function sweep(d: string): number | null {
  const arc = d.match(/A\s+[\d.]+\s+[\d.]+\s+\d+\s+\d+\s+(\d)/);
  return arc ? Number(arc[1]) : null;
}

describe("seamPath", () => {
  it("starts both halves at the middle of the edge it lights", () => {
    for (const side of ["left", "right"] as SeamSide[]) {
      const { up, down } = seamPath({ ...CARD, side });
      const [upStart] = points(up.d);
      const [downStart] = points(down.d);
      expect(upStart).toEqual(downStart);
      expect(upStart![1]).toBe(CARD.height / 2);
    }
  });

  it("ends each half on the horizontal edge, past the corner", () => {
    const { up, down } = seamPath({ ...CARD, side: "left" });
    // 0.5 is the half-stroke inset that puts the line on the border.
    expect(points(up.d).at(-1)).toEqual([19.6, 0.5]);
    expect(points(down.d).at(-1)).toEqual([19.6, 619.5]);
  });

  it("mirrors left and right about the card's vertical centre line", () => {
    const left = seamPath({ ...CARD, side: "left" });
    const right = seamPath({ ...CARD, side: "right" });
    for (const key of ["up", "down"] as const) {
      const l = points(left[key].d);
      const r = points(right[key].d);
      expect(r).toHaveLength(l.length);
      l.forEach(([lx, ly], i) => {
        const [rx, ry] = r[i]!;
        expect(rx + lx).toBeCloseTo(CARD.width, 5);
        expect(ry).toBeCloseTo(ly, 5);
      });
      expect(left[key].length).toBeCloseTo(right[key].length, 5);
    }
  });

  it("turns every corner away from the middle of its edge", () => {
    // The bug this catches is a flipped sweep flag, which bulges the arc into
    // the card instead of around the corner — invisible to a type checker and
    // to jsdom, and wrong in exactly the place the design is about.
    expect(sweep(seamPath({ ...CARD, side: "left" }).up.d)).toBe(1);
    expect(sweep(seamPath({ ...CARD, side: "left" }).down.d)).toBe(0);
    expect(sweep(seamPath({ ...CARD, side: "right" }).up.d)).toBe(0);
    expect(sweep(seamPath({ ...CARD, side: "right" }).down.d)).toBe(1);
  });

  it("covers the whole edge once, corners included, across the two halves", () => {
    // The invariant that matters: lit-up + lit-down is the straight edge
    // between the tangent points plus both quarter-arcs — no gap at the
    // middle, no overlap.
    const { up, down } = seamPath({ ...CARD, side: "left" });
    const arc = CARD.radius - 0.5;
    const straight = CARD.height - 2 * CARD.radius;
    expect(up.length + down.length).toBeCloseTo(straight + Math.PI * arc, 5);
  });

  it("clamps the corner to what the box can hold", () => {
    // A card mid-fold is briefly far shorter than its own radius. Without the
    // clamp this emits an arc taller than the card.
    const { up, down } = seamPath({
      width: 200,
      height: 24,
      radius: 19.6,
      side: "left",
    });
    for (const half of [up, down]) {
      for (const [, y] of points(half.d)) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(24);
      }
    }
    // Radius clamped to height/2 = 12, so the straight run vanishes entirely.
    expect(up.d).not.toContain("L");
    expect(up.length).toBeCloseTo((Math.PI * 11.5) / 2, 5);
  });

  it("degrades to a straight edge when there is no radius", () => {
    const { up, down } = seamPath({
      width: 200,
      height: 300,
      radius: 0,
      side: "right",
    });
    expect(up.d).toBe("M 199.5 150 L 199.5 0.5");
    expect(down.d).toBe("M 199.5 150 L 199.5 299.5");
    expect(up.length).toBeCloseTo(149.5, 5);
  });

  it("insets by half the stroke it is asked to draw", () => {
    const { up } = seamPath({ ...CARD, side: "left", stroke: 2 });
    expect(points(up.d)[0]![0]).toBe(1);
    expect(points(up.d).at(-1)).toEqual([19.6, 1]);
  });
});
