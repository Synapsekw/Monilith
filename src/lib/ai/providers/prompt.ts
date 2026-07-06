import { PROPOSAL_JSON_SCHEMA } from "@/lib/ai/proposal-schema";

/**
 * Appends the proposal JSON Schema to a user prompt for providers that use JSON
 * mode rather than native structured output (OpenAI, Gemini). The model output
 * is repaired by validateProposal() downstream, so schema drift is tolerated.
 */
export function withSchema(user: string): string {
  return `${user}\n\nReturn ONLY a JSON object matching this JSON Schema (no prose):\n${JSON.stringify(
    PROPOSAL_JSON_SCHEMA,
  )}`;
}
