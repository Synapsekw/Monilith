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
  // A user may now hold ONE KEY PER PROVIDER: migration 20260810173752 dropped
  // the clear-every-other-provider loop from `ai_credential_set`. The 1-arg
  // `ai_credential_get(p_user)` returns every one of those rows and its SQL body
  // has NO `order by`, so `data[0]` is whatever row Postgres happened to emit
  // first — which key a `per_user` run spends could differ between two
  // otherwise identical invocations. Sorting by provider makes that choice
  // arbitrary but STABLE, so the behaviour is at least reproducible and
  // debuggable.
  //
  // STOPGAP, deliberately: the right answer is to resolve the provider the
  // caller actually asked for, which is what Task 5 does via the 2-arg
  // `ai_credential_get(p_user, p_provider)` overload. This sort disappears with
  // that change. Copied before sorting so `data` is never mutated in place.
  const row = [...(data ?? [])].sort((a, b) =>
    a.provider.localeCompare(b.provider),
  )[0];
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

/**
 * RLS self-read for the settings page: one of the user's credentials, or null
 * when they have none.
 *
 * Multi-row tolerant on purpose. Migration 20260810173752 made credentials
 * per-provider, so a user can hold several rows. This read previously used
 * `.maybeSingle()` filtered only on `user_id` AND discarded the error — with a
 * second row PostgREST errors, `data` came back null, and the settings page
 * rendered "no key configured" while the user's keys existed and were
 * unmanageable from the UI. A swallowed error that degrades into a *false empty
 * state* is worse than a loud failure, so: bound the read to one row instead of
 * asserting there is only one, order it so the same request keeps returning the
 * same credential, and let a genuine database fault surface rather than
 * impersonating "you have no key".
 *
 * STOPGAP for today's single-credential UI. Task 5 replaces this with a
 * per-provider list; until then the page deliberately shows exactly one.
 */
export async function getMyAiCredential(): Promise<{
  provider: AiProvider;
  hint: string;
  updatedAt: string;
} | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_ai_credentials")
    .select("provider, key_hint, updated_at")
    .eq("user_id", user.id)
    .order("provider")
    .limit(1);
  if (error) throw new Error(`getMyAiCredential: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return {
    provider: row.provider as AiProvider,
    hint: row.key_hint,
    updatedAt: row.updated_at,
  };
}
