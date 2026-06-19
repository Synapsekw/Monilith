/** Fixed Monday-style swatch palette for status/dropdown options. No custom hex. */
export const OPTION_COLORS = [
  "#00c875",
  "#fdab3d",
  "#e2445c",
  "#579bfc",
  "#a25ddc",
  "#037f4c",
  "#ff642e",
  "#9d99b9",
  "#0086c0",
  "#bb3354",
  "#ffcb00",
  "#784bd1",
  "#66ccff",
  "#7f5347",
  "#333333",
] as const;

/** The next palette color not already used (falls back to the first). */
export function nextOptionColor(used: readonly string[]): string {
  return OPTION_COLORS.find((c) => !used.includes(c)) ?? OPTION_COLORS[0];
}
