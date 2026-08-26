import { z } from "zod";
import type { SourceFormat } from "@/lib/documents/extract-text";
import { INSTRUCTIONS_SENTINEL } from "@/lib/agents/document-inject";

/**
 * Kept in lockstep with `SourceFormat` (src/lib/documents/extract-text.ts).
 *
 * `satisfies` alone only catches SHRINKAGE — every literal listed here must
 * still be a `SourceFormat`. It says nothing about GROWTH: adding a member to
 * `SourceFormat` and forgetting it here would typecheck fine and silently
 * reject the new format at the boundary. `_SourceFormatsAreExhaustive` closes
 * that direction — it is a compile error (`false` does not satisfy the `true`
 * constraint) the moment a `SourceFormat` member is missing from this array.
 */
export const SOURCE_FORMATS = [
  "pasted",
  "markdown",
  "text",
  "pdf",
  "docx",
  "xlsx",
] as const satisfies readonly SourceFormat[];

type AssertTrue<T extends true> = T;
// A compile-time assertion has no runtime form — the type alias IS the check,
// and it is "unused" by construction.
type _SourceFormatsAreExhaustive = AssertTrue<
  [SourceFormat] extends [(typeof SOURCE_FORMATS)[number]] ? true : false
>;

/**
 * A document body may not forge the prompt's own instructions delimiter.
 *
 * `document-inject.ts` composes the system prompt as
 * `PREAMBLE / REFERENCE DOCUMENTS … / YOUR OWNER'S INSTRUCTIONS: …`, and
 * documents are composed BEFORE the instructions sentinel. A body containing
 * that sentinel therefore closes the reference block and everything after it
 * reads to the model as owner-authored instruction — the design's stated threat
 * model, "a document pasted from an untrusted source".
 *
 * Only `INSTRUCTIONS_SENTINEL` is checked here — `DOCUMENT_BLOCK_SENTINEL`
 * (the literal "REFERENCE DOCUMENTS") is deliberately NOT rejected. It opens
 * the reference block rather than closing it, so a forged occurrence in a
 * document body has nothing after it to unlock — it buys no real security.
 * It's also a completely standard all-caps section heading in SOP/ISO/RFP-style
 * documents, which is exactly the corpus this feature exists to ingest;
 * rejecting it was a false positive against the feature's own target content.
 *
 * WHY REJECT AT SAVE TIME rather than nonce the delimiter per run: a random
 * nonce in the delimiter would work, but it changes the system-prompt prefix
 * on every run for every agent that has documents, which destroys Anthropic
 * prompt-cache reuse for exactly the agents whose prompts are longest and most
 * expensive to re-read. Rejecting the sentinel at the one boundary through
 * which text can enter the library costs nothing at run time, keeps the
 * no-documents prompt byte-identical (the cache guarantee for every existing
 * agent), and gives the owner an immediate, fixable error instead of a silent
 * downgrade. The trade-off is that it is a boundary check, not a rendering
 * escape: it binds only text saved through this schema — which is the only way
 * `agent_documents` rows are ever written by an authenticated caller.
 */
const SENTINEL_MESSAGE =
  "A document can't contain the prompt's own section marker " +
  `(${INSTRUCTIONS_SENTINEL}). Rename or remove that line.`;

function hasNoSentinel(value: string): boolean {
  return !value.includes(INSTRUCTIONS_SENTINEL);
}

/** Matches the column check constraints exactly — the DB is the backstop, not
 *  the first line of defence. */
export const documentInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give it a title.")
    .max(200)
    .refine(hasNoSentinel, SENTINEL_MESSAGE),
  body: z
    .string()
    .min(1, "A document can't be empty.")
    .max(2_000_000)
    .refine(hasNoSentinel, SENTINEL_MESSAGE),
  sourceFormat: z.enum(SOURCE_FORMATS),
  sourceFileName: z.string().max(255).nullable().default(null),
});

export const documentUpdateSchema = documentInputSchema
  .partial({ sourceFormat: true, sourceFileName: true })
  .extend({ id: z.string().uuid() });

export const setAgentDocumentsSchema = z.object({
  userAgentId: z.string().uuid(),
  // DEDUPED here, before it reaches the DB. A repeated id trips
  // `user_agent_documents`' composite primary key, which — before
  // `replace_agent_documents` made the swap atomic — took the agent's whole
  // prior attachment set down with it. `.max(50)` is checked on the RAW array
  // so the cap can't be evaded by padding it with duplicates.
  documentIds: z
    .array(z.string().uuid())
    .max(50)
    .transform((ids) => [...new Set(ids)]),
});
