// Client-safe provider display metadata. Imported by both the server-only
// adapters and the client settings forms, so it MUST NOT import "server-only"
// or any provider SDK.
//
// AiProvider was a three-member union; it is now `string` because the set is
// open by design — adding Kimi must not require a code change. The constraint
// still exists, it just lives in the database as a foreign key.
export type AiProvider = string;

/** The five providers the registry migration seeded. Display metadata only. */
export const SEEDED_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "mistral",
  "moonshotai",
] as const;

/**
 * @deprecated The `ai_providers` TABLE is authoritative for provider identity,
 * labels, key placeholders and key formats — read it via
 * `providers/provider-rows.ts` and pass a `ProviderRow` down from a server
 * component. This object is display-only seed data whose last consumers are the
 * ORG settings form (`OrgAiSettingsForm`), until Task 10 moves it onto provider
 * rows. The personal key UI is already off it: Task 9 replaced `AiProviderForm`
 * with `AiKeyList`, which is driven entirely by `ProviderRow`s. Both credential
 * Server Actions are off it too — they read the row and validate against
 * `ai_providers`. It covers only the three NATIVE providers and will be deleted
 * with that last form — do not add a fourth entry here.
 *
 * WARNING for whoever finishes that last form: `PROVIDER_CATALOG[id]` is an
 * unguarded index into a 3-entry map keyed by an open `string`, so a `mistral`
 * or `moonshotai` value reaches `.label` on `undefined` and throws the whole
 * settings page. `OrgAiSettingsForm.tsx:193` still does this; it is unreachable
 * only because that form's picker offers three providers and no org has stored
 * a fourth. Replace the lookup, do not re-guard it.
 *
 * `keyFormat` mirrors `ai_providers.key_format` (a regex source), so the swap
 * to the DB row is a one-line change at each call site.
 */
export const PROVIDER_CATALOG: Record<
  string,
  { label: string; placeholder: string; keyFormat: string }
> = {
  anthropic: {
    label: "Anthropic (Claude)",
    placeholder: "sk-ant-…",
    keyFormat: "^sk-ant-",
  },
  openai: { label: "OpenAI", placeholder: "sk-…", keyFormat: "^sk-" },
  google: {
    label: "Google Gemini",
    placeholder: "AIza…",
    keyFormat: "^AIza",
  },
};

/** @deprecated See {@link PROVIDER_CATALOG}. */
export const ALL_PROVIDERS: {
  id: AiProvider;
  label: string;
  placeholder: string;
}[] = (["anthropic", "openai", "google"] as const).map((id) => ({
  id,
  label: PROVIDER_CATALOG[id].label,
  placeholder: PROVIDER_CATALOG[id].placeholder,
}));
