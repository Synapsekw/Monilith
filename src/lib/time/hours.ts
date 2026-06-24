/** Pure decimal-hours ↔ seconds helpers for the weekly time card. */

/** Parse a user-typed decimal-hours string. Returns the hours value, or null
 * when empty, non-numeric, or out of the valid [0, 24] range. */
export function parseHours(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const h = Number(trimmed);
  if (!Number.isFinite(h) || h < 0 || h > 24) return null;
  return h;
}

/** Hours → whole seconds (rounded). 2.5 → 9000. */
export function hoursToSecs(hours: number): number {
  return Math.round(hours * 3600);
}

/** Seconds → hours (decimal). 9000 → 2.5. */
export function secsToHours(secs: number): number {
  return secs / 3600;
}

/** Display a seconds value as a compact decimal-hours string for a cell input.
 * 0 → "" (an empty cell), 28800 → "8", 9000 → "2.5". */
export function formatHours(secs: number): string {
  if (secs === 0) return "";
  const h = secs / 3600;
  return Number.isInteger(h) ? String(h) : String(Number(h.toFixed(2)));
}
