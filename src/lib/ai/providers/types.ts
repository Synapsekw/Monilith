import type { z } from "zod";
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
  /** Runs the provider to produce a raw (unvalidated) proposal. */
  generateProposal(args: {
    apiKey: string;
    system: string;
    user: string;
  }): Promise<{ proposal: DashboardProposal; usage: AiUsageTokens }>;
  /**
   * Generic structured-output call: runs the provider against an arbitrary
   * hand-written JSON schema and returns the raw (unvalidated) parsed object.
   * The single structured-output primitive — generateProposal delegates to it.
   * Callers re-validate/repair the result with the canonical Zod schemas.
   */
  generateStructured<T = unknown>(args: {
    apiKey: string;
    system: string;
    user: string;
    schema: object;
  }): Promise<{ data: T; usage: AiUsageTokens }>;
}
