import { requireUser } from "@/lib/auth/session";
import { listOwnerAgentTargets } from "@/lib/ai/ask/owner-agents";
import { createClient } from "@/lib/supabase/server";
import { getFolderHead, type FolderHead } from "@/lib/folders/queries";
import { folderIdSchema } from "@/lib/validations/folders";
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
 *
 * `?folder=<id>` scopes the first message to that folder's boards — the
 * folder head is one indexed read, RLS-filtered, and a hidden folder falls
 * back to a plain chat.
 */
export default async function NewAskPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string | string[] }>;
}) {
  const user = await requireUser();
  const raw = (await searchParams).folder;
  const parsed = folderIdSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  const [agents, head] = await Promise.all([
    listOwnerAgentTargets(user.id),
    parsed.success ? readFolderHead(parsed.data) : Promise.resolve(null),
  ]);
  return (
    <AskChat
      conversationId={null}
      initialMessages={[]}
      agents={agents}
      folderId={head?.folder.id}
      title={head ? `Ask about ${head.folder.name}` : "New chat"}
    />
  );
}

/**
 * A folder that has since gone away — deleted, or RLS no longer lets this
 * caller see it — must never fail this page; it degrades to a plain "New
 * chat" instead of leaking a Postgres error to the entry point of the whole
 * Ask surface.
 */
async function readFolderHead(folderId: string): Promise<FolderHead | null> {
  try {
    const supabase = await createClient();
    return await getFolderHead(supabase, folderId);
  } catch {
    return null;
  }
}
