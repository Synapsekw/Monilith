import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import { listDocumentsForAgent } from "@/lib/agents/documents-db";
import { listMemoryForAgent } from "@/lib/agents/memory-db";
import {
  ASSUMED_PREFIX_TOKENS,
  documentBudget,
  estimateTokens,
  selectDocuments,
  selectMemory,
} from "@/lib/agents/document-budget";
import {
  buildDocumentBlock,
  buildMemoryBlock,
  composeSystemPrompt,
} from "@/lib/agents/document-inject";

/**
 * The system prompt for a chat turn answered BY AN AGENT.
 *
 * It goes through the SAME path a scheduled run uses — `documentBudget` divides
 * one envelope between documents and memory, `selectDocuments` is
 * all-or-nothing, `selectMemory` keeps the freshest that fit, and
 * `composeSystemPrompt` keys the instructions marker with the agent's stable
 * `doc_nonce` whenever either untrusted block is present. A second arithmetic
 * here is exactly the drift `document-budget.ts` exists to prevent.
 *
 * READ-ONLY by design: no `agent_remember`/`agent_forget` descriptors are added
 * anywhere on this path. Memory is the one untrusted block whose writer and
 * reader are the same actor, and opening that on an interactive surface is its
 * own spec.
 *
 * Called INSIDE the `runAi` callback, because that is the only place the
 * resolved model — and therefore its real context window — is known
 * (`execute-run.ts` does the same, for the same reason).
 *
 * NEVER throws. A knowledge read that fails degrades to instructions-only: an
 * agent answering with less context beats a turn that fails outright.
 */
export async function composeAgentChatSystem(args: {
  client: SupabaseClient<Database>;
  preamble: string;
  agent: { id: string; name: string; instructions: string; docNonce: string };
  contextLength: number | null;
}): Promise<string> {
  const named = [
    args.preamble,
    "",
    `You are answering as the user's personal agent "${sanitizeInline(args.agent.name)}".`,
  ].join("\n");

  let documentBlock = "";
  let memoryBlock = "";
  try {
    const [attached, notes] = await Promise.all([
      listDocumentsForAgent(args.client, args.agent.id),
      listMemoryForAgent(args.client, args.agent.id),
    ]);
    const memoryTokens = notes.reduce((n, m) => n + m.tokenEstimate, 0);
    const { budget, memoryNoteBudget } = documentBudget({
      contextLength: args.contextLength,
      prefixTokens: ASSUMED_PREFIX_TOKENS,
      instructionTokens: estimateTokens(args.agent.instructions),
      memoryTokens,
    });
    documentBlock = buildDocumentBlock(
      selectDocuments(attached, budget).included,
    );
    memoryBlock = buildMemoryBlock(
      selectMemory(notes, memoryNoteBudget).included,
    );
  } catch (e) {
    console.error(`[ask] agent knowledge read failed for ${args.agent.id}`, e);
  }

  return composeSystemPrompt({
    preamble: named,
    documentBlock,
    memoryBlock,
    instructions: args.agent.instructions,
    nonce: args.agent.docNonce,
  });
}
