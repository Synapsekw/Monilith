import "server-only";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { AiNotConfiguredError } from "@/lib/ai/errors";
import { getAdapter } from "@/lib/ai/providers/registry";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import type { AiProvider } from "@/lib/ai/providers/catalog";

/** Shared decrypt + adapter-resolve step for a KNOWN user id. Throws
 *  AiNotConfiguredError when that user has no stored credential. Both
 *  resolveUserAdapter (session-derived id) and resolveUserAdapterById
 *  (caller-supplied id) funnel through here so the decryption/lookup logic
 *  exists exactly once. */
async function loadUserAdapter(userId: string): Promise<{
  adapter: ProviderAdapter;
  apiKey: string;
}> {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("ai_credential_get", {
    p_user: userId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new AiNotConfiguredError();
  return {
    adapter: getAdapter(row.provider as AiProvider),
    apiKey: row.secret,
  };
}

/** The current (session) user's provider adapter + decrypted key, or throws
 *  when unset. Cookie-bound via requireUser() — only usable inside a request
 *  that actually has a session. */
export async function resolveUserAdapter(): Promise<{
  adapter: ProviderAdapter;
  apiKey: string;
}> {
  const user = await requireUser();
  return loadUserAdapter(user.id);
}

/**
 * Session-less sibling of resolveUserAdapter, for server-role/cron callers
 * that have no cookie session but already know — from their own scoped data,
 * not from user input — WHICH user's key this run should spend (e.g. the
 * personal-agent sweep resolving the agent owner's key via the `userId` it
 * also hands `runAi` for ledger attribution). Trusts `userId` completely: it
 * does not re-derive or verify identity the way resolveUserAdapter's
 * requireUser() does, so only ever call it with an id a trusted server-side
 * path already scoped.
 */
export async function resolveUserAdapterById(userId: string): Promise<{
  adapter: ProviderAdapter;
  apiKey: string;
}> {
  return loadUserAdapter(userId);
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
