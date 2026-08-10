import "server-only";
import {
  ADAPTER_KINDS,
  type AdapterKind,
} from "@/lib/ai/providers/provider-rows";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { openaiAdapter } from "@/lib/ai/providers/openai";
import { googleAdapter } from "@/lib/ai/providers/google";
import { openaiCompatibleAdapter } from "@/lib/ai/providers/openai-compatible";

// Keyed by WIRE FORMAT, not provider id — which is why five providers need
// only four adapters, and a sixth provider needs none.
const ADAPTERS: Record<AdapterKind, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
  "openai-compatible": openaiCompatibleAdapter,
};

export function getAdapter(kind: AdapterKind): ProviderAdapter {
  return ADAPTERS[kind];
}

/**
 * INTERIM provider-id → adapter resolution, for the callers that still hold a
 * provider id and no `ai_providers` row.
 *
 * The right lookup is `getAdapter(providerRow.adapterKind)`; Task 8 threads the
 * row through the gateway. Until then the only providers those callers can
 * produce are the three NATIVE ones — the credential Server Actions still
 * validate against a three-member enum — and for exactly those three the
 * provider id happens to equal the adapter kind. Anything else throws rather
 * than guessing, because picking the wrong adapter would send a key to the
 * wrong wire format.
 */
export function getAdapterForProviderId(providerId: string): ProviderAdapter {
  const kind = ADAPTER_KINDS.find(
    (k) => k === providerId && k !== "openai-compatible",
  );
  if (!kind)
    throw new Error(
      `No adapter for provider "${providerId}" without its ai_providers row`,
    );
  return getAdapter(kind);
}
