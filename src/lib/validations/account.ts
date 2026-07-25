import { z } from "zod";

/**
 * The typed confirmation from the delete-account dialog. The value is re-verified
 * server-side against the session's own email — the client-side match is only an
 * accident guard, never the authorization.
 */
export const deleteAccountSchema = z.object({
  confirmEmail: z
    .string()
    .trim()
    .min(1, "Enter your email address to confirm."),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

/**
 * Shape of `user_delete_reassign_authorship()`'s `jsonb` return. The generated
 * type is the opaque `Json` union, so this is the boundary where it becomes
 * usable: `counts` is per-table row counts for the audit metadata, `targets` maps
 * each affected `org_id` to the owner who inherited the work (used to notify them).
 *
 * Lenient on purpose — a future column added to `counts` must not make deletion
 * fail after the reassignment has already committed.
 */
export const reassignmentSummarySchema = z.object({
  counts: z.record(z.string(), z.number()).default({}),
  targets: z.record(z.string(), z.string().uuid()).default({}),
});

export type ReassignmentSummary = z.infer<typeof reassignmentSummarySchema>;

/**
 * Payload of the `account_deleted` notification (decision D4) — what the receiving
 * owner is told. Parsed at render time rather than joined, the same way
 * `digestNotificationPayloadSchema` works, because the actor is gone and there is
 * nothing left to join to.
 */
export const accountDeletedNotificationPayloadSchema = z.object({
  deletedEmail: z.string().nullable(),
  counts: z.record(z.string(), z.number()).default({}),
});

export type AccountDeletedNotificationPayload = z.infer<
  typeof accountDeletedNotificationPayloadSchema
>;
