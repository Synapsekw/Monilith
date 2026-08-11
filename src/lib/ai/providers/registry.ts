import "server-only";
import type { AdapterKind } from "@/lib/ai/providers/provider-rows";
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

/**
 * The ONLY adapter lookup. It takes an adapter KIND, which means every caller
 * must hold an `ai_providers` row — there is deliberately no provider-id
 * overload: the id-keyed helper that used to live here could only serve the
 * three providers whose id happens to equal their wire format, and threw for
 * Mistral and Kimi. Read the row (`provider-rows.ts`), pass `row.adapterKind`,
 * and pass `row.baseUrl` to the adapter alongside the key.
 */
export function getAdapter(kind: AdapterKind): ProviderAdapter {
  return ADAPTERS[kind];
}
