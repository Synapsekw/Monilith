const DAY_MS = 86_400_000;

/**
 * Guards a date-ranged tool. Returns null when the range is usable, otherwise
 * the message the handler surfaces verbatim.
 *
 * Date-ranged tools cap the SPAN, not the row count: silently truncating a
 * year of time data to the first N rows produces a confident, wrong total.
 * Failing loudly makes the agent narrow the window instead.
 */
export function validateRange(
  from: string,
  to: string,
  maxDays: number,
): string | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end))
    return "Dates must be ISO `YYYY-MM-DD`.";
  if (end < start) return "`from` must be on or before `to`.";
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days > maxDays)
    return `Range too large: ${days} days requested, limit is ${maxDays}. Narrow the window and call again.`;
  return null;
}
