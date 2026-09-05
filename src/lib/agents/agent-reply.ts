import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import { getPlatformAgentUserId } from "@/lib/ai/agentic/board-agents-db";

/** How much of an agent's report is posted as a comment. The same ceiling the
 *  human comment schema uses (`collaboration-actions.ts`'s TEXT), so an agent
 *  cannot write a comment no person could have written. */
export const AGENT_REPLY_MAX_CHARS = 10_000;

/**
 * The visible attribution line. Server-composed from the agent row — never
 * from model output — so the model cannot choose who its comment appears to be
 * from. Exported because the test that proves a reply reads as a bot's asserts
 * against this exact shape.
 */
export function agentReplyBodyText(args: {
  agentName: string;
  agentHandle: string;
  text: string;
}): string {
  const trimmed = args.text.trim();
  const capped =
    trimmed.length > AGENT_REPLY_MAX_CHARS
      ? `${trimmed.slice(0, AGENT_REPLY_MAX_CHARS)}\n… (truncated)`
      : trimmed;
  return `${args.agentName} (@${args.agentHandle}): ${capped}`;
}

/**
 * Post a summoned agent's answer back onto the item, and tell its owner.
 *
 * ## WHY THIS CANNOT START ANOTHER RUN
 *
 * A reply loop — agent answers, its answer mentions a handle, that summons
 * another run — is the obvious failure mode of this feature. Three independent
 * things stop it, and the first alone is sufficient:
 *
 * 1. **The trigger is not here.** The `@handle` trigger lives in ONE place,
 *    `addUpdate` in `src/lib/collaboration/actions.ts`. This function inserts
 *    into `item_updates` directly with the service client and never calls it,
 *    so no code path from an agent's reply reaches a claim at all.
 * 2. **`mentions` is `[]`, always.** Even if some future writer routed this
 *    through `addUpdate`, the trigger reads the TAGGED `mentions` array, not
 *    the prose. Nothing parses `@handle` out of text anywhere in the app —
 *    `renderBody` in `UpdatesTab` only ACCENTS known labels for display — so an
 *    answer containing the literal "@ops" carries no target and summons
 *    nothing.
 * 3. **The cooldown.** `agent_run_claim` refuses a second `mention` claim for
 *    the same agent inside five minutes, so even a hypothetical loop would
 *    stop at one iteration per agent per five minutes rather than run away.
 *
 * ## WHY IT CANNOT BE MISTAKEN FOR A PERSON
 *
 * `author_id` is the PLATFORM BOT (`platform_agent_user_id()`), the same
 * truthful author autopilot's comments use — never the human who summoned the
 * agent, and never a real member, so no profile row can render it as a
 * teammate. The body additionally opens with a server-composed
 * `Name (@handle): ` line, which travels with the text into every surface that
 * reads `body_text` (the activity feed, thread summaries, search), and `body`
 * carries a structured `agent` marker for the UI to badge.
 *
 * BEST EFFORT throughout: the run already succeeded and its report is already
 * on the run row, so a failed comment or notification is logged, never thrown.
 */
export async function postAgentReply(
  svc: SupabaseClient<Database>,
  args: {
    runId: string;
    itemId: string;
    agentName: string;
    agentHandle: string;
    text: string;
  },
): Promise<void> {
  try {
    const body_text = agentReplyBodyText(args);

    // org/board are denormalised on `item_updates`; derive them from the item,
    // by primary key.
    const { data: item, error: itemErr } = await svc
      .from("items")
      .select("org_id, board_id")
      .eq("id", args.itemId)
      .maybeSingle();
    if (itemErr || !item) {
      console.error("[agents] agent reply: item not found", {
        runId: args.runId,
        itemId: args.itemId,
        cause: itemErr?.message,
      });
      return;
    }

    const bot = await getPlatformAgentUserId(svc);
    if (!bot) {
      console.error("[agents] agent reply: no platform bot user", {
        runId: args.runId,
      });
      return;
    }

    const { data: update, error: updErr } = await svc
      .from("item_updates")
      .insert({
        org_id: item.org_id,
        board_id: item.board_id,
        item_id: args.itemId,
        author_id: bot,
        body: {
          text: body_text,
          // EMPTY, unconditionally — see "why this cannot start another run".
          mentions: [],
          agent: {
            name: args.agentName,
            handle: args.agentHandle,
            runId: args.runId,
          },
        } as Json,
        body_text,
      })
      .select("id")
      .maybeSingle();
    if (updErr || !update) {
      console.error("[agents] agent reply: comment insert failed", {
        runId: args.runId,
        itemId: args.itemId,
        cause: updErr?.message,
      });
      return;
    }

    // The recipient is the run's OWNER — the person who summoned it. Read off
    // the run row rather than taken from the caller so the notification can
    // never be addressed to anyone but the agent's owner.
    const { data: run, error: runErr } = await svc
      .from("user_agent_runs")
      .select("owner_id, org_id")
      .eq("id", args.runId)
      .maybeSingle();
    if (runErr || !run) {
      console.error("[agents] agent reply: run row not found for notify", {
        runId: args.runId,
        cause: runErr?.message,
      });
      return;
    }

    const { error: notifErr } = await svc.from("notifications").insert({
      org_id: run.org_id,
      recipient_id: run.owner_id,
      // No actor: the author is the platform bot, not a member, and a null
      // actor is how every system notification in this app is already shaped.
      actor_id: null,
      kind: "agent_reply",
      board_id: item.board_id,
      item_id: args.itemId,
      update_id: update.id,
      payload: {
        agentName: args.agentName,
        agentHandle: args.agentHandle,
      } as Json,
    });
    if (notifErr)
      console.error("[agents] agent reply: notification insert failed", {
        runId: args.runId,
        cause: notifErr.message,
      });
  } catch (e) {
    console.error("[agents] agent reply failed:", {
      runId: args.runId,
      itemId: args.itemId,
      cause: e instanceof Error ? e.message : String(e),
    });
  }
}
