// Client-safe provider display metadata. Imported by both the server-only
// adapters and the client settings form, so it MUST NOT import "server-only"
// or any provider SDK.
export type AiProvider = "anthropic" | "openai" | "google";

export const PROVIDER_CATALOG: Record<
  AiProvider,
  { label: string; placeholder: string }
> = {
  anthropic: { label: "Anthropic (Claude)", placeholder: "sk-ant-…" },
  openai: { label: "OpenAI", placeholder: "sk-…" },
  google: { label: "Google Gemini", placeholder: "AIza…" },
};

export const ALL_PROVIDERS: {
  id: AiProvider;
  label: string;
  placeholder: string;
}[] = (["anthropic", "openai", "google"] as const).map((id) => ({
  id,
  ...PROVIDER_CATALOG[id],
}));
