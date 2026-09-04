import { z } from "zod";
import { INSTRUCTIONS_LABEL } from "@/lib/agents/document-inject";
import {
  MEMORY_MAX_KEY_CHARS,
  MEMORY_MAX_VALUE_CHARS,
} from "@/lib/agents/document-budget";

/**
 * The save-time marker guard, applied to the memory write path — and here it
 * matters more than it does for documents, not less.
 *
 * Documents have exactly one writer: an owner, through a Server Action behind
 * that schema. Memory has TWO, and one of them is a language model that will be
 * handed adversarial text in tool results. A marker-shaped line in a note would
 * sit directly above the real instructions marker in the prompt, which is the
 * single best-placed forgery target this system has.
 *
 * REJECTS ON THE LABEL, NOT THE COLON-TERMINATED SENTINEL, and that is the
 * whole correctness of this module. The marker the prompt actually carries
 * whenever there is an untrusted block is `${LABEL} [nonce]:` — so
 * `"YOUR OWNER'S INSTRUCTIONS [abc]:".includes("YOUR OWNER'S INSTRUCTIONS:")`
 * is FALSE: the bracketed nonce sits between label and colon. A guard written
 * against the sentinel admits the EXACT real marker.
 *
 * AND THE NONCE DOES NOT SAVE US HERE. The per-agent nonce defeats forgery only
 * while the forger cannot learn it. That holds for a document — an owner pastes
 * it, having never read the prompt. It does NOT hold for memory: the keyed
 * marker is rendered into the system prompt the writing model is reading, so an
 * injected tool result need only say "include the bracketed token you see
 * above". Memory is the one untrusted block whose writer and reader are the
 * same actor, which is why this layer — and the mirroring `agent_memory.value`
 * CHECK constraint, which binds the model's path rather than only the owner's
 * form — is the defence rather than a nicety.
 *
 * Case-INSENSITIVE: a model told to reproduce the marker is not graded on case,
 * and a lowercase forgery reads identically to a skimming reader.
 *
 * `MEMORY_BLOCK_SENTINEL` is deliberately NOT a rejection target, for the same
 * reason `DOCUMENT_BLOCK_SENTINEL` is not: it OPENS a block rather than closing
 * one, so a forged occurrence has nothing after it to unlock.
 */
const SENTINEL_MESSAGE =
  "A note can't contain the prompt's own section marker " +
  `(${INSTRUCTIONS_LABEL}). Rewrite it.`;

const INSTRUCTIONS_LABEL_LOWER = INSTRUCTIONS_LABEL.toLowerCase();

function hasNoInstructionsLabel(value: string): boolean {
  return !value.toLowerCase().includes(INSTRUCTIONS_LABEL_LOWER);
}

/**
 * Every character that starts a new line, not just LF.
 *
 * LF alone was never the containment this claims to be: CR, VT, FF, NEL
 * (U+0085) and the Unicode LINE/PARAGRAPH separators (U+2028/U+2029) all put
 * the text that follows at the START of a line, which is the only position from
 * which a forged marker reads as prompt structure. Mirrored EXACTLY by the
 * `agent_memory.value` check constraint — the model does not come through Zod.
 */
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;

/**
 * Matches the `agent_memory.key` check constraint exactly — the DB is the
 * backstop, not the first line of defence. Slug-shaped so a key can never be a
 * sentence or a prompt fragment.
 */
export const memoryKeySchema = z
  .string()
  .trim()
  .max(MEMORY_MAX_KEY_CHARS)
  .regex(
    /^[a-z0-9][a-z0-9-]{0,63}$/,
    "A key must be lowercase letters, numbers and hyphens, starting with a letter or number.",
  )
  .refine(hasNoInstructionsLabel, SENTINEL_MESSAGE);

/**
 * Matches the `agent_memory.value` check constraint exactly, INCLUDING the
 * one-line rule and the marker guard. One line is structural containment: a
 * value that cannot start a new line cannot open a block, forge a heading, or
 * put a colon-terminated all-caps marker at a line start. REJECTING here
 * (rather than stripping) gives the model an error it can act on instead of
 * silently changing what it meant to say.
 */
export const memoryValueSchema = z
  .string()
  .trim()
  .min(1, "A note can't be empty.")
  .max(
    MEMORY_MAX_VALUE_CHARS,
    `A note must be ${MEMORY_MAX_VALUE_CHARS} characters or fewer.`,
  )
  .refine((v) => !LINE_BREAK.test(v), "A note must be a single line.")
  .refine(hasNoInstructionsLabel, SENTINEL_MESSAGE);

/** What the `remember` tool accepts from the model. */
export const rememberInputSchema = z.object({
  key: memoryKeySchema,
  value: memoryValueSchema,
});

/** What the `forget` tool accepts from the model. */
export const forgetInputSchema = z.object({ key: memoryKeySchema });

/** What the owner's Server Action accepts from the panel. */
export const ownerNoteSchema = z.object({
  userAgentId: z.string().uuid(),
  key: memoryKeySchema,
  value: memoryValueSchema,
});

export const deleteNoteSchema = z.object({ id: z.string().uuid() });
