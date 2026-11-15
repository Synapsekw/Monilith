/**
 * The burn chart's left axis. Recharts does not size the Y axis to its tick
 * labels: a fixed `width={28}` clipped four-digit values ("200" drawn for
 * 2200). Ticks are written in full up to 9,999 (no separator, to stay
 * narrow) and compactly above ("12k", "1.2M"); the axis is as wide as the
 * longest label the domain can produce. Recharts-free, so it is testable and
 * importable without the chart. Pixel fit still needs a browser check.
 */
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function burnAxisTick(value: number): string {
  return Math.abs(value) < 10_000 ? String(value) : compact.format(value);
}

/** Approximate advance of one 10–12px tick glyph, plus the tick gap. */
const CHAR_PX = 7;
const PAD_PX = 10;
const MIN_PX = 28;

/**
 * Width for an axis whose largest value is `max`. Recharts rounds the domain
 * up to a "nice" tick that can exceed the data maximum (2,150 → 2,500), so the
 * label is measured on a 25% headroom.
 */
export function burnAxisWidth(max: number): number {
  const m = Math.ceil(Math.max(0, max));
  // Both ends: 8,000 has a 4-char tick ("8000") though 10,000 is "10k".
  const chars = Math.max(
    burnAxisTick(m).length,
    burnAxisTick(Math.ceil(m * 1.25)).length,
  );
  return Math.max(MIN_PX, chars * CHAR_PX + PAD_PX);
}
