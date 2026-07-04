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

/** Longest display name we persist — generous, but bounds the `profiles` write. */
export const MAX_FULL_NAME_LENGTH = 120;

/**
 * Personal display name. Trimmed at the boundary; an empty (or whitespace-only)
 * value normalizes to `null`, which clears the name and lets every surface fall
 * back to the email. Length is checked on the trimmed value.
 */
export const updateProfileFullNameSchema = z.object({
  fullName: z
    .string()
    .nullable()
    .transform((v) => {
      const trimmed = (v ?? "").trim();
      return trimmed.length > 0 ? trimmed : null;
    })
    .refine((v) => v === null || v.length <= MAX_FULL_NAME_LENGTH, {
      message: `Name must be ${MAX_FULL_NAME_LENGTH} characters or fewer.`,
    }),
});
export type UpdateProfileFullNameInput = z.infer<
  typeof updateProfileFullNameSchema
>;
