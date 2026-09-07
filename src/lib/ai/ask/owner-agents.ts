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

/**
 * Names for agents a thread's turns were ALREADY answered by — including agents
 * that have since been disabled.
 *
 * Deliberately NOT filtered on `enabled`, and deliberately separate from
 * `listOwnerAgentTargets`: routing and the switcher must only ever offer an
 * enabled agent (spec §1), but disabling an agent must not silently re-label
 * every answer it already gave as "Monolith". This is a lookup table for
 * history, never a roster.
 *
 * Bounded and indexed (working agreement #5): the ids come from one thread's
 * capped message page and are de-duplicated before the read, which is a
 * primary-key `in` over at most `ASK_AGENTS_LIMIT` rows. RLS scopes it to
 * the owner. Never throws — an unnamed turn falls back to "Monolith", which is
 * exactly what it did before this read existed.
 */
export async function listAgentNamesByIds(
  agentIds: readonly string[],
): Promise<Record<string, string>> {
  const ids = [...new Set(agentIds)].slice(0, ASK_AGENTS_LIMIT);
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_agents")
    .select("id, name")
    .in("id", ids)
    .limit(ASK_AGENTS_LIMIT);
  if (error) {
    console.error("[ask] agent name read failed", error);
    return {};
  }
  return Object.fromEntries((data ?? []).map((a) => [a.id, a.name]));
}
