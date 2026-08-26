import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { parseFeed } from "@/lib/ai/models/feed-parse";
import {
  listEnabledProviders,
  recordProviderVerification,
  type ProviderRow,
} from "@/lib/ai/providers/provider-rows";
import { verifyProviderModels } from "@/lib/ai/models/verify-ids";
import { readSweepCredential } from "@/lib/ai/credentials";
import { getServerEnv } from "@/lib/env.server";

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
 * The platform key for a provider, when the deployment holds one. Anthropic is
 * the only such provider today. Preferred over any user's key wherever it
 * exists — a platform key belongs to us, so verifying with it borrows nothing
 * from anybody.
 *
 * Reads the env lazily and per-provider: `getServerEnv()` throws on an invalid
 * environment, and that throw belongs inside the sweep's per-provider
 * try/catch (one skipped provider) rather than at module load.
 */
function platformKeyFor(provider: string): string | undefined {
  return provider === "anthropic"
    ? getServerEnv().ANTHROPIC_API_KEY
    : undefined;
}

export type VerifyAllProvidersDeps = {
  /** Injected seam so the sweep is testable without a network. */
  verify?: typeof verifyProviderModels;
  /** Injected seam for the stored-credential read. */
  readKey?: typeof readSweepCredential;
  /** Injected seam for the platform-key lookup. */
  platformKey?: (provider: string) => string | undefined;
  /** Injected seam for the per-provider health write. */
  recordHealth?: typeof recordProviderVerification;
};

/** The reason recorded when a provider has no key this sweep may borrow. Its
 *  most common cause is deliberate: see the org-BYO paragraph below. */
const NO_KEY_REASON =
  "No personal API key stored for this provider, so its models could not be checked.";

/** Duck-typed on `.message`, like `verify-ids.ts` — see the note there on
 *  cross-realm DOMExceptions. */
function failureReason(e: unknown): string {
  return typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
    ? (e as { message: string }).message
    : "verification failed";
}

/**
 * Re-verify EVERY enabled provider's model ids against that provider's own
 * `/v1/models`, once per run.
 *
 * The catalog is populated from the Vercel AI Gateway feed, whose id namespace
 * is not the providers' native one — an unverified id is a 404 at inference
 * time. Only Anthropic has a platform key, so until now the other providers
 * were re-verified only when a user happened to re-save a key by hand, which
 * made "new models appear without a deploy" true for exactly one provider.
 *
 * ## Borrowing a user's key
 *
 * For a provider with no platform key the sweep uses ONE stored PERSONAL BYO
 * credential — see `readSweepCredential` for the selection rule and the full
 * contract, including why an ORG BYO key is deliberately never borrowed here.
 * What matters here: this is a single read-only GET per provider per run (the
 * job runs daily), it can never bill the key's owner, and the same use is
 * disclosed under the key field in Personal Settings → AI.
 *
 * ## Every run leaves a record
 *
 * Each provider's outcome is written to `ai_providers` (`ok` / `failed` /
 * `skipped`, with the reason and both timestamps) so the sweep stops being a
 * thing that only `console` knows about. Two consequences worth stating:
 * success is read off `reachable`, never off the counters — `verifyProviderModels`
 * fails closed, so a revoked key returns the same zero/zero as a healthy
 * provider with nothing to verify — and `skipped` is a real, expected outcome
 * rather than an error: it is where a provider nobody has a personal key for
 * (including one held only as an org BYO key) lands on every run.
 *
 * ## Failure is always local
 *
 * Every provider is isolated: a revoked key, a 401, a stalled endpoint or a
 * malformed env is caught, logged and stepped over, so one user's dead
 * credential can never stop the other four providers from refreshing. And a
 * failure never retires anything — `verifyProviderModels` leaves every row
 * untouched when a provider is unreachable, the same fail-closed rule as
 * `refreshCatalog`'s retirement guard. Providers run concurrently so the whole
 * sweep is bounded by the slowest single provider, not by their sum.
 */
export async function verifyAllProviders(
  client: SupabaseClient<Database>,
  deps: VerifyAllProvidersDeps = {},
): Promise<void> {
  const verify = deps.verify ?? verifyProviderModels;
  const readKey = deps.readKey ?? readSweepCredential;
  const platformKey = deps.platformKey ?? platformKeyFor;
  const recordHealth = deps.recordHealth ?? recordProviderVerification;

  let providers: ProviderRow[];
  try {
    providers = await listEnabledProviders(client);
  } catch (e) {
    console.error("[ai] id verification sweep: provider list unavailable", e);
    return;
  }

  await Promise.all(
    providers.map(async (p) => {
      try {
        // Exactly one key resolution and one verify call per provider, so the
        // sweep is one outbound GET per provider per run.
        const apiKey = platformKey(p.id) ?? (await readKey(client, p.id));
        if (!apiKey) {
          // Not a fault — and not nothing either. This is where a provider
          // that exists ONLY as an org BYO key lands, every single run, and
          // recording it is what turns that deliberate exclusion from an
          // invisible dead end into a legible "skipped, no personal key".
          await recordHealth(client, p.id, {
            status: "skipped",
            error: NO_KEY_REASON,
          });
          return;
        }
        const res = await verify({ client, provider: p.id, apiKey });
        // `reachable`, not the counters. `verifyProviderModels` fails closed,
        // so a revoked key returns the same zero/zero as a healthy provider
        // with nothing left to verify — reading success off the counts would
        // file a week of 401s as "ok".
        await recordHealth(
          client,
          p.id,
          res.reachable
            ? { status: "ok", error: null }
            : { status: "failed", error: res.error },
        );
        console.info(
          `[ai] ${p.id} id verification: ${res.verified} verified, ${res.unverified} unverified`,
        );
      } catch (e) {
        // Local to this provider by design — never abort the sweep.
        console.error(`[ai] ${p.id} id verification failed`, e);
        // Best-effort, and deliberately re-caught: `recordProviderVerification`
        // already swallows its own write errors, but an INJECTED recorder (or
        // a future one) must not be able to turn a handled provider failure
        // into an unhandled rejection that takes the whole sweep with it.
        try {
          await recordHealth(client, p.id, {
            status: "failed",
            error: failureReason(e),
          });
        } catch (recordErr) {
          console.error(`[ai] ${p.id} health record failed`, recordErr);
        }
      }
    }),
  );
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
  /**
   * Injected seam for the id-verification pass. Defaults to the real sweep,
   * which covers EVERY enabled provider that has a key we may use — the
   * platform key where one exists, otherwise one stored BYO credential. See
   * `verifyAllProviders` for the borrowing contract and the failure isolation.
   */
  verifyIds?: (client: SupabaseClient<Database>) => Promise<void>;
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

  // The catalog now holds fresh GATEWAY ids; resolve the ones we can to
  // provider-native ids. Never allowed to fail the refresh — the rows are
  // already correct for pricing, and an unverified row is simply not offered.
  try {
    await (deps.verifyIds ?? verifyAllProviders)(deps.client);
  } catch (e) {
    console.error("[ai] model catalog refresh: id verification failed", e);
  }

  return {
    upserted: rows.length,
    retired: retiredRows?.length ?? 0,
    skipped: false,
  };
}
