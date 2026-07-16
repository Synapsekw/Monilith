import { requireUser } from "@/lib/auth/session";
import { listConversations } from "@/lib/ai/ask/conversations";
import { ConversationRail } from "./ConversationRail";

/**
 * Async data slot for the `/ask` rail — streams behind the layout's Suspense
 * boundary (Cache Components: dynamic, cookie-bound reads must not block the
 * static shell). `requireUser()` also guards the whole `/ask` subtree.
 */
export async function AskRailData() {
  const user = await requireUser();
  const conversations = await listConversations(user.id);
  return <ConversationRail conversations={conversations} />;
}
