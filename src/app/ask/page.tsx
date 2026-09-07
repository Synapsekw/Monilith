import { requireUser } from "@/lib/auth/session";
import { listOwnerAgentTargets } from "@/lib/ai/ask/owner-agents";
import { AskChat } from "@/components/ai/ask/AskChat";

/**
 * New-chat entry: an empty composer. The conversation row is minted on first
 * send (createConversation), then the URL is rewritten client-side.
 *
 * It also loads the owner's agents, so the first message can ADDRESS one by
 * `@handle` and the header chip has something to switch to. The persona is NOT
 * frozen at mint time: `ai_conversations.agent_id` is rewritten by the header
 * switcher (`setConversationAgent`) and by any later turn that leads with a
 * handle, so a thread can change hands as often as the owner likes. One
 * bounded, indexed read on first paint (working agreement #5): the picker then
 * filters in the browser, and typing a handle costs no round-trip. Dynamic,
 * cookie-bound reads stream behind the layout's Suspense boundary (Cache
 * Components).
 */
export default async function NewAskPage() {
  const user = await requireUser();
  const agents = await listOwnerAgentTargets(user.id);
  return (
    <AskChat
      conversationId={null}
      initialMessages={[]}
      agents={agents}
      title="New chat"
    />
  );
}
