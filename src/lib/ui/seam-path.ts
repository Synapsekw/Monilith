/**
 * The content card's own outline, as a path that can be lit.
 *
 * The collapse control for each panel is the seam it moves: the card's hairline
 * brightens from a short tick at the middle of an edge into the WHOLE edge,
 * corners included. A `<div>` with a height cannot do that — it ends in a
 * straight stub short of the `rounded-xl` corner — so the lit seam is a stroked
 * copy of the card's outline, laid exactly over the border it brightens.
 *
 * Each edge is TWO paths that both start at the middle of that edge, one
 * running up and one running down. A single dash growing from each path's own
 * origin then opens the light evenly in both directions and reaches the two
 * corners at the same instant. (Revealing one path with a `stroke-dashoffset`
 * is the wrong shape: the offset has to be recomputed against the total length
 * and puts the rest tick out of phase with the middle of the edge.)
 *
 * Lengths are computed here rather than read back with `getTotalLength()`: the
 * geometry is known, a layout read per frame is waste, and jsdom does not
 * implement `getTotalLength()` at all — so this stays a pure function that
 * `seam-path.test.ts` covers without a browser.
 */

export type SeamSide = "left" | "right";

/** One half of an edge: its `d` attribute and its exact length in px. */
export type SeamHalf = { d: string; length: number };

/** An edge, opened from its middle in both directions. */
export type Seam = { up: SeamHalf; down: SeamHalf };

export type SeamInput = {
  /** The card's border-box width. */
  width: number;
  /** The card's border-box height. */
  height: number;
  /** The card's corner radius (`rounded-xl` → `--radius` × 1.4 ≈ 19.6px). */
  radius: number;
  side: SeamSide;
  /** Stroke width of the lit line. The path is inset by half of it. */
  stroke?: number;
};

/** Two decimals is finer than a device pixel and keeps the `d` string stable. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The two halves of one edge.
 *
 * `inset` is half the stroke, so a 1px line lands ON the 1px border it
 * brightens instead of half a pixel outside it. The radius is clamped to what
 * the box can actually hold, which keeps a short card — or a card mid-fold,
 * whose box is briefly tiny — from emitting an arc bigger than itself.
 */
export function seamPath({
  width,
  height,
  radius,
  side,
  stroke = 1,
}: SeamInput): Seam {
  const inset = stroke / 2;
  // The tangent points, in card coordinates: the corner arc leaves the vertical
  // edge `corner` from the top and meets the horizontal edge `corner` from the
  // side.
  const corner = Math.max(0, Math.min(radius, height / 2, width / 2));
  const arc = Math.max(0, corner - inset);
  const mid = height / 2;
  const x = side === "left" ? inset : width - inset;
  /** Where the corner arc ends on the horizontal edge. */
  const cx = side === "left" ? corner : width - corner;
  /** The straight run from the middle of the edge to the start of the corner. */
  const run = Math.max(0, mid - corner);

  // Each arc turns AWAY from the middle of the edge, so the two halves of one
  // side mirror each other and the two sides mirror again.
  const sweepUp = side === "left" ? 1 : 0;
  const sweepDown = side === "left" ? 0 : 1;

  function half(tangentY: number, cornerY: number, sweep: number): SeamHalf {
    const start = `M ${round(x)} ${round(mid)}`;
    if (arc <= 0) {
      // No radius to follow (or a box too small to hold one): the edge is the
      // straight run alone, ending at the inset corner of the border box.
      return {
        d: `${start} L ${round(x)} ${round(cornerY)}`,
        length: Math.max(0, mid - inset),
      };
    }
    const line = run > 0 ? ` L ${round(x)} ${round(tangentY)}` : "";
    return {
      d: `${start}${line} A ${round(arc)} ${round(arc)} 0 0 ${sweep} ${round(cx)} ${round(cornerY)}`,
      length: run + (Math.PI * arc) / 2,
    };
  }

  return {
    up: half(corner, inset, sweepUp),
    down: half(height - corner, height - inset, sweepDown),
  };
}
