import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import {
  getConversationHeader,
  getConversationRunId,
  getMessages,
  toThreadMessages,
} from "@/lib/ai/ask/conversations";
import {
  listAgentNamesByIds,
  listOwnerAgentTargets,
} from "@/lib/ai/ask/owner-agents";
import { createClient } from "@/lib/supabase/server";
import {
  listPendingProposalsForRun,
  type PendingProposal,
} from "@/lib/agents/proposals-db";
import { withResolvedTargets } from "@/lib/agents/proposal-targets";
import { AskChat } from "@/components/ai/ask/AskChat";

/**
 * A briefing thread's undecided proposals, with their targets resolved to
 * names. Never rejects — a failed read is logged and reads as "none", so it can
 * sit in a `Promise.all` without taking the page down with it.
 */
async function loadRunProposals(runId: string): Promise<PendingProposal[]> {
  try {
    const supabase = await createClient();
    const list = await listPendingProposalsForRun(supabase, runId);
    return await withResolvedTargets(supabase, list);
  } catch (e: unknown) {
    console.error(`[ask] proposal read failed for run ${runId}`, e);
    return [];
  }
}

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
 *
 * `agents` and `header` seed the thread header: the owner's roster (for the
 * switcher dropdown) and the thread's real title + who is currently on duty
 * (for the title and the chip), both read once here — `getConversationHeader`
 * is a single indexed row read, not a second round-trip per field — on first
 * paint; AskChat owns the live state and the header's Server Action from
 * there.
 *
 * A shared board thread renders here for every MEMBER of that board
 * (`ai_conversations_select_board_shared`), not only its owner — so the page
 * decides who may WRITE. A non-owner gets the transcript and no switcher, no
 * composer and no Approve/Cancel: every one of those is scoped to the owner by
 * RLS, so offering them moved a chip and changed nothing. The header read
 * carries `ownerId` for exactly this, and a degraded read (null) reads as
 * "not mine", which fails closed on the write affordances rather than open.
 */
export default async function AskConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const user = await requireUser();
  const [rows, runId, agents, header] = await Promise.all([
    getMessages(conversationId),
    getConversationRunId(conversationId),
    listOwnerAgentTargets(user.id),
    getConversationHeader(conversationId),
  ]);
  if (rows.length === 0) notFound();
  const readOnly = header.ownerId !== user.id;

  // Second wave: two branches that each depend only on the first wave, so
  // they run together rather than one after the other.
  //
  // Names for the agents this thread's turns were ALREADY answered by,
  // including any since disabled — `agents` above is enabled-only, so on its
  // own it would relabel a disabled agent's past answers "Monolith". One
  // bounded primary-key read over the ids this page has already loaded, and
  // only when there are any.
  //
  // The proposals branch degrades rather than 500s: the briefing itself is the
  // point of the page. Same projection AND the same id→name resolution the
  // run-history surface uses, so a card says which item it would act on
  // wherever it appears. It resolves to [] without any read for a thread that
  // has no `run_id`.
  const [agentNames, proposals] = await Promise.all([
    listAgentNamesByIds(
      rows.map((r) => r.agent_id).filter((id): id is string => id !== null),
    ),
    runId ? loadRunProposals(runId) : Promise.resolve<PendingProposal[]>([]),
  ]);

  // `toThreadMessages` is shared with `recoverConversation`, so a stream that
  // dropped mid-turn recovers to exactly what this reload would have rendered —
  // including an unconfirmed proposal, which survives in tool_trace rather than
  // client state (Approve re-reads it server-side).
  return (
    <AskChat
      conversationId={conversationId}
      initialMessages={toThreadMessages(rows)}
      agentProposals={proposals}
      agents={agents}
      agentNames={agentNames}
      initialAgentId={header.agentId}
      title={header.title ?? undefined}
      readOnly={readOnly}
    />
  );
}
