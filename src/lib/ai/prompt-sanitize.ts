/**
 * Neutralise user-authored text bound for a SINGLE LINE of a prompt: strip
 * newlines (which would let the text start a fresh line the model can read as a
 * new instruction) and angle brackets (which would let it open or close a
 * delimiter block).
 *
 * The ONE copy. It was independently re-declared in three places — the board
 * name in `ai/ask/persona.ts`, the agent name in `ai/ask/agent-knowledge.ts`
 * and the delegate tool's description in `agents/delegate-tool.ts` — each with
 * a comment promising to stay identical to the others. Three private copies is
 * three chances for one of them to be hardened alone, and the copy that was
 * cheapest to reach (an agent NAME, which lands un-delimited in the composed
 * system prompt) was the copy with no test at all.
 *
 * Deliberately free of `server-only`: prompt composition happens server-side,
 * but this is a pure string function and a client surface that wants to preview
 * the same line must reach the same answer.
 *
 * NOT a substitute for delimiting untrusted BLOCKS (documents, memory) — those
 * go through `composeSystemPrompt`'s nonce-keyed markers. This is for the short
 * fields interpolated into prose.
 */
export function sanitizeInline(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "");
}
