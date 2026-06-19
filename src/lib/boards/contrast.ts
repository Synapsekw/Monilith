/**
 * Legible text color for a solid color-chip ("pill") background.
 *
 * Status/dropdown/group pills store a user-chosen hex in the DB and render it
 * as the pill background. White text was hardcoded for the vivid dark palette,
 * but fails on light fills (and on pale colors in either mode). This picks
 * whichever of near-black / white has the higher WCAG contrast ratio against
 * the background — theme-agnostic, and robust for arbitrary user colors.
 */

/** White foreground (unchanged from prior behavior). */
export const LIGHT_FG = "#ffffff";
/** Near-black foreground (not pure #000 — softer on the eye). */
export const DARK_FG = "#1a1a1d";

/** Parse `#rgb` / `#rrggbb` → [r,g,b] in 0–255, or null if unparseable. */
function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== "string") return null;
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance (0–1) of an sRGB color. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1–21) between two hex colors. Unparseable → 1. */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick a legible text color for a solid pill of background `bg`.
 * Returns the higher-contrast of {@link DARK_FG} / {@link LIGHT_FG}.
 * Unparseable input → {@link LIGHT_FG} (prior behavior).
 */
export function pillTextColor(bg: string): string {
  if (!parseHex(bg)) return LIGHT_FG;
  return contrastRatio(bg, DARK_FG) >= contrastRatio(bg, LIGHT_FG)
    ? DARK_FG
    : LIGHT_FG;
}
