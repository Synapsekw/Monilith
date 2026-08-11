// Client-safe provider identity. Imported by both the server-only adapters and
// the client settings forms, so it MUST NOT import "server-only" or any
// provider SDK.
//
// AiProvider was a three-member union; it is now `string` because the set is
// open by design — adding Kimi must not require a code change. The constraint
// still exists, it just lives in the database as a foreign key.
//
// This file used to also carry `PROVIDER_CATALOG` / `ALL_PROVIDERS` / a seeded
// id list: display metadata for the three NATIVE providers, kept while the
// settings forms were migrated onto the registry. Both forms now read
// `ai_providers` rows (`providers/provider-rows.ts`) and pass a `ProviderRow`
// down from a server component, so the static maps are gone rather than
// re-guarded — indexing a three-entry map with an open `string` is what threw
// the whole settings page on a Mistral or Kimi value.
export type AiProvider = string;
