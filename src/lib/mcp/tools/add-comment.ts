import * as z from "zod";
import { addUpdateCore } from "@/lib/collaboration/update-core";
import { addUpdateSchema } from "@/lib/validations/collaboration-actions";
import {
  toToolResult,
  withoutNulls,
  type GetClient,
  type ToolResult,
} from "./shared";
import type { ToolDescriptor } from "./descriptor";

/** Shorter than the app's own 10,000: a tool-written comment is a status
 *  note, and a model must not be able to flood a thread. */
export const COMMENT_MAX_CHARS = 2000;
/** Each mention sends one notification; `addUpdateSchema` allows 20. */
export const COMMENT_MAX_MENTIONS = 10;

const input = {
  itemId: z.string().uuid(),
  text: z.string().trim().min(1).max(COMMENT_MAX_CHARS),
  mentionUserIds: z
    .array(z.string().uuid())
    .max(COMMENT_MAX_MENTIONS)
    .nullish(),
};

export type AddCommentArgs = {
  itemId: string;
  text: string;
  mentionUserIds?: string[];
};

/**
 * Post a comment on an item as the connected user.
 *
 * NOT a second write path: it parses into the app's own `addUpdateSchema` and
 * calls `addUpdateCore`, the function the `addUpdate` Server Action calls. So
 * the item read, the Mono mention rule, the `item_updates` insert (RLS decides
 * who may comment) and the mention notifications are the same code on every
 * path, and the comment's author is the caller.
 */
export async function addCommentHandler(
  getClient: GetClient,
  actorId: string,
  args: AddCommentArgs,
): Promise<ToolResult> {
  // Parsed BEFORE getClient(): a malformed call must not charge the rate limit.
  const parsed = addUpdateSchema.safeParse({
    itemId: args.itemId,
    text: args.text,
    mentions: [...new Set(args.mentionUserIds ?? [])].map((userId) => ({
      kind: "user" as const,
      userId,
    })),
  });
  if (!parsed.success)
    return {
      content: [
        {
          type: "text",
          text: parsed.error.issues[0]?.message ?? "Invalid input.",
        },
      ],
      isError: true,
    };
  const supabase = await getClient();
  try {
    const res = await addUpdateCore(supabase, parsed.data, actorId);
    return toToolResult(
      res.ok
        ? { ok: true, data: { commentId: res.data.updateId, posted: true } }
        : res,
    );
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export const addCommentDescriptor: ToolDescriptor = {
  name: "add_comment",
  title: "Add comment",
  description: `Post a comment (an update) on an item, as the connected user. Plain text, at most ${COMMENT_MAX_CHARS} characters. Pass \`mentionUserIds\` (at most ${COMMENT_MAX_MENTIONS}, user ids from list_people) to notify those people; write their names in the text yourself. Cannot edit or delete a comment.`,
  inputSchema: input,
  capability: "board.write",
  scope: "itemId",
  invoke: (ctx, raw) =>
    addCommentHandler(
      ctx.getClient,
      ctx.actorId,
      withoutNulls(raw) as AddCommentArgs,
    ),
};
