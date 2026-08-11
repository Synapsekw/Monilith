import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { parseFeed } from "@/lib/ai/models/feed-parse";
import { listEnabledProviders } from "@/lib/ai/providers/provider-rows";

export const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

export async function fetchGatewayFeed(): Promise<unknown> {
  const res = await fetch(GATEWAY_MODELS_URL, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`gateway models feed returned ${res.status}`);
  return res.json();
}

/**
 * Refresh the model catalog from the Gateway feed.
 *
 * The retirement guard is the load-bearing part: retirement runs ONLY when the
 * fetch returned a plausible non-empty parse. A Gateway outage that returns
 * `[]`, a 503, or a malformed body must leave the catalog exactly as it was —
 * mass-retiring on a bad fetch would empty every model picker in the product
 * and orphan every pinned agent at once.
 *
 * Rows are never deleted: user_agents references model ids, so a delete turns a
 * pinned reference into a dangling one instead of a clean `retired` state.
 */
export async function refreshCatalog(deps: {
  fetchFeed: () => Promise<unknown>;
  client: SupabaseClient<Database>;
}): Promise<{ upserted: number; retired: number; skipped: boolean }> {
  const providers = await listEnabledProviders(deps.client);
  const enabledIds = providers.map((p) => p.id);

  let raw: unknown;
  try {
    raw = await deps.fetchFeed();
  } catch (e) {
    console.error("[ai] model catalog refresh: feed fetch failed", e);
    return { upserted: 0, retired: 0, skipped: true };
  }

  const rows = parseFeed(raw, enabledIds);
  if (rows.length === 0) {
    console.error(
      "[ai] model catalog refresh: feed parsed to zero rows — skipping upsert and retirement",
    );
    return { upserted: 0, retired: 0, skipped: true };
  }

  const seenAt = new Date().toISOString();
  const { error: upsertErr } = await deps.client.from("ai_models").upsert(
    rows.map((r) => ({ ...r, last_seen_at: seenAt })),
    { onConflict: "provider,model_id" },
  );
  if (upsertErr) throw new Error(`refreshCatalog upsert: ${upsertErr.message}`);

  // Anything we did not see this run, among the providers THIS run actually
  // covers, is retired — never deleted. Scoped to `providersSeen` (the
  // providers present in the PARSED rows), not the full enabled list: a
  // healthy fetch that happens to omit one provider's entries must not touch
  // that provider's rows — the same fail-closed principle as the zero-rows
  // guard above, just per-provider instead of catalog-wide (finding C1).
  const providersSeen = [...new Set(rows.map((r) => r.provider))];
  const { data: retiredRows, error: retireErr } = await deps.client
    .from("ai_models")
    .update({ status: "retired" })
    .in("provider", providersSeen)
    .lt("last_seen_at", seenAt)
    .eq("status", "active")
    .select("provider,model_id");
  if (retireErr) throw new Error(`refreshCatalog retire: ${retireErr.message}`);

  return {
    upserted: rows.length,
    retired: retiredRows?.length ?? 0,
    skipped: false,
  };
}
