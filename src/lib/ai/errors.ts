/** Thrown when the platform ANTHROPIC_API_KEY is absent. Actions translate it
 *  to a clean user-facing error rather than a 500. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI generation isn't configured.");
    this.name = "AiNotConfiguredError";
  }
}

/**
 * Narrower than AiNotConfiguredError: specifically "the given user has no
 * stored `user_ai_credentials` row" (`ai_mode = 'per_user'`) — as opposed to
 * a platform `ANTHROPIC_API_KEY` misconfiguration (`ai_mode = 'managed'`),
 * which stays a plain AiNotConfiguredError. Extends AiNotConfiguredError so
 * every existing `instanceof AiNotConfiguredError` catch (mapAiError, the
 * interactive action call sites) still matches unchanged for BOTH causes —
 * this only adds a strictly narrower check for unattended callers (like the
 * personal-agent cron route) that must tell "a person needs to add their own
 * key" (a benign, per-user config state safe to record as a silent `skipped`
 * run) apart from "the platform is misconfigured" (an operational fault that
 * must surface as an `error`, because nobody else will ever see it).
 */
export class PersonalAiKeyMissingError extends AiNotConfiguredError {
  /** `provider` names WHICH key is missing, so the UI can say which one to add.
   *  Optional: the zero-argument form predates per-provider credentials and is
   *  still valid for a caller that has no provider in hand. */
  constructor(public readonly provider?: string) {
    super();
    this.name = "PersonalAiKeyMissingError";
    if (provider) this.message = `No personal API key for ${provider}.`;
  }
}

/** org_ai_settings.ai_mode = 'off'. */
export class AiDisabledError extends Error {
  constructor() {
    super("AI is turned off for this organization.");
    this.name = "AiDisabledError";
  }
}

/** ai_mode = 'org_byo' but no org secret stored for the requested provider. */
export class ByoKeyMissingError extends Error {
  /** See {@link PersonalAiKeyMissingError.provider} — same contract, org scope. */
  constructor(public readonly provider?: string) {
    super(
      provider
        ? `No organization API key for ${provider}.`
        : "This organization's AI key is missing.",
    );
    this.name = "ByoKeyMissingError";
  }
}

/**
 * The provider is reachable (its key resolved) but its catalog offers no model
 * this call could run: `ai_models` has no active, id-verified row for it.
 *
 * Extends AiNotConfiguredError so every existing `instanceof` catch maps it to
 * the call site's "add a key in Settings" copy — which is the honest fix, since
 * a provider's ids are only ever VERIFIED by a live call made with its key
 * (see `models/verify-ids.ts`). Distinct from the key errors because throwing
 * here is what stops a null model reaching a provider — and, more importantly,
 * stops `computeCostUsd(null, usage)` billing the call at $0.
 */
export class NoUsableModelError extends AiNotConfiguredError {
  constructor(public readonly provider: string) {
    super();
    this.name = "NoUsableModelError";
    this.message = `No verified ${provider} models yet — add a key to see models.`;
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
