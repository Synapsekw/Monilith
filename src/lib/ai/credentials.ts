import "server-only";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { AiNotConfiguredError } from "@/lib/ai/anthropic";
import { getAdapter } from "@/lib/ai/providers/registry";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import type { AiProvider } from "@/lib/ai/providers/catalog";

/** The current user's provider adapter + decrypted key, or throws when unset. */
export async function resolveUserAdapter(): Promise<{
  adapter: ProviderAdapter;
  apiKey: string;
}> {
  const user = await requireUser();
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("ai_credential_get", {
    p_user: user.id,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new AiNotConfiguredError();
  return {
    adapter: getAdapter(row.provider as AiProvider),
    apiKey: row.secret,
  };
}

/** Masked preview safe to persist/show, e.g. "sk-ant-…AB12". */
export function maskKey(rawKey: string): string {
  const k = rawKey.trim();
  const last4 = k.slice(-4);
  const head = k.slice(0, Math.max(0, k.length - 4)).slice(0, 7);
  return `${head}…${last4}`;
}

/** RLS self-read for the settings page: the user's single credential, or null. */
export async function getMyAiCredential(): Promise<{
  provider: AiProvider;
  hint: string;
  updatedAt: string;
} | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_ai_credentials")
    .select("provider, key_hint, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    provider: data.provider as AiProvider,
    hint: data.key_hint,
    updatedAt: data.updated_at,
  };
}
