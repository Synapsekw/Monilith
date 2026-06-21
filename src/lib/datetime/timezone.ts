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
