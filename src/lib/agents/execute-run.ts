import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import { runAi } from "@/lib/ai/gateway";
import { languageModelFor } from "@/lib/ai/providers/language-model";
import type { UserAgentRow } from "./agents-db";
import {
  buildAgentRuntime,
  runAgentLoop,
  ModelNotToolCapableError,
} from "./run-loop";
import { listDocumentsForAgent } from "./documents-db";
import {
  documentBudget,
  selectDocuments,
  selectMemory,
  estimateTokens,
  ASSUMED_PREFIX_TOKENS,
} from "./document-budget";
import { listMemoryForAgent } from "./memory-db";
import { makeMemoryDescriptors } from "./memory-tools";
import { AGENT_ONLY_DESCRIPTORS } from "./agent-only-tools";
import type { ProposedCall } from "./grant-gate";
import type { AgentCapability } from "./capabilities";
import { insertProposals } from "./proposals-db";
import { summariseProposal } from "./proposal-summary";
import { PersonalAiKeyMissingError, ByoKeyMissingError } from "@/lib/ai/errors";

/**
 * The `ai_usage` feature key every agent run is metered under. Lives here, not
 * in the route, because the route is no longer the only caller: a delegated
 * child run spends the same owner's tokens against the same entitlement, and
 * two literals would let the ledger and the monthly ceiling disagree.
 */
export const AGENT_RUN_FEATURE = "personal_agent_run";

/**
 * What a run achieved SO FAR, mutated in place as it goes.
 *
 * The whole point is the failure path. `executeAgentRun` rejects with the
 * provider's error, taking its return value — and with it the steps, tools and
 * grants the run really got through — down with it. A caller holding this
 * object can still write an honest `user_agent_runs` row for a run that died
 * mid-loop, which is the one run where "what did my agent do to my boards"
 * matters most.
 */
export type RunProgress = {
  /** Model round-trips completed, out of AGENT_MAX_STEPS. */
  steps: number;
  /** The tools that actually EXECUTED (denied calls are not "used"). */
  toolsUsed: string[];
  /** What the run was EFFECTIVELY permitted to do — the agent's own grants
   *  intersected with the org ceiling, as it stood at run time. */
  grants: AgentCapability[];
  /** True when the agent's pinned model was unavailable and runAi fell back. */
  modelSubstituted: boolean;
};

/** The zero value. A run that dies before the loop starts records zeroes and
 *  an empty grant set — not silence. */
export function newRunProgress(): RunProgress {
  return { steps: 0, toolsUsed: [], grants: [], modelSubstituted: false };
}

export type ExecuteRunResult = {
  text: string;
  usage: AiUsageTokens;
  steps: number;
  toolsUsed: string[];
  documentsOmitted: boolean;
  memoryNotesDropped: number;
  /** How many calls the run asked permission for and had queued. Not part of
   *  the audit row — the briefing email's "N actions await your approval" line
   *  is its only consumer, and it must never name rows the insert below did
   *  not write. */
  proposalCount: number;
};

/**
 * ONE agent run: budget → tools → bounded loop → proposals.
 *
 * Lifted verbatim out of `/api/ai/personal-agent/route.ts` so a delegated child
 * run executes the identical path a scheduled run does — same budget
 * arithmetic, same two-key grant gate, same proposal collection. Everything the
 * ROUTE owns stays in the route: the claim, the entitlement and per-user caps,
 * the owner-client resolution, the org ceiling read, the briefing thread, the
 * email, and the `user_agent_runs` finalize. This function deliberately
 * finalizes nothing and sends nothing — the caller's ordering (proposals →
 * thread → email → finalize) is preserved precisely because the only one of
 * those four this owns is the first.
 *
 * It DOES persist proposals, including on its own failure path: the model was
 * told "Recorded for your approval." before the run died and may have said so
 * to the owner in text that is now lost, so the queue must survive the throw.
 */
export async function executeAgentRun(args: {
  svc: SupabaseClient<Database>;
  /** The OWNER's client. Everything the agent sees and does goes through it,
   *  so the owner's RLS remains the real boundary. */
  ownerClient: SupabaseClient<Database>;
  agent: UserAgentRow;
  runId: string;
  /** The org's `agent_capability_ceiling`, read at RUN time by the caller. May
   *  be the module singleton `DEFAULT_ORG_AI_SETTINGS` returns by identity —
   *  never mutated in place here (no push/sort/splice); `.filter` copies. */
  ceiling: AgentCapability[];
  /** Replaces the default "Do your work for today…" user message.
   *  NOT YET FORWARDED: `runAgentLoop` has no `task` parameter until Task 5
   *  adds one. Accepted now so the delegate tool's call site is the shape it
   *  will keep, and so this seam is the only thing Task 5 has to change. */
  task?: string;
  /** Adds the `delegate` descriptor. FALSE for a child run — depth is capped.
   *  THREADED BUT UNUSED in this task: `extra` below is still exactly
   *  `[...AGENT_ONLY_DESCRIPTORS, ...makeMemoryDescriptors(...)]`. Task 5 adds
   *  the `makeDelegateDescriptors` branch that reads it. Not dead code — the
   *  parameter is what lets the depth cap be expressed at every call site
   *  before the tool it gates exists. */
  allowDelegation: boolean;
  /** Mutated after every completed step so a caller's catch can still write an
   *  honest audit row for a run that died mid-loop. */
  progress: RunProgress;
}): Promise<ExecuteRunResult> {
  const { svc, ownerClient, agent, runId, ceiling, progress } = args;

  // The ADMIN half of the two-key gate, applied to THIS agent's grants. The
  // ceiling itself is read by the caller at run time: an admin who lowers it
  // clamps every existing agent at once, without anyone editing them.
  const effectiveGrants: AgentCapability[] = agent.capabilities.filter((c) =>
    ceiling.includes(c),
  );
  // Recorded BEFORE the loop runs: a run that dies at step 1 must still be able
  // to say what it was permitted to do.
  progress.grants = effectiveGrants;

  // A run that dies at step 5 still did whatever steps 1–4 did: granted writes
  // that really landed on the owner's boards, and denied calls the model was
  // already told were "Recorded for your approval." All of that used to be
  // discarded with the rejected promise, leaving `user_agent_runs` unable to
  // answer "what did my agent do to my boards" for the one run where the
  // question matters most.
  const proposals: ProposedCall[] = [];

  /**
   * Persist the run's proposals, at most once.
   *
   * The flag is set BEFORE the await on purpose. The owner's ruling is that a
   * FAILING insert fails the whole run loudly (it throws, the caller records
   * "error", no email) — so a retry from the catch below would be pointless
   * and would mask the original error. What the flag does NOT cover, and what
   * this function exists for, is never REACHING the insert: a provider 5xx or
   * timeout mid-loop used to drop every proposal on the floor while the model
   * had already told the owner they were recorded.
   */
  let proposalsPersisted = false;
  const persistProposals = async (): Promise<void> => {
    if (proposalsPersisted) return;
    proposalsPersisted = true;
    await insertProposals(
      svc,
      proposals.map((p) => ({
        userAgentId: agent.id,
        runId,
        orgId: agent.org_id,
        ownerId: agent.owner_id,
        capability: p.capability,
        toolName: p.toolName,
        toolCallId: p.toolCallId,
        input: p.input,
        // SERVER-derived, never model text — the security property the column's
        // own comment states. `summariseProposal` builds its sentence from the
        // tool input alone, so what the owner approves is a description of what
        // will actually execute. It never throws: a bad shape degrades to
        // `Run <tool>.` rather than failing the whole batch insert.
        summary: summariseProposal(p.toolName, p.input),
      })),
    );
  };

  let result: Awaited<ReturnType<typeof runAgentLoop>>;
  try {
    // Run the bounded tool loop (metered). Two states are CONFIGURATION
    // states, not faults, and the CALLER separates them from the generic error
    // path so they land in `user_agent_runs` as "skipped" with a clear reason:
    //   - PersonalAiKeyMissingError: the owner has no per_user key on file.
    //   - ByoKeyMissingError: the org's org_byo mode has no vault secret.
    // A third — ModelNotToolCapableError — is raised INSIDE the callback (only
    // there is the resolved model known) and is handled the same way: the
    // agent's pinned model, or the org default, cannot call tools, so there is
    // no loop to run. The old ProviderNotCapableError guard is GONE with it:
    // this loop is provider-agnostic (the AI SDK drives it through whichever
    // adapter the key resolved to), so the honest question is no longer "is
    // this Anthropic?" but "can THIS model call tools?", which
    // `ai_models.supports_tools` answers per model. Deliberately NOT special
    // -cased: a plain (non-Personal) AiNotConfiguredError — e.g. `managed`
    // mode's platform ANTHROPIC_API_KEY missing — is an OPERATIONAL fault
    // (nobody but ops can fix it, and it silently kills every briefing in the
    // org every day), so it is recorded as "error", not "skipped".
    result = await runAi(
      {
        orgId: agent.org_id,
        userId: agent.owner_id,
        feature: AGENT_RUN_FEATURE,
        // The per-agent pin. Null on either means "org default", which is
        // exactly what runAi does when they are omitted.
        provider: agent.provider ?? undefined,
        requestedModel: agent.model_id,
        // `runId` (the run↔ledger correlation) belongs here too, but the field
        // does not exist on runAi's args yet — it lands with the gateway
        // change in Task 1 and is threaded through then.
      },
      async ({ adapter, apiKey, baseUrl, model }, reportUsage) => {
        if (!model.supportsTools)
          throw new ModelNotToolCapableError(model.model);
        // Written to the run row by the caller. `user_agent_runs
        // .model_substituted` exists precisely so "your pinned model is gone,
        // this ran on the default" is its own signal instead of being
        // overloaded onto `error` — a substituted run still SUCCEEDED, and
        // recording it as an error would tell the owner their agent is broken
        // when it is not.
        progress.modelSubstituted = model.substituted;

        // Read the agent's attached documents AND its memory here, inside
        // the callback — this is the only place the resolved model (and
        // therefore its real context window) is known.
        // `listDocumentsForAgent`/`listMemoryForAgent` are the one query
        // shape for each read; `documentBudget` divides ONE envelope
        // between them. A second arithmetic here is exactly the drift that
        // module exists to prevent.
        const attached = await listDocumentsForAgent(ownerClient, agent.id);
        const notes = await listMemoryForAgent(ownerClient, agent.id);
        const memoryTokens = notes.reduce((n, m) => n + m.tokenEstimate, 0);

        const { budget, memoryNoteBudget } = documentBudget({
          contextLength: model.contextLength,
          // ASSUMED_PREFIX_TOKENS, imported from document-budget — the
          // attach-time meter uses the identical constant. A local 9_500
          // here would let the two drift, and the meter's whole guarantee
          // is that they cannot.
          prefixTokens: ASSUMED_PREFIX_TOKENS,
          instructionTokens: estimateTokens(agent.instructions),
          memoryTokens,
        });
        const { included, omitted } = selectDocuments(attached, budget);
        // PARTIAL, unlike documents: notes are independent atoms, so the
        // freshest that fit are kept and the tail is dropped and COUNTED.
        // `memoryNoteBudget`, NOT `memoryBudget`: the latter includes the
        // block's own ~100-token framing, which `buildMemoryBlock` emits on
        // top of the lines. Spending it on lines would overrun the envelope
        // the budget was sized against by exactly the framing's length.
        const { included: memory, dropped: memoryNotesDropped } = selectMemory(
          notes,
          memoryNoteBudget,
        );

        // ONE call assembles BOTH halves. `buildAgentTools` and
        // `makeGrantGate` are each a pure function of the same descriptor
        // list, and building them separately is exactly how a tool once
        // ended up executable but unclassified — see buildAgentRuntime.
        const { tools, gate } = buildAgentRuntime({
          ctx: {
            getClient: async () => ownerClient,
            actorId: agent.owner_id,
          },
          scope: agent.board_scope,
          client: ownerClient,
          // The SAME array reaches `buildAgentTools` and `makeGrantGate` —
          // `buildAgentRuntime` takes it once precisely so they cannot
          // disagree. The memory descriptors are built PER RUN because they
          // close over this agent's id and this run's id; neither is in
          // `ToolInvokeContext`, and taking them from model input would be
          // a cross-agent write primitive.
          extra: [
            ...AGENT_ONLY_DESCRIPTORS,
            ...makeMemoryDescriptors({
              userAgentId: agent.id,
              runId,
            }),
          ],
          granted: effectiveGrants,
          ceiling,
          // Collected, not written through per call: `insertProposals` is
          // one bounded insert for the whole run, and the run is the unit
          // that either produced these or died trying. The error path
          // persists them too — see `persistProposals`.
          onPropose: (call) => proposals.push(call),
        });

        const r = await runAgentLoop({
          // The WIRE id, never the catalog key the pin stores: the Gateway
          // publishes `claude-haiku-4.5` where Anthropic's API wants the
          // dated snapshot, and sending the key is a 404.
          model: languageModelFor({
            kind: adapter.kind,
            apiKey,
            baseUrl,
            model: model.requestModel,
          }),
          instructions: agent.instructions,
          // This agent's own stable secret — keys the instructions
          // delimiter (document-inject.ts) whenever `documents` is
          // non-empty, so a document body forging the literal
          // `INSTRUCTIONS_SENTINEL` can't reproduce the real marker.
          // Spec 2c widened that predicate to ANY untrusted block, so this
          // is load-bearing for an agent with memory and no documents too.
          nonce: agent.doc_nonce,
          documents: included,
          documentsOmitted: omitted,
          memory,
          memoryNotesDropped,
          tools,
          gate,
          // No per-run output ceiling: the loop is bounded by
          // AGENT_MAX_STEPS, and a token cap that truncates mid-report
          // emails a half-sentence. The seam stays for when the catalog's
          // per-model `max_output_tokens` is threaded through.
          maxOutputTokens: null,
          // The audit trail for a run that dies mid-loop. Without this, a
          // throw at step 5 discards everything steps 1–4 did — including
          // the tokens those steps really spent, which `reportUsage` hands
          // to `runAi` so its catch can still write the ledger row. Steps
          // 1–11 of a run that dies at step 12 are real, billed provider
          // round-trips; metering only on success spends managed-mode money
          // against no ledger row and under-counts the monthly ceiling.
          onStep: ({ steps, toolsUsed, usage }) => {
            progress.steps = steps;
            progress.toolsUsed = toolsUsed;
            reportUsage(usage);
          },
        });
        return { result: r, usage: r.usage };
      },
    );
  } catch (e) {
    // The three CONFIGURATION states rethrow untouched, with no proposal
    // write: each is raised before the tool loop exists, so there is nothing
    // queued, and the caller answers them with an early "skipped" return
    // rather than the generic error path.
    if (
      e instanceof PersonalAiKeyMissingError ||
      e instanceof ByoKeyMissingError ||
      e instanceof ModelNotToolCapableError
    ) {
      throw e;
    }
    // The model was told "Recorded for your approval." before this run died,
    // and may have said so to the owner in text that is now lost. Queueing the
    // proposals anyway keeps that promise: the owner finds them under the
    // failed run and can still approve them. BEST EFFORT here and only here —
    // we are already on the failure path, so a second failure must be logged
    // rather than thrown, or it would replace the real cause of the run's
    // death with a bookkeeping error.
    try {
      await persistProposals();
    } catch (pe) {
      console.error("[personal-agent] proposal persist on error path failed:", {
        agentId: agent.id,
        runId,
        proposals: proposals.length,
        cause: pe instanceof Error ? pe.message : String(pe),
      });
    }
    throw e;
  }

  // Persist what the agent asked permission for. BEFORE the caller's email, so
  // the "N actions await your approval" line can never name rows that do not
  // exist yet. `insertProposals` stamps `status` and `expires_at`
  // (now + PROPOSAL_TTL_DAYS) itself — no caller can queue a proposal that is
  // born approved or born immortal. A failure here throws, by design: it
  // reaches the caller as a loud "error" run rather than an email promising
  // approvals that were never queued.
  await persistProposals();

  return { ...result, proposalCount: proposals.length };
}
