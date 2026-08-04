import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** Postgres unique_violation — here, the ai_conversations_run_id_key index. */
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Persist a run's briefing as a thread the owner can reply into.
 *
 * Written through the OWNER client, never the service client: the agent stays a
 * non-privileged principal whose writes are bounded by its owner's RLS, exactly
 * as its reads are.
 *
 * `board_id` is null by construction — a briefing reads every board its owner
 * can see, so it belongs to no single board and appears under the dock's "From
 * your agents" group rather than "This board".
 *
 * NEVER throws. A briefing that reaches its owner without a thread link beats a
 * run that fails because a nice-to-have write failed, so every failure path
 * returns null and the caller carries on to the email.
 */
export async function writeBriefingThread(
  owner: SupabaseClient<Database>,
  args: {
    orgId: string;
    ownerId: string;
    agentId: string;
    agentName: string;
    runId: string;
    fireDate: string;
    summary: string;
  },
): Promise<string | null> {
  try {
    const conv = await owner
      .from("ai_conversations")
      .insert({
        org_id: args.orgId,
        user_id: args.ownerId,
        agent_id: args.agentId,
        run_id: args.runId,
        board_id: null,
        title: `${args.agentName} — ${args.fireDate}`,
        // `visibility` omitted on purpose: the column default 'private' is the
        // guarantee, and a briefing is never shared by default.
      })
      .select("id")
      .single();

    if (conv.error || !conv.data) {
      if (conv.error?.code !== PG_UNIQUE_VIOLATION) {
        console.error("[personal-agent] briefing thread insert failed:", {
          agentId: args.agentId,
          runId: args.runId,
          cause: conv.error?.message,
        });
      }
      return null;
    }

    const msg = await owner.from("ai_messages").insert({
      conversation_id: conv.data.id,
      role: "assistant",
      content: args.summary,
    });
    if (msg.error) {
      console.error("[personal-agent] briefing message insert failed:", {
        conversationId: conv.data.id,
        cause: msg.error.message,
      });
      return null;
    }

    return conv.data.id;
  } catch (e) {
    console.error("[personal-agent] briefing thread write threw:", e);
    return null;
  }
}
