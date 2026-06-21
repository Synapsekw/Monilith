import { z } from "zod";
import { isValidTimeZone } from "@/lib/validations/org";

/**
 * Personal display timezone. A non-null value must be a runtime-valid IANA id;
 * `null` means "Automatic" (use the viewer's device zone). Reuses the same
 * `isValidTimeZone` runtime check as the org timezone schema.
 */
export const updateProfileTimezoneSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone").nullable(),
});
export type UpdateProfileTimezoneInput = z.infer<
  typeof updateProfileTimezoneSchema
>;
