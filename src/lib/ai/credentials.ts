import "server-only";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { PersonalAiKeyMissingError } from "@/lib/ai/errors";
import { getAdapter } from "@/lib/ai/providers/registry";
import { getProviderRow } from "@/lib/ai/providers/provider-rows";
import type { ProviderAdapter } from "@/lib/ai/providers/types";

/**
 * Opaque marker that a userId was ESTABLISHED — not merely passed through —
 * by a trusted, server-side-scoped source (a session via requireUser(), or a
 * service-role read keyed by an already-verified request, e.g. HMAC
 * verification), never taken directly from request/query/body input. This
 * does no runtime verification of its own — it's a type-level checkpoint, a
 * speed bump against ACCIDENTALLY handing `resolveUserAdapterById` a bare
 * string, not a defence against a deliberately careless cast. Only construct
 * one at the point where trust is actually established, with a comment
 * saying what establishes it right there — never further upstream, and never
 * on a value read straight from user input.
 */
export type TrustedUserId = string & { readonly __brand: unique symbol };

/** Assert that `id` came from a trusted, server-side-scoped source. See
 *  {@link TrustedUserId}. */
export function asTrustedUserId(id: string): TrustedUserId {
  return id as TrustedUserId;
}

/**
 * Session-less resolver for service-role/cron callers. Now takes the PROVIDER
 * as well as the user: an agent pinned to Kimi must resolve the user's Kimi
 * key, not whichever key happens to be first. The TrustedUserId contract is
 * unchanged — see the type's doc comment for what establishes trust.
 *
 * `ai_credential_get` is itself `security definer`, revoked from
 * `anon`/`authenticated`, and granted only to `service_role` — so this
 * function exposes no NEW database privilege — but the app-level discipline
 * of "never resolve a stranger's key" previously lived only in
 * `resolveUserAdapter`'s `requireUser()` call; this is that same discipline
 * made a type-level requirement for a session-less caller instead.
 *
 * Throws `PersonalAiKeyMissingError` (a narrower `AiNotConfiguredError`, see
 * `errors.ts`) when that specific user has no stored credential for the
 * requested provider, or the provider is unknown/disabled — a per-user
 * configuration state, not a platform fault.
 */
export async function resolveUserAdapterById(
  userId: TrustedUserId,
  provider: string,
): Promise<{
  adapter: ProviderAdapter;
  apiKey: string;
  baseUrl: string | null;
}> {
  const svc = createServiceClient();
  const [{ data, error }, row] = await Promise.all([
    svc.rpc("ai_credential_get", { p_user: userId, p_provider: provider }),
    getProviderRow(svc, provider),
  ]);
  if (error) throw error;
  if (!row || !row.enabled) throw new PersonalAiKeyMissingError();
  const secret = data?.[0];
  if (!secret) throw new PersonalAiKeyMissingError();
  return {
    adapter: getAdapter(row.adapterKind),
    apiKey: secret.secret,
    baseUrl: row.baseUrl,
  };
}

/** Masked preview safe to persist/show, e.g. "sk-ant-…AB12". */
export function maskKey(rawKey: string): string {
  const k = rawKey.trim();
  const last4 = k.slice(-4);
  const head = k.slice(0, Math.max(0, k.length - 4)).slice(0, 7);
  return `${head}…${last4}`;
}

/** RLS self-read for the settings page: ALL of the user's keys, one per provider. */
export async function listMyAiCredentials(): Promise<
  { provider: string; hint: string; updatedAt: string }[]
> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_ai_credentials")
    .select("provider, key_hint, updated_at")
    .eq("user_id", user.id)
    .order("provider");
  return (data ?? []).map((r) => ({
    provider: r.provider,
    hint: r.key_hint,
    updatedAt: r.updated_at,
  }));
}
