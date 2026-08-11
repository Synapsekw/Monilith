import type { generateObject } from "ai";
import type { AdapterKind } from "@/lib/ai/providers/provider-rows";
import type { Effort, ThinkingConfig } from "@/lib/ai/model-map";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { DashboardProposal } from "@/lib/ai/proposal-schema";

/** Thrown by an adapter's validateKey when the provider rejects the key. */
export class ProviderAuthError extends Error {
  constructor(public readonly provider: string) {
    super(`Key rejected by ${provider}`);
    this.name = "ProviderAuthError";
  }
}

// Re-exported, NOT re-declared: `model-map.ts` already owns the request-shape
// vocabulary and is pure (no "server-only"), so both halves stay in one place.
export type { ThinkingConfig, Effort };

/**
 * The dependency-injection seam, used ONLY by tests.
 *
 * Two independent swaps, both of which leave the production code path intact:
 *
 * - `generateObject` swaps the AI SDK entry point. The fake still receives the
 *   REAL `LanguageModelV*` instance built by the real provider factory, so a
 *   test can assert `model.modelId` — i.e. that the requested model string is
 *   what would have been dispatched. (Contrast with passing the bare string
 *   through in test mode, which proves only that the adapter can echo its own
 *   argument.)
 * - `fetch` swaps the transport underneath the real SDK, which is how the
 *   openai-compatible adapter's baseUrl is proven to reach the wire.
 */
export type AdapterClient = {
  generateObject?: typeof generateObject;
  fetch?: typeof globalThis.fetch;
};

export type GenerateArgs = {
  apiKey: string;
  /** Non-null exactly for the openai-compatible kind. */
  baseUrl: string | null;
  /**
   * The model to run. Resolved upstream against the catalog — an adapter MUST
   * run this and report it back, because runAi meters whatever `model` it
   * returns. Silently substituting a different model mis-bills.
   */
  model: string;
  system: string;
  user: string;
  schema: object;
  /** Anthropic-only request shape; other kinds ignore these. */
  thinking?: ThinkingConfig;
  effort?: Effort;
  client?: AdapterClient;
};

/**
 * One adapter per WIRE FORMAT, not per provider.
 *
 * `supportsTools` is GONE from this interface. It was a per-adapter constant;
 * tool support is really per-MODEL (11 of Google's 17 language models support
 * tools, not all 17), and that now lives on `ai_models.supports_tools`.
 *
 * But note what the catalog flag does NOT buy yet: the tool-use loops in
 * `app/api/ask/route.ts` and `lib/ai/write/actions.ts` construct
 * `new Anthropic()` DIRECTLY, bypassing adapters entirely — so they cannot run
 * on any other provider no matter what the catalog says. `tool-capability.ts`
 * gates them on an explicit provider check, which is the honest description of
 * what the code can do today.
 *
 * `id` / `label` / `placeholder` / `keyFormat` are gone too: they were
 * per-PROVIDER display metadata living on a per-wire-format object, which stops
 * making sense the moment one adapter serves both Mistral and Kimi. They live
 * on the `ai_providers` row (see `provider-rows.ts`).
 */
export interface ProviderAdapter {
  kind: AdapterKind;
  /** Resolves if the key is accepted; throws ProviderAuthError if rejected. */
  validateKey(args: { apiKey: string; baseUrl: string | null }): Promise<void>;
  /**
   * Generic structured-output call against a hand-written JSON schema. The
   * single structured-output primitive — generateProposal delegates to it.
   * `model` in the result is what ACTUALLY ran.
   */
  generateStructured<T = unknown>(
    args: GenerateArgs,
  ): Promise<{ data: T; usage: AiUsageTokens; model: string }>;
  generateProposal(args: Omit<GenerateArgs, "schema">): Promise<{
    proposal: DashboardProposal;
    usage: AiUsageTokens;
    model: string;
  }>;
}
