import type { AgentMentionTarget } from "@/lib/collaboration/mentions";

/**
 * The handle charset, mirroring `user_agents_handle_shape` (see
 * `src/lib/agents/handle.ts` · HANDLE_RE): lowercase letters, digits and
 * dashes, first character alphanumeric. Matching the real shape is what makes
 * "@ops," and "@ops?" address Ops — the punctuation simply is not part of a
 * handle.
 *
 * Free of `server-only` on purpose: the composer needs the same answer the
 * server will reach, so the helper line can name who will actually answer.
 */
const LEADING_HANDLE = /^@([a-z0-9][a-z0-9-]*)/i;

/** The handle that LEADS the text, lowercased, or null. Leading, not anywhere:
 *  "@ops what slipped?" addresses Ops; "ask @ops later" is a sentence that
 *  happens to name one. */
export function leadingHandle(text: string): string | null {
  const match = LEADING_HANDLE.exec(text.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Who answers this turn.
 *
 * STICKY: a turn with no leading handle inherits the thread's current persona,
 * so a conversation with an agent stays a conversation with that agent. A
 * handle nobody owns also inherits — the question is still a perfectly good
 * question, and erroring on a typo would be worse than answering it.
 *
 * `switched` is what tells the caller to rewrite `ai_conversations.agent_id`;
 * re-addressing the agent already on duty is deliberately NOT a switch, so a
 * habitual "@ops …" costs no write.
 *
 * PURE. The roster it is given decides everything, which is what lets the
 * server hand it an RLS-scoped roster and ignore whatever the client believed.
 */
export function resolveAddressedAgent(args: {
  text: string;
  roster: readonly AgentMentionTarget[];
  currentAgentId: string | null;
}): { agentId: string | null; switched: boolean } {
  const handle = leadingHandle(args.text);
  if (!handle) return { agentId: args.currentAgentId, switched: false };
  const hit = args.roster.find((a) => a.handle.toLowerCase() === handle);
  if (!hit) return { agentId: args.currentAgentId, switched: false };
  return {
    agentId: hit.agentId,
    switched: hit.agentId !== args.currentAgentId,
  };
}
