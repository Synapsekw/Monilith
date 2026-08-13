import { notFound } from "next/navigation";
import {
  getConversationRunId,
  getMessages,
  toThreadMessages,
} from "@/lib/ai/ask/conversations";
import { createClient } from "@/lib/supabase/server";
import {
  listPendingProposalsForRun,
  type PendingProposal,
} from "@/lib/agents/proposals-db";
import { withResolvedTargets } from "@/lib/agents/proposal-targets";
import { AskChat } from "@/components/ai/ask/AskChat";

/**
 * An existing conversation. First paint loads this thread's messages (bounded,
 * indexed — working agreement #5). RLS returns no rows for a non-owner, so a
 * foreign or missing id 404s. Switching threads from the rail lands here as an
 * RSC navigation that legitimately loads *different* server data.
 *
 * A BRIEFING thread (one an agent run wrote) additionally carries that run's
 * undecided proposals. Without them, the report says "I would have created the
 * item but needed your approval" and there is nothing on the page to approve.
 * The read costs a round trip only for threads that HAVE a `run_id`, and
 * `listPendingProposalsForRun` already excludes expired rows — an Approve
 * button whose only outcome is failure is worse than no button.
 */
export default async function AskConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const [rows, runId] = await Promise.all([
    getMessages(conversationId),
    getConversationRunId(conversationId),
  ]);
  if (rows.length === 0) notFound();

  let proposals: PendingProposal[] = [];
  if (runId) {
    const supabase = await createClient();
    // Degrades rather than 500s: the briefing itself is the point of the page.
    // Same projection AND the same id→name resolution the run-history surface
    // uses, so a card says which item it would act on wherever it appears.
    proposals = await listPendingProposalsForRun(supabase, runId)
      .then((list) => withResolvedTargets(supabase, list))
      .catch((e: unknown) => {
        console.error(`[ask] proposal read failed for run ${runId}`, e);
        return [];
      });
  }

  // `toThreadMessages` is shared with `recoverConversation`, so a stream that
  // dropped mid-turn recovers to exactly what this reload would have rendered —
  // including an unconfirmed proposal, which survives in tool_trace rather than
  // client state (Approve re-reads it server-side).
  return (
    <AskChat
      conversationId={conversationId}
      initialMessages={toThreadMessages(rows)}
      agentProposals={proposals}
    />
  );
}
