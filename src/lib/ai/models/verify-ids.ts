import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  getProviderRow,
  type ProviderRow,
} from "@/lib/ai/providers/provider-rows";
import {
  candidateNativeIds,
  isDatedSnapshotOf,
} from "@/lib/ai/models/model-ids";

/**
 * The Gateway's model-id namespace is not the providers' native namespace
 * (verified 2026-08-10: it publishes claude-haiku-4.5 where Anthropic's API
 * wants claude-haiku-4-5, and exposes no native id anywhere). We call
 * providers DIRECTLY with BYO keys, so a gateway-only id is a 404.
 *
 * The rules moved to `models/model-ids.ts` when `pricing.ts` turned out to need
 * the identical reconciliation to find a model's price floor — see that file.
 * Re-exported here because this is where callers expect it.
 */
export { candidateNativeIds };

/**
 * Exact match wins. Otherwise accept a native id that extends a candidate with
 * a DATE suffix only (`claude-haiku-4-5` → `claude-haiku-4-5-20251001`), which
 * is how Anthropic publishes pinned snapshots. A bare prefix is never enough:
 * `gpt-4` must not match `gpt-4o`.
 */
export function matchNativeId(
  candidates: string[],
  nativeIds: string[],
): string | null {
  const native = new Set(nativeIds);
  for (const c of candidates) if (native.has(c)) return c;
  for (const c of candidates) {
    // The date rule itself lives in models/model-ids.ts, so a change to how
    // providers spell snapshots is one edit, not two.
    const dated = nativeIds.find((n) => isDatedSnapshotOf(c, n));
    if (dated) return dated;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The impure half: ask each provider for its own model list.
// ---------------------------------------------------------------------------

/**
 * Boundary parsing (Zod, per the engineering invariants). Unknown keys are
 * stripped rather than rejected — providers add fields constantly — but a
 * payload that is not a list of ids at all throws, which the caller treats as
 * "provider unavailable" and skips.
 */
const idListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const googleListSchema = z.object({
  models: z.array(z.object({ name: z.string() })),
});

type ListSpec = {
  url: string;
  headers: Record<string, string>;
  pick: (json: unknown) => string[];
};

/**
 * One spec per WIRE FORMAT, mirroring the adapter registry: five providers,
 * four shapes. Note the Google key travels in the query string, so neither the
 * URL nor the headers may ever reach a log line.
 */
function listSpec(row: ProviderRow, apiKey: string): ListSpec {
  switch (row.adapterKind) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models?limit=100",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        pick: pickDataIds,
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/models",
        headers: { Authorization: `Bearer ${apiKey}` },
        pick: pickDataIds,
      };
    case "google":
      return {
        // pageSize is explicit: the default page is 50 and a truncated list
        // would quarantine real models as "unverified".
        url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`,
        headers: {},
        pick: pickGoogleIds,
      };
    case "openai-compatible": {
      if (!row.baseUrl) throw new Error(`provider "${row.id}" has no base_url`);
      return {
        url: `${row.baseUrl.replace(/\/+$/, "")}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
        pick: pickDataIds,
      };
    }
  }
}

function pickDataIds(json: unknown): string[] {
  return idListSchema.parse(json).data.map((m) => m.id);
}

function pickGoogleIds(json: unknown): string[] {
  // Google returns fully-qualified resource names: "models/gemini-2.0-flash".
  return googleListSchema
    .parse(json)
    .models.map((m) => m.name.replace(/^models\//, ""));
}

/**
 * Deadline for a provider's model-list call. A provider that accepts the TCP
 * connection and then stalls would otherwise hang for undici's default (in the
 * minutes), and `fetch` without a signal has no deadline of its own. Ten
 * seconds is generous for a single GET that returns a few KB of ids.
 */
export const MODEL_LIST_TIMEOUT_MS = 10_000;

/**
 * The provider's own list of callable model ids. The ONLY impure part of the
 * matching path — kept separate so the rules above stay testable without a
 * network. Throws on any transport, timeout or shape failure; the caller
 * decides that a throw means "skip this provider", never "mark everything
 * unverified".
 *
 * `timeoutMs` is injectable so the deadline itself is testable in
 * milliseconds rather than in ten real seconds.
 */
export async function listNativeModelIds(
  row: ProviderRow,
  apiKey: string,
  timeoutMs: number = MODEL_LIST_TIMEOUT_MS,
): Promise<string[]> {
  const spec = listSpec(row, apiKey);
  const res = await fetch(spec.url, {
    headers: spec.headers,
    cache: "no-store",
    // Without this a stalled provider holds the caller open indefinitely. The
    // abort rejects, which verifyProviderModels already turns into a clean
    // "skip this provider" rather than a demotion.
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Status only — the URL carries a key for Google and the headers carry one
  // for everybody else.
  if (!res.ok)
    throw new Error(`${row.id} model list returned HTTP ${res.status}`);
  return spec.pick(await res.json());
}

type CatalogIdRow = {
  model_id: string;
  native_model_id: string | null;
  id_verified: boolean;
};

/**
 * What one provider's verification pass produced.
 *
 * `verified`/`unverified` describe the CATALOG. `reachable` describes the
 * PROVIDER, and it is a separate bit because the two are not derivable from
 * each other: this function fails closed, so a revoked key and a provider with
 * no catalog rows yet both return `{ verified: 0, unverified: 0 }`. That is
 * correct for the catalog and useless for health reporting —
 * `verifyAllProviders` records per-provider sweep health, and without
 * `reachable` it would file a week of 401s as "ok".
 *
 * `error` is a short, already-sanitized sentence, non-null exactly when
 * `reachable` is false. It is safe to persist and to render: every message
 * originates here or in `listNativeModelIds`, which reports the HTTP STATUS
 * only — never the URL (Google's carries the key in the query string) and
 * never the headers.
 */
export type VerifyOutcome = {
  verified: number;
  unverified: number;
  /** Did the provider's own `/v1/models` answer this run? */
  reachable: boolean;
  /** Why not, when it did not. Null whenever `reachable` is true. */
  error: string | null;
};

/** Cap on a persisted/rendered reason. Long enough for a real message, short
 *  enough that a pathological provider body cannot become the badge. */
const MAX_ERROR_CHARS = 300;

/**
 * Duck-typed on `.message` rather than `instanceof Error` on purpose. The
 * timeout path rejects with a `DOMException`, which is NOT an `instanceof
 * Error` when it crosses a realm boundary (jsdom's global vs node's) — so an
 * `instanceof` check silently degraded the single most useful message the
 * sweep can record, "the provider stalled", into a generic fallback.
 */
function reason(e: unknown, fallback: string): string {
  const msg =
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
      ? (e as { message: string }).message
      : fallback;
  return msg.slice(0, MAX_ERROR_CHARS);
}

/**
 * Resolve every catalog row for one provider to a provider-NATIVE model id.
 *
 * Fails closed and fails quietly. If the provider's model list is unreachable
 * or unparseable, verification is skipped for that provider entirely and NO
 * row is touched — the same reasoning as the refresh's retirement guard: a
 * provider outage must never empty a picker.
 *
 * A row that does not match is LEFT as it was; it is never deleted and never
 * marked `retired`, because the model may well exist under a name we cannot
 * derive. Equally, a row that was verified before is never demoted on the
 * strength of one list call — several providers' `/models` endpoints are
 * incomplete (org-scoped, or omitting aliases), so demotion would empty
 * pickers even while the provider is perfectly healthy.
 */
export async function verifyProviderModels(args: {
  client: SupabaseClient<Database>;
  provider: string;
  apiKey: string;
}): Promise<VerifyOutcome> {
  const { client, provider, apiKey } = args;

  const row = await getProviderRow(client, provider);
  if (!row || !row.enabled)
    return {
      verified: 0,
      unverified: 0,
      reachable: false,
      error: `provider "${provider}" is not enabled`,
    };

  let nativeIds: string[];
  try {
    nativeIds = await listNativeModelIds(row, apiKey);
  } catch (e) {
    const error = reason(e, "model list unavailable");
    console.error(`[ai] id verification skipped for "${provider}": ${error}`);
    return { verified: 0, unverified: 0, reachable: false, error };
  }
  if (nativeIds.length === 0) {
    // An empty list is a probe FAILURE, not a healthy answer: it is how a
    // provider behind an outage or an org-scoped key presents itself, and the
    // catalog already refuses to act on it. Reporting it as reachable would
    // hide exactly the case the health badge exists for.
    const error = `${provider} returned an empty model list`;
    console.error(`[ai] id verification skipped for "${provider}": ${error}`);
    return { verified: 0, unverified: 0, reachable: false, error };
  }

  const { data, error } = await client
    .from("ai_models")
    .select("model_id, native_model_id, id_verified")
    .eq("provider", provider)
    .neq("status", "retired");
  if (error) throw new Error(`verifyProviderModels read: ${error.message}`);
  const rows = (data ?? []) as CatalogIdRow[];

  const verifiedAt = new Date().toISOString();
  const writes: { modelId: string; nativeId: string }[] = [];
  let verified = 0;
  let unverified = 0;

  for (const r of rows) {
    const match = matchNativeId(candidateNativeIds(r.model_id), nativeIds);
    if (match) {
      verified += 1;
      if (!r.id_verified || r.native_model_id !== match)
        writes.push({ modelId: r.model_id, nativeId: match });
    } else if (r.id_verified) {
      verified += 1; // previously verified — see the no-demotion note above.
    } else {
      unverified += 1;
    }
  }

  // Per-row values mean per-row updates; chunked so a 41-model provider is a
  // handful of round trips rather than 41 serial ones.
  const CHUNK = 8;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const results = await Promise.all(
      writes.slice(i, i + CHUNK).map((w) =>
        client
          .from("ai_models")
          .update({
            native_model_id: w.nativeId,
            id_verified: true,
            id_verified_at: verifiedAt,
          })
          .eq("provider", provider)
          .eq("model_id", w.modelId),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error)
      throw new Error(`verifyProviderModels write: ${failed.error.message}`);
  }

  return { verified, unverified, reachable: true, error: null };
}
