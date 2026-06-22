/**
 * Shared timezone-safe conversion between a `YYYY-MM-DD` date string and a
 * *local* `Date`. Native `new Date("2026-06-20")` parses as UTC midnight, which
 * drifts a calendar day in negative-offset zones — these helpers use local
 * getters/constructors so the round-trip never shifts a day. Used by every
 * `Calendar`-backed date picker (board date cell, time-tracking entries).
 */

/** Parse a `YYYY-MM-DD` string into a *local* Date at midnight. */
export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format a *local* Date back to `YYYY-MM-DD`, matching {@link isoToLocalDate}. */
export function localDateToISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
