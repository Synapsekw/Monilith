import { z } from "zod";

/** True when `tz` is an IANA timezone the runtime recognizes. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    // Throws RangeError for unknown zones.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const updateOrgTimezoneSchema = z.object({
  orgId: z.string().uuid(),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone"),
});
export type UpdateOrgTimezoneInput = z.infer<typeof updateOrgTimezoneSchema>;
