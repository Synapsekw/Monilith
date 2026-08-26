import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";
import type { ModelOption } from "@/components/settings/ModelPicker";
import { listActiveModels } from "@/lib/ai/models/catalog-db";

/**
 * Everything a {@link ModelPicker} can offer, read once on the server.
 *
 * Extracted because two surfaces now need the identical list — the org default
 * (Settings → AI) and the per-agent pin (Settings → Agents) — and a second
 * hand-rolled copy of this mapping is exactly where the catalog key and the
 * wire id would drift apart.
 *
 * One `listActiveModels` per enabled provider, issued in parallel and each
 * served by `ai_models_selectable_idx` (status + provider + id_verified) — tens
 * of rows apiece, bounded, no unbounded select (working agreement #5). The
 * result is a FLAT list in render order: providers by label (the order
 * `listEnabledProviders` returns) and cheapest-first within a provider (the
 * order `listActiveModels` returns), so the picker groups it without sorting.
 *
 * `nativeModelId` is deliberately dropped on the floor here. It is the WIRE id
 * — what `resolveModel` puts on the request — and it is not the id a pin, a
 * picker or the usage ledger speaks. Carrying it into an option would let a
 * pin store a value that no catalog lookup can resolve.
 */
export async function buildModelOptions(
  client: SupabaseClient<Database>,
  providers: ProviderRow[],
): Promise<ModelOption[]> {
  const perProvider = await Promise.all(
    providers.map(async (p) =>
      (await listActiveModels(client, p.id)).map(
        (m): ModelOption => ({
          provider: p.id,
          providerLabel: p.label,
          // The CATALOG key (`ai_models.model_id`), never `native_model_id`.
          modelId: m.modelId,
          label: m.label,
          tier: m.tier,
          supportsTools: m.supportsTools,
          contextLength: m.contextLength,
        }),
      ),
    ),
  );
  return perProvider.flat();
}
