import { requireUser } from "@/lib/auth/session";
import { listChats, listBriefings } from "@/lib/ai/ask/conversations";
import { ConversationRail } from "./ConversationRail";

/**
 * Async data slot for the `/ask` rail — streams behind the layout's Suspense
 * boundary (Cache Components: dynamic, cookie-bound reads must not block the
 * static shell). `requireUser()` also guards the whole `/ask` subtree.
 */
export async function AskRailData() {
  const user = await requireUser();
  // Two bounded, indexed reads issued concurrently — one round-trip's latency
  // for both (working agreement #5).
  const [chats, briefings] = await Promise.all([
    listChats(user.id),
    listBriefings(user.id),
  ]);
  return <ConversationRail chats={chats} briefings={briefings} />;
}
