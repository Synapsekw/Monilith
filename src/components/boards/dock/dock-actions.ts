"use server";

import { requireUser } from "@/lib/auth/session";
import {
  listBoardThreads,
  listAgentThreads,
  type BoardThreadRow,
} from "@/lib/ai/ask/board-threads";
import { recoverConversation } from "@/lib/ai/ask/conversation-actions";
import type { ThreadMessage } from "@/lib/ai/ask/conversations";
import { type ActionResult, fail } from "@/lib/actions/result";

/**
 * The dock's ONE fetch, issued on first open and never on first paint. Both
 * reads are bounded over indexed columns and run in parallel — neither depends
 * on the other.
 *
 * `requireUser()` sits OUTSIDE the try: it redirects, and redirect() works by
 * throwing a sentinel that Next.js must see. Swallowing it into `fail()` would
 * turn a signed-out session into a silent "Couldn't load threads."
 */
export async function loadDockThreads(input: {
  boardId: string;
}): Promise<
  ActionResult<{ board: BoardThreadRow[]; agent: BoardThreadRow[] }>
> {
  const user = await requireUser();
  try {
    const [board, agent] = await Promise.all([
      listBoardThreads(input.boardId),
      listAgentThreads(user.id),
    ]);
    return { ok: true, data: { board, agent } };
  } catch {
    return fail("Couldn't load threads.");
  }
}

/**
 * Read one thread's messages when the dock switches to it.
 *
 * `recoverConversation` already performs exactly this read — bounded, indexed,
 * RLS-scoped, and mapped the same way first paint maps it — so this delegates
 * rather than opening a second query with its own drift.
 *
 * Deliberately an explicit async wrapper rather than
 * `export { recoverConversation as loadThreadMessages }`: a `"use server"`
 * module may only export async functions, and a re-export passes typecheck,
 * lint and test before failing `next build` alone.
 */
export async function loadThreadMessages(input: {
  conversationId: string;
}): Promise<ActionResult<{ messages: ThreadMessage[] }>> {
  return recoverConversation(input);
}
