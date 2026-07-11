export { AiNotConfiguredError } from "@/lib/ai/anthropic";

/** org_ai_settings.ai_mode = 'off'. */
export class AiDisabledError extends Error {
  constructor() {
    super("AI is turned off for this organization.");
    this.name = "AiDisabledError";
  }
}

/** ai_mode = 'org_byo' but no org secret stored. */
export class ByoKeyMissingError extends Error {
  constructor() {
    super("This organization's AI key is missing.");
    this.name = "ByoKeyMissingError";
  }
}

/** Managed org exhausted its monthly credit allowance. */
export class AiQuotaExceededError extends Error {
  constructor() {
    super("This month's AI allowance is used up.");
    this.name = "AiQuotaExceededError";
  }
}

/** Resolved provider can't run this feature (e.g. tool use needs Anthropic). */
export class ProviderNotCapableError extends Error {
  constructor(public readonly feature: string) {
    super(`The configured AI provider can't run ${feature}.`);
    this.name = "ProviderNotCapableError";
  }
}
