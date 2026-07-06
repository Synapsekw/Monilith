import type { z } from "zod";
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
  /** Resolves if the key is accepted; throws ProviderAuthError if rejected. */
  validateKey(rawKey: string): Promise<void>;
  /** Runs the provider to produce a raw (unvalidated) proposal. */
  generateProposal(args: {
    apiKey: string;
    system: string;
    user: string;
  }): Promise<DashboardProposal>;
}
