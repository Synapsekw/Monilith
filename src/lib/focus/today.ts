import { zonedDayOf } from "@/lib/datetime/timezone";

/** The calendar date "now" in an IANA zone, as `YYYY-MM-DD`. */
export function todayInTimeZone(
  tz: string | null,
  now: number,
): { today: string; timezoneAssumed: boolean } {
  const utc = new Date(now).toISOString().slice(0, 10);
  if (!tz) return { today: utc, timezoneAssumed: true };
  try {
    return { today: zonedDayOf(now, tz), timezoneAssumed: false };
  } catch {
    return { today: utc, timezoneAssumed: true };
  }
}
