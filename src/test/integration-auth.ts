import type { AuthError, SupabaseClient } from "@supabase/supabase-js";

// The exact return type of GoTrue's signInWithPassword, so this helper is a
// drop-in replacement: callers that destructure `{ error }` (or `{ data }`)
// keep compiling unchanged.
type SignInResult = Awaited<
  ReturnType<SupabaseClient["auth"]["signInWithPassword"]>
>;

// Any Supabase client exposes the same GoTrue auth surface regardless of its
// Database generic, so match structurally instead of pinning the generic.
type AuthCapable = {
  auth: Pick<SupabaseClient["auth"], "signInWithPassword">;
};

const isRateLimited = (error: AuthError): boolean =>
  error.status === 429 || error.code === "over_request_rate_limit";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sign in against the cloud dev project, retrying with exponential backoff when
 * GoTrue replies 429 `over_request_rate_limit`.
 *
 * The integration suites collectively fire dozens of `signInWithPassword` calls
 * per run against one shared project from one IP; bursts trip GoTrue's auth rate
 * limit. The 429 surfaces two ways: loudly (suites that assert the sign-in
 * error) or silently — an unauthenticated client whose `create_organization`
 * then returns `null`, blowing up later as `Cannot read properties of null`.
 * Riding out the limit here fixes both. Pairs with the serialized `integration`
 * Vitest project (vitest.config.ts), which keeps the burst rate down.
 *
 * Only rate-limit errors are retried; any other auth error is returned
 * immediately so genuine failures stay fast and visible.
 */
export async function signInWithRetry(
  client: AuthCapable,
  credentials: { email: string; password: string },
  maxAttempts = 6,
): Promise<SignInResult> {
  let result = await client.auth.signInWithPassword(credentials);

  for (
    let attempt = 1;
    result.error && isRateLimited(result.error) && attempt < maxAttempts;
    attempt++
  ) {
    // 1s, 2s, 4s, 8s, 16s … capped at 16s, plus jitter to desync retries that
    // were throttled together.
    const backoff = Math.min(16_000, 1_000 * 2 ** (attempt - 1));
    await sleep(backoff + Math.floor(Math.random() * 250));
    result = await client.auth.signInWithPassword(credentials);
  }

  return result;
}

/**
 * Provisioning-grade sign-in: rides out 429s via signInWithRetry, then THROWS
 * if the client is still unauthenticated. The bare signInWithRetry call-sites
 * discarded the error, so an exhausted backoff yielded a silently-unauthenticated
 * client whose create_organization returned null — surfacing far away as a
 * confusing NPE. Throwing here fails loud + immediate; the integration project's
 * `retry: 1` then gives the file one clean re-run.
 */
export async function signInOrThrow(
  client: AuthCapable,
  credentials: { email: string; password: string },
  label?: string,
): Promise<void> {
  const { error } = await signInWithRetry(client, credentials);
  if (error) {
    throw new Error(
      `sign-in failed for ${label ?? credentials.email}: ${error.message}`,
    );
  }
}
