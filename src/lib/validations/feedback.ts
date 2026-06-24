import { z } from "zod";

export const FEEDBACK_KINDS = ["bug", "feature_request"] as const;
export const FEEDBACK_STATUSES = [
  "new",
  "triaged",
  "planned",
  "in_progress",
  "resolved",
  "declined",
] as const;

export const submitFeedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  title: z.string().trim().min(1, "Add a title").max(120, "Title is too long"),
  body: z.string().trim().min(1, "Add some detail").max(2000, "Too long"),
});
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

export const adminUpdateFeedbackSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(FEEDBACK_STATUSES),
  adminResponse: z.string().trim().max(2000).optional(),
});
export type AdminUpdateFeedbackInput = z.infer<
  typeof adminUpdateFeedbackSchema
>;
