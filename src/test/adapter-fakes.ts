/**
 * Test-support fakes for the provider adapters (`src/lib/ai/providers/`).
 *
 * Lives in `src/test/` beside `mcp-fake-client.ts` — outside vitest's
 * `*.{test,spec}.{ts,tsx}` include glob, so it is never collected as a suite,
 * and it imports nothing from `vitest` so it stays a plain module.
 *
 * The injected `generateObject` still receives the REAL model instance built by
 * the real provider factory, so `call.model.modelId` is proof that the model
 * string the adapter was ASKED for is the one that would have been dispatched —
 * not merely echoed back out of the adapter's own argument.
 */
import type { AdapterClient } from "@/lib/ai/providers/types";
import type { ResolvedModel } from "@/lib/ai/models/resolve";

/** What the adapters pass to `generateObject`, narrowed to what we assert on. */
export type CapturedCall = {
  model: { modelId: string; provider: string };
  schema: unknown;
  system?: string;
  prompt?: string;
  messages?: {
    role: string;
    content: unknown;
    providerOptions?: Record<string, Record<string, unknown>>;
  }[];
  maxOutputTokens?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
};

/** The AI SDK's usage shape, as much of it as the adapters read. */
export type SdkUsage = {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};

export const ZERO_USAGE: SdkUsage = {
  inputTokens: 0,
  outputTokens: 0,
  inputTokenDetails: {},
};

/**
 * A `generateObject` stand-in that records every call and returns a canned
 * result. Cast at the boundary because `typeof generateObject` is a heavily
 * overloaded generic that no hand-written fake can satisfy structurally.
 */
export function fakeGenerateObject(
  captured: CapturedCall[],
  result: { object?: unknown; usage?: SdkUsage } = {},
): NonNullable<AdapterClient["generateObject"]> {
  const fn = async (args: CapturedCall) => {
    captured.push(args);
    return { object: result.object ?? {}, usage: result.usage ?? ZERO_USAGE };
  };
  return fn as unknown as NonNullable<AdapterClient["generateObject"]>;
}

/**
 * A resolved model, as `runAi` hands it to its callback.
 *
 * Every suite that fakes `runAi` needs one, and each hand-rolled copy is a
 * chance to make `requestModel` equal `model` — which is precisely the bug the
 * two fields exist to prevent (the Gateway's catalog key is not the provider's
 * wire id, so sending the key is a 404). The defaults here keep them DIFFERENT.
 */
export function fakeResolvedModel(over: Partial<ResolvedModel> = {}) {
  return {
    model: "claude-sonnet-5",
    requestModel: "claude-sonnet-5-20260101",
    provider: "anthropic",
    rates: { input: 3, output: 15, cacheRead: null, cacheWrite: null },
    supportsTools: true,
    substituted: false,
    // A realistic window, not null — the reference-document budget's
    // `assumedContext` (NULL_CONTEXT_FALLBACK) fallback path is its own
    // explicit test case, not the silent default every other suite gets.
    contextLength: 200_000,
    ...over,
  };
}
