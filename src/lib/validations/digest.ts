import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);

/** One row of _org_health_digest, camelCased. */
export const digestBoardRowSchema = z.object({
  boardId: uuid,
  boardName: z.string().min(1).max(255),
  totalItems: count,
  doneItems: count,
  overdueItems: count,
  incompleteItems: count,
  newItems: count,
  newSample: z.array(z.string().max(255)).max(5),
  incompleteSample: z.array(z.string().max(255)).max(5),
});
export type DigestBoardRow = z.infer<typeof digestBoardRowSchema>;

/** notifications.payload for kind = 'health_digest'. */
export const digestNotificationPayloadSchema = z.object({
  newCount: count,
  incompleteCount: count,
  overdueCount: count,
  periodStart: isoDate,
});
export type DigestNotificationPayload = z.infer<
  typeof digestNotificationPayloadSchema
>;
