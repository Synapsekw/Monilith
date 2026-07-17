/**
 * Absolute date + time, e.g. "Jun 21, 2026, 3:45 PM". Locale is PINNED to
 * "en-US" so the rendered string is identical on the server (Node) and in the
 * browser — otherwise a locale-driven order difference (gotcha-50) flashes on
 * hydration even when the timezone matches. `timeZone` undefined → the runtime's
 * default zone (the viewer's device zone in the browser).
 */
export function formatDateTime(
  value: string | number | Date,
  opts: { timeZone?: string } = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: opts.timeZone,
  }).format(date);
}
