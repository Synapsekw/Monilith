import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getServerEnv } from "@/lib/env.server";

/** The model that powers AI dashboard generation. Single source of truth. */
export const MODEL = "claude-opus-4-8";

/** Thrown when ANTHROPIC_API_KEY is absent. Actions translate it to a clean
 *  user-facing error rather than a 500. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI generation isn't configured.");
    this.name = "AiNotConfiguredError";
  }
}

/** Build a server-only Anthropic client. Throws AiNotConfiguredError if the key
 *  is missing. Never import this into a client component. */
export function getAnthropicClient(): Anthropic {
  const apiKey = getServerEnv().ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  return new Anthropic({ apiKey });
}
