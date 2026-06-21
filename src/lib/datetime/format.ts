/**
 * Absolute date + time, e.g. "Jun 21, 2026, 3:45 PM". `timeZone` undefined →
 * the runtime's default zone (the viewer's device zone in the browser).
 */
export function formatDateTime(
  value: string | number | Date,
  opts: { timeZone?: string } = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: opts.timeZone,
  }).format(date);
}
