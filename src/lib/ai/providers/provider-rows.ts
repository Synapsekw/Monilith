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
