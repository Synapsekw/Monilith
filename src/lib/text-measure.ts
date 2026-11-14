// Canvas text measurement, shared by the board table's Name-column auto-fit
// and the timeline's "does the label fit in the bar" decision. Pure width
// measurement — no layout, no DOM writes.

/** The generic fallback stack `font-sans` itself falls back to. */
const FALLBACK_STACK = "ui-sans-serif, system-ui, sans-serif";

/**
 * A canvas font string for the app's UI face. `fontInterVar` is the LIVE value
 * of the `--font-inter` custom property: next/font self-hosts Inter under a
 * generated family name exposed only through that variable, so the bare
 * literal "Inter" never resolves in the browser. Empty (jsdom, or before
 * next/font registers it) falls back to the literal.
 */
export function buildMeasureFont(
  fontInterVar: string,
  weight: string,
  size: string,
): string {
  const family = fontInterVar.trim() || "Inter";
  return `${weight} ${size} ${family}, ${FALLBACK_STACK}`;
}

/**
 * A measurer for text set in the UI face at `weight` / `size` (CSS values,
 * e.g. "500", "11px"). Create it once per mount (`useMemo(…, [])`), not at
 * module scope: the font variable only exists on <html> at runtime. Where
 * there is no canvas (SSR, jsdom) it measures 0 for everything — callers treat
 * 0 as "unknown". Results are cached per string, so a label is measured once
 * however often a row re-renders.
 */
export function createTextMeasurer(
  weight: string,
  size: string,
): (text: string) => number {
  const ctx =
    typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;
  if (!ctx) return () => 0;
  ctx.font = buildMeasureFont(
    getComputedStyle(document.documentElement).getPropertyValue("--font-inter"),
    weight,
    size,
  );
  const cache = new Map<string, number>();
  return (text) => {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const width = ctx.measureText(text).width;
    cache.set(text, width);
    return width;
  };
}
