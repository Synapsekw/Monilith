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

export const updateOrgNameSchema = z.object({
  orgId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name is too long"),
});
export type UpdateOrgNameInput = z.infer<typeof updateOrgNameSchema>;

export const leaveOrgSchema = z.object({ orgId: z.string().uuid() });
export type LeaveOrgInput = z.infer<typeof leaveOrgSchema>;
