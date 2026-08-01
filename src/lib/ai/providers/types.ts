import type { z } from "zod";
import type { ModelChoice } from "@/lib/ai/model-map";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { DashboardProposal } from "@/lib/ai/proposal-schema";
import type { AiProvider } from "@/lib/ai/providers/catalog";

/** Thrown by an adapter's validateKey when the provider rejects the key. */
export class ProviderAuthError extends Error {
  constructor(public readonly provider: AiProvider) {
    super(`Key rejected by ${provider}`);
    this.name = "ProviderAuthError";
  }
}

export interface ProviderAdapter {
  id: AiProvider;
  label: string;
  placeholder: string;
  /** Cheap shape check before the live ping. */
  keyFormat: z.ZodType<string>;
  defaultModel: string;
  /** True when the provider path implements tool use (Ask Pulse etc.). v1: Anthropic only. */
  supportsTools: boolean;
  /** Resolves if the key is accepted; throws ProviderAuthError if rejected. */
  validateKey(rawKey: string): Promise<void>;
  /**
   * Runs the provider to produce a raw (unvalidated) proposal.
   *
   * `model` is the model the adapter ACTUALLY ran — not `choice.model`. Only
   * the Anthropic adapter honours `choice`; the OpenAI/Google adapters ignore
   * it and run their own fixed model, so metering `choice.model` for a BYO org
   * on those providers bills the wrong (much pricier) rate. Report this back
   * to runAi. Mirrors classifyColumn / generateItemAssist.
   */
  generateProposal(args: {
    apiKey: string;
    system: string;
    user: string;
    /** Per-feature model + request shape. Defaults to the adapter's default. */
    choice?: ModelChoice;
    client?: unknown; // DI for tests
  }): Promise<{
    proposal: DashboardProposal;
    usage: AiUsageTokens;
    model: string;
  }>;
  /**
   * Generic structured-output call: runs the provider against an arbitrary
   * hand-written JSON schema and returns the raw (unvalidated) parsed object.
   * The single structured-output primitive — generateProposal delegates to it.
   * Callers re-validate/repair the result with the canonical Zod schemas.
   *
   * `model` is the model actually used (see generateProposal above).
   */
  generateStructured<T = unknown>(args: {
    apiKey: string;
    system: string;
    user: string;
    schema: object;
    choice?: ModelChoice;
    client?: unknown; // DI for tests
  }): Promise<{ data: T; usage: AiUsageTokens; model: string }>;
}
