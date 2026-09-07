import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AgentMentionTarget } from "@/lib/collaboration/mentions";

/** Bounded hot-path read (working agreement #5). Nobody addresses a 21st agent
 *  by handle from a picker; an unbounded list would be a scan on a growing
 *  table for a feature that fits in a dropdown. */
export const ASK_AGENTS_LIMIT = 20;

/**
 * The owner's agents, as mention targets for `/ask`'s composer.
 *
 * Read once on first paint so the picker filters in the browser — a keystroke
 * must not cost a round-trip. Scoped by `owner_id` (RLS scopes it too; the
 * explicit filter keeps the read on the owner index) and to `enabled` agents:
 * a disabled agent cannot run, so offering its handle would only produce a
 * thread nobody answers.
 *
 * Never throws. The picker is an accelerant — a typed question still works
 * without it — so a failed read degrades to "no suggestions", not a 500 on the
 * page that holds the whole conversation.
 */
export async function listOwnerAgentTargets(
  userId: string,
): Promise<AgentMentionTarget[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_agents")
    .select("id, handle, name")
    .eq("owner_id", userId)
    .eq("enabled", true)
    .order("name", { ascending: true })
    .limit(ASK_AGENTS_LIMIT);
  if (error) {
    console.error("[ask] agent handle read failed", error);
    return [];
  }
  return (data ?? []).map((a) => ({
    kind: "agent",
    agentId: a.id,
    handle: a.handle,
    name: a.name,
  }));
}
