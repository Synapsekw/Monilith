import {
  AiDisabledError,
  AiNotConfiguredError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  ProviderNotCapableError,
} from "@/lib/ai/errors";

/**
 * Shared "typed AI error → user-facing copy" ladder. Both AI action call
 * sites (dashboard generation, Ask Pulse) catch the same set of typed errors
 * from `runAi` and translate them to clean copy instead of a raw 500.
 *
 * `AiDisabledError`, `AiQuotaExceededError`, and `ByoKeyMissingError` render
 * identical copy everywhere, so their strings are fixed here. `notConfigured`,
 * `providerNotCapable`, and the generic `fallback` legitimately differ per
 * call site (e.g. Ask Pulse needs an Anthropic key specifically), so callers
 * can override them via `opts`.
 */
export function mapAiError(
  e: unknown,
  opts?: {
    fallback?: string;
    notConfigured?: string;
    providerNotCapable?: string;
  },
): string {
  if (e instanceof AiDisabledError)
    return "AI is turned off for your organization.";
  if (e instanceof AiQuotaExceededError)
    return "You've used this month's AI allowance.";
  if (e instanceof ByoKeyMissingError)
    return "Your organization's AI key is missing — ask an admin to update Settings.";
  if (e instanceof AiNotConfiguredError)
    return opts?.notConfigured ?? "AI generation isn't configured.";
  if (e instanceof ProviderNotCapableError)
    return (
      opts?.providerNotCapable ??
      "The configured AI provider can't run this feature."
    );
  return opts?.fallback ?? "AI generation failed. Please try again.";
}
