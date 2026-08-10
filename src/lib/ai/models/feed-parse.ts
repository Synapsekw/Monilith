import { z } from "zod";

/**
 * Pure Gateway-feed → catalog-row projection. Deliberately free of `server-only`,
 * network and DB access: the refresh sweep's correctness lives almost entirely
 * in this function, and keeping it pure is what lets it be tested against a
 * captured real response (feed-fixture.json) rather than a live endpoint.
 *
 * Feed shape verified against https://ai-gateway.vercel.sh/v1/models on
 * 2026-08-10. Prices are per-TOKEN decimal strings; we store per-Mtok numbers.
 */

export type ModelTier = "cheap" | "standard" | "strong";

export type CatalogRow = {
  provider: string;
  model_id: string;
  gateway_id: string;
  label: string;
  context_length: number | null;
  max_output_tokens: number | null;
  supports_tools: boolean;
  input_price_per_mtok: number | null;
  output_price_per_mtok: number | null;
  cache_read_price_per_mtok: number | null;
  cache_write_price_per_mtok: number | null;
  tier: ModelTier;
  status: "active" | "needs_pricing";
};

/** USD per Mtok input. Matches the spec's stated thresholds. */
const CHEAP_MAX = 1.0;
const STANDARD_MAX = 5.0;

export function tierFor(inputPricePerMtok: number | null): ModelTier {
  // An unpriced model must NOT read as "cheap" — the tier hint routes bulk
  // features (item_assist, column_fill) to the cheapest model, and an unpriced
  // model bills nothing, so treating it as cheap would silently send volume to
  // an unmetered model. Standard is the conservative middle.
  if (inputPricePerMtok === null) return "standard";
  if (inputPricePerMtok <= CHEAP_MAX) return "cheap";
  if (inputPricePerMtok <= STANDARD_MAX) return "standard";
  return "strong";
}

const pricingSchema = z
  .object({
    input: z.string().optional(),
    output: z.string().optional(),
    // Verified field names against the live feed capture on 2026-08-10 (see
    // feed-fixture.json) — the Gateway sends snake_case `input_cache_read` /
    // `input_cache_write`, not the AI-SDK-usage-style camelCase names. Getting
    // this wrong doesn't fail any test outside this file: it just silently
    // leaves every cache price null forever.
    input_cache_read: z.string().optional(),
    input_cache_write: z.string().optional(),
  })
  .partial();

const entrySchema = z.object({
  id: z.string(),
  owned_by: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  tags: z.array(z.string()).nullish(),
  context_window: z.number().nullish(),
  max_tokens: z.number().nullish(),
  pricing: pricingSchema.nullish(),
});

const feedSchema = z.object({ data: z.array(z.unknown()) });

/** Per-token decimal string → per-Mtok number. */
function perMtok(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n * 1_000_000 : null;
}

export function parseFeed(
  json: unknown,
  enabledProviders: string[],
): CatalogRow[] {
  const feed = feedSchema.safeParse(json);
  if (!feed.success) return [];
  const enabled = new Set(enabledProviders);

  const rows: CatalogRow[] = [];
  for (const raw of feed.data.data) {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const e = parsed.data;

    // Only chat models. The feed also carries image, video, audio, rerank and
    // embedding models, none of which may reach a model picker.
    if (e.type !== "language") continue;

    const slash = e.id.indexOf("/");
    if (slash <= 0) continue;
    const provider = e.id.slice(0, slash);
    const modelId = e.id.slice(slash + 1);
    if (!enabled.has(provider)) continue;

    const input = perMtok(e.pricing?.input);
    const output = perMtok(e.pricing?.output);
    // Both rates are required to meter a call; either one missing means we
    // cannot bill it correctly, so the row is quarantined rather than shown.
    const priced = input !== null && output !== null;

    rows.push({
      provider,
      model_id: modelId,
      gateway_id: e.id,
      label: e.name ?? modelId,
      context_length: e.context_window ?? null,
      max_output_tokens: e.max_tokens ?? null,
      supports_tools: (e.tags ?? []).includes("tool-use"),
      input_price_per_mtok: input,
      output_price_per_mtok: output,
      cache_read_price_per_mtok: perMtok(e.pricing?.input_cache_read),
      cache_write_price_per_mtok: perMtok(e.pricing?.input_cache_write),
      tier: tierFor(input),
      status: priced ? "active" : "needs_pricing",
    });
  }
  return rows;
}
