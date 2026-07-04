/** All IANA zones the runtime knows, or a minimal fallback.
 * Always includes "UTC" — some ICU builds omit the synthetic UTC alias. */
export function listTimeZones(): string[] {
  const zones: string[] =
    typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  // Guarantee UTC is present — certain ICU versions omit the synthetic alias.
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/** The viewer's current device timezone (used for "Automatic"). */
export function detectDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function partValue(
  timeZone: string,
  referenceDate: Date,
  timeZoneName: "long" | "shortOffset",
): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName })
      .formatToParts(referenceDate)
      .find((p) => p.type === "timeZoneName")?.value ?? ""
  );
}

/**
 * Friendly label for a zone, e.g.
 * "New York — Eastern Standard Time (GMT-5)". Offsets/names are computed against
 * `referenceDate` so callers control DST and tests stay deterministic.
 */
export function timezoneLabel(timeZone: string, referenceDate: Date): string {
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  const longName = partValue(timeZone, referenceDate, "long");
  const offset = partValue(timeZone, referenceDate, "shortOffset");
  return longName ? `${city} — ${longName} (${offset})` : `${city} (${offset})`;
}

/**
 * The signed offset (ms) between wall-clock time in `timeZone` and UTC at the
 * given instant — i.e. `wallClock - utc`. Positive east of UTC (e.g. +14h for
 * Kiritimati), negative west (e.g. −8h for Los Angeles in winter). DST-correct
 * because the offset is resolved *at that instant*.
 */
function tzOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const f: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = Number(p.value);
  // Interpret the zone's wall-clock reading as if it were UTC, then diff against
  // the real instant → the zone's offset for that instant.
  const asUtc = Date.UTC(
    f.year,
    f.month - 1,
    f.day,
    f.hour,
    f.minute,
    f.second,
  );
  return asUtc - date.getTime();
}

/**
 * The local calendar day (`YYYY-MM-DD`) an instant falls on in `timeZone`.
 * This is the timezone-correct replacement for `instant.slice(0, 10)` (which
 * buckets by the UTC day). e.g. an entry at `2026-06-15T02:00:00Z` is still
 * June 14 for a UTC−8 user.
 */
export function zonedDayOf(
  instant: string | number | Date,
  timeZone: string,
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  // en-CA renders as YYYY-MM-DD; formatToParts keeps it locale-robust.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The UTC instant of a given wall-clock time on a calendar day in `timeZone`.
 * Inverse of {@link zonedDayOf} for the day component: with `hour = 12` it yields
 * local midday, which round-trips (`zonedDayOf(result, tz) === day`) and is the
 * most tz-shift-robust anchor for storing a manual day-entry as an instant.
 * `hour` may exceed 23 (e.g. `24` → local midnight starting the next day), used
 * to derive an exclusive week-window upper bound.
 *
 * Uses the offset at the naive-UTC guess; correct for any non-transition wall
 * time (midday and midnight never fall inside a DST gap).
 */
export function zonedWallTimeToUtc(
  day: string,
  hour: number,
  timeZone: string,
): Date {
  const [y, m, d] = day.split("-").map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, hour, 0, 0);
  const offset = tzOffsetMs(timeZone, new Date(naiveUtc));
  return new Date(naiveUtc - offset);
}
