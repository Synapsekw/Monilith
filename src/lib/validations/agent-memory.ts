import { z } from "zod";
import { INSTRUCTIONS_SENTINEL } from "@/lib/agents/document-inject";
import {
  MEMORY_MAX_KEY_CHARS,
  MEMORY_MAX_VALUE_CHARS,
} from "@/lib/agents/document-budget";

/**
 * The same save-time sentinel guard `agent-documents.ts` mounts, applied to the
 * OTHER write path — and here it matters more, not less.
 *
 * Documents have exactly one writer: an owner, through a Server Action behind
 * that schema. Memory has TWO, and one of them is a language model that will be
 * handed adversarial text in tool results. `INSTRUCTIONS_SENTINEL` in a note
 * would sit directly above the real instructions marker in the prompt, which is
 * the single best-placed forgery target this system has. The per-agent nonce
 * (`document-inject.ts`) defeats exact reconstruction; this removes the
 * SEMANTIC ambiguity of a bare marker-shaped line as well, at the one point it
 * is cheap.
 *
 * `MEMORY_BLOCK_SENTINEL` is deliberately NOT a rejection target, for the same
 * reason `DOCUMENT_BLOCK_SENTINEL` is not: it OPENS a block rather than closing
 * one, so a forged occurrence has nothing after it to unlock.
 */
const SENTINEL_MESSAGE =
  "A note can't contain the prompt's own section marker " +
  `(${INSTRUCTIONS_SENTINEL}). Rewrite it.`;

function hasNoSentinel(value: string): boolean {
  return !value.includes(INSTRUCTIONS_SENTINEL);
}

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
  .refine(hasNoSentinel, SENTINEL_MESSAGE);

/**
 * Matches the `agent_memory.value` check constraint exactly, INCLUDING the
 * no-newline rule. One line is structural containment: a value that cannot
 * contain a newline cannot open a block or forge a heading. REJECTING here
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
  .refine((v) => !v.includes("\n"), "A note must be a single line.")
  .refine(hasNoSentinel, SENTINEL_MESSAGE);

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
