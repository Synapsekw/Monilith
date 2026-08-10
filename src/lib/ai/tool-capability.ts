import { ProviderNotCapableError } from "@/lib/ai/errors";

/**
 * The ONLY provider whose tool-use loops are implemented.
 *
 * This is deliberately a provider check and not a read of
 * `ai_models.supports_tools`. The catalog flag is accurate — most models on
 * every provider support tool calling — but the loops in
 * `app/api/ask/route.ts` and `lib/ai/write/actions.ts` construct
 * `new Anthropic({ apiKey })` directly rather than going through an adapter,
 * so they physically cannot run anywhere else. Gating on the catalog flag
 * would advertise a capability the code does not have and fail at the API
 * call instead of at the boundary.
 *
 * Spec 2 generalizes those loops onto the AI SDK's provider-agnostic tool
 * calling; at that point this module is replaced by a per-model catalog read
 * and this constant is the single place that changes.
 */
export const TOOL_LOOP_PROVIDER = "anthropic";

export function assertToolLoopCapable(provider: string, feature: string): void {
  if (provider !== TOOL_LOOP_PROVIDER)
    throw new ProviderNotCapableError(feature);
}
