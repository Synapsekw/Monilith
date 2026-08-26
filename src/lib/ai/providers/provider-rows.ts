import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Access seam for `ai_providers`. Every read of the provider registry is
 * narrowed HERE and only here, so the row shape lives in one place.
 * Mirrors `agents/agents-db.ts`.
 */

export const ADAPTER_KINDS = [
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export type ProviderRow = {
  id: string;
  label: string;
  adapterKind: AdapterKind;
  /** Non-null exactly when adapterKind is "openai-compatible". */
  baseUrl: string | null;
  keyPlaceholder: string;
  /** POSIX regex source for the cheap pre-flight shape check. */
  keyFormat: string;
  enabled: boolean;
};

type RawProviderRow = {
  id: string;
  label: string;
  adapter_kind: string;
  base_url: string | null;
  key_placeholder: string;
  key_format: string;
  enabled: boolean;
};

const PROVIDER_COLS =
  "id, label, adapter_kind, base_url, key_placeholder, key_format, enabled";

function isAdapterKind(v: string): v is AdapterKind {
  return (ADAPTER_KINDS as readonly string[]).includes(v);
}

/**
 * Narrow one DB row. `adapter_kind` is `text` in the generated types (the check
 * constraint is not reflected as an enum), so this is where that widening is
 * closed — throwing rather than casting, because an unknown kind means the
 * registry has drifted ahead of the code and silently picking a default adapter
 * would send a key to the wrong wire format.
 */
export function toProviderRow(raw: RawProviderRow): ProviderRow {
  if (!isAdapterKind(raw.adapter_kind))
    throw new Error(
      `toProviderRow: unknown adapter_kind "${raw.adapter_kind}" for provider "${raw.id}"`,
    );
  return {
    id: raw.id,
    label: raw.label,
    adapterKind: raw.adapter_kind,
    baseUrl: raw.base_url,
    keyPlaceholder: raw.key_placeholder,
    keyFormat: raw.key_format,
    enabled: raw.enabled,
  };
}

export async function listEnabledProviders(
  client: SupabaseClient<Database>,
): Promise<ProviderRow[]> {
  const { data, error } = await client
    .from("ai_providers")
    .select(PROVIDER_COLS)
    .eq("enabled", true)
    .order("label");
  if (error) throw new Error(`listEnabledProviders: ${error.message}`);
  return (data ?? []).map((r) => toProviderRow(r as RawProviderRow));
}

export async function getProviderRow(
  client: SupabaseClient<Database>,
  id: string,
): Promise<ProviderRow | null> {
  const { data, error } = await client
    .from("ai_providers")
    .select(PROVIDER_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getProviderRow: ${error.message}`);
  return data ? toProviderRow(data as RawProviderRow) : null;
}

// ---------------------------------------------------------------------------
// Sweep health — the same access seam, for the four columns the daily
// model-id verification sweep writes and Settings → AI reads.
// ---------------------------------------------------------------------------

/** The three outcomes a sweep run can have for one provider. Mirrors the
 *  `ai_providers_last_verify_status_check` constraint. */
export const VERIFY_STATUSES = ["ok", "failed", "skipped"] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

/**
 * What the last sweep run knows about one provider.
 *
 * `lastVerifiedAt` is the last SUCCESS; `lastAttemptAt` is the last RUN. They
 * are separate because "Mistral was last verified a week ago and has been
 * failing since" needs both ends of the interval — collapse them into one
 * column and a provider that has been 401ing for days is indistinguishable
 * from one verified this morning.
 *
 * All-null is the ordinary state of a provider the sweep has never reached
 * (every row was null the moment the migration landed): "never checked", not
 * "broken".
 */
export type ProviderVerification = {
  lastVerifiedAt: string | null;
  lastAttemptAt: string | null;
  status: VerifyStatus | null;
  error: string | null;
};

export type ProviderVerificationMap = Record<string, ProviderVerification>;

const VERIFICATION_COLS =
  "id, last_verified_at, last_verify_attempt_at, last_verify_status, last_verify_error";

/** Cap on a persisted reason. Matches `verify-ids.ts`'s own cap — this is the
 *  second, independent guard, because the sweep is not the only possible
 *  writer and a column with no bound ends up rendering a provider's HTML
 *  error page inside a badge. */
const MAX_ERROR_CHARS = 300;

function toVerifyStatus(raw: unknown): VerifyStatus | null {
  return typeof raw === "string" &&
    (VERIFY_STATUSES as readonly string[]).includes(raw)
    ? (raw as VerifyStatus)
    : null;
}

/**
 * Every provider's sweep health, keyed by provider id.
 *
 * Bounded by construction: `ai_providers` is the registry itself (five rows
 * today), read whole with no predicate, so this is one indexed-free scan of a
 * table that grows one row per vendor we ever support.
 */
export async function listProviderVerification(
  client: SupabaseClient<Database>,
): Promise<ProviderVerificationMap> {
  const { data, error } = await client
    .from("ai_providers")
    .select(VERIFICATION_COLS);
  if (error) throw new Error(`listProviderVerification: ${error.message}`);

  const map: ProviderVerificationMap = {};
  for (const raw of data ?? []) {
    const r = raw as {
      id: string;
      last_verified_at: string | null;
      last_verify_attempt_at: string | null;
      last_verify_status: string | null;
      last_verify_error: string | null;
    };
    map[r.id] = {
      lastVerifiedAt: r.last_verified_at,
      lastAttemptAt: r.last_verify_attempt_at,
      // Narrowed rather than cast: `last_verify_status` is `text` in the
      // generated types and the badge switches on it, so a value the code
      // does not know must degrade to "never checked", not fall through.
      status: toVerifyStatus(r.last_verify_status),
      error: r.last_verify_error,
    };
  }
  return map;
}

/**
 * Record one provider's sweep outcome.
 *
 * `last_verified_at` moves ONLY on `ok`. A failed or skipped run advances the
 * attempt stamp and leaves the success stamp exactly where it was — that
 * asymmetry is the whole point of the record (see {@link ProviderVerification}).
 *
 * NEVER THROWS, and that is a contract rather than laziness. The sweep's own
 * guarantee is that one provider's failure is caught and stepped over; this
 * function is called from inside both that try and its catch, so a rejection
 * here would either abort a healthy provider's run or escape the catch as an
 * unhandled rejection. Health telemetry must not become a new way for the
 * sweep to die — a lost write is logged and the next daily run overwrites it.
 *
 * Requires a service-role client: `ai_providers` has a select-only RLS policy,
 * so an anon/authenticated write is default-denied.
 */
export async function recordProviderVerification(
  client: SupabaseClient<Database>,
  provider: string,
  outcome: { status: VerifyStatus; error?: string | null },
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const patch: {
    last_verify_attempt_at: string;
    last_verify_status: VerifyStatus;
    last_verify_error: string | null;
    last_verified_at?: string;
  } = {
    last_verify_attempt_at: nowIso,
    last_verify_status: outcome.status,
    last_verify_error: outcome.error
      ? outcome.error.slice(0, MAX_ERROR_CHARS)
      : null,
  };
  if (outcome.status === "ok") patch.last_verified_at = nowIso;

  try {
    const { error } = await client
      .from("ai_providers")
      .update(patch)
      .eq("id", provider);
    if (error)
      console.error(
        `[ai] could not record sweep health for "${provider}": ${error.message}`,
      );
  } catch (e) {
    console.error(`[ai] could not record sweep health for "${provider}"`, e);
  }
}
