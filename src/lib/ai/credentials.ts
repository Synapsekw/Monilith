import "server-only";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { PersonalAiKeyMissingError } from "@/lib/ai/errors";
import { getAdapter } from "@/lib/ai/providers/registry";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import type { AiProvider } from "@/lib/ai/providers/catalog";

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
 * Session-less resolver for server-role/cron callers that have no cookie
 * session but already know — from their own scoped data, not from user
 * input — WHICH user's key a run should spend (e.g. `resolveAiAdapter`'s
 * `per_user` branch, resolving the personal-agent owner's key via the same
 * `userId` it also hands `runAi` for ledger attribution). The `TrustedUserId`
 * parameter exists so a bare `string` — e.g. one lifted straight from a
 * request — cannot be passed here by accident; the ONLY intended caller
 * (`resolveAiAdapter`) documents at its own call site what makes its
 * `userId` trustworthy. `ai_credential_get` is itself `security definer`,
 * revoked from `anon`/`authenticated`, and granted only to `service_role` —
 * so this function exposes no NEW database privilege — but the app-level
 * discipline of "never resolve a stranger's key" previously lived only in
 * `resolveUserAdapter`'s `requireUser()` call; this is that same discipline
 * made a type-level requirement for a session-less caller instead.
 *
 * Throws `PersonalAiKeyMissingError` (a narrower `AiNotConfiguredError`, see
 * `errors.ts`) when that specific user has no stored credential — a
 * per-user configuration state, not a platform fault.
 */
export async function resolveUserAdapterById(userId: TrustedUserId): Promise<{
  adapter: ProviderAdapter;
  apiKey: string;
}> {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("ai_credential_get", {
    p_user: userId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new PersonalAiKeyMissingError();
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
