import {
  isAuthApiError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";

/**
 * Why resolving a connection's Supabase session failed. The distinction decides
 * whether `getRequestClient` may mint a replacement session ("self-heal").
 */

/**
 * A POSITIVE signal that the stored session is gone for good: GoTrue said the
 * refresh token or its session no longer exists, or the Vault secret the token
 * row points at is missing. Only this error heals.
 */
export class BridgeSessionDeadError extends Error {
  readonly name = "BridgeSessionDeadError";
  constructor(readonly reason: string) {
    super(`The stored session is no longer valid (${reason}).`);
  }
}

/**
 * Anything that is NOT proof of a dead session: a network failure, a GoTrue
 * 5xx or rate limit, a Vault RPC error, an unreadable payload, a self-heal
 * that is already under way. The tool call fails with a message that tells the
 * client to retry, and the stored state is left exactly as it was.
 */
export class BridgeUnavailableError extends Error {
  readonly name = "BridgeUnavailableError";
  readonly retryable = true;
  constructor(readonly reason: string) {
    super(
      "Monolith could not reach its sign-in service just now. Nothing was changed. Please retry in a moment.",
    );
  }
}

/** The token row is gone: the connection was revoked while a call was in flight. */
export class BridgeRevokedError extends Error {
  readonly name = "BridgeRevokedError";
  constructor() {
    super("This connection was revoked. Reconnect the app to continue.");
  }
}

/**
 * GoTrue error codes that mean "this refresh token will never work again".
 * Read from the installed `@supabase/auth-js` (`lib/error-codes.d.ts`) and the
 * GoTrue refresh grant:
 *   - refresh_token_not_found    the token (or its session) was deleted — what
 *                                a sign-out, global or local, leaves behind
 *   - refresh_token_already_used reused outside GoTrue's reuse interval; GoTrue
 *                                revokes the whole token family when it sees it
 *   - session_not_found          the session row is gone (auth-js surfaces this
 *                                one as AuthSessionMissingError, handled below)
 *   - session_expired            the project's session time-box or inactivity
 *                                timeout ended the session
 *
 * Deliberately a whitelist matched on `code`, never on message text or on
 * "any 4xx": a 429, a 5xx, a fetch failure and an error with no code all stay
 * out, so an outage can never be read as a dead session.
 */
const DEAD_SESSION_CODES: ReadonlySet<string> = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
]);

/** True only for an auth error that positively means the session is dead. */
export function isDeadSessionError(error: unknown): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return (
    isAuthApiError(error) &&
    typeof error.code === "string" &&
    DEAD_SESSION_CODES.has(error.code)
  );
}

/** A short, log-safe description of an auth error: class, status and code only. */
export function describeAuthError(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; status?: unknown; code?: unknown };
    return [e.name, e.status, e.code]
      .filter((v) => typeof v === "string" || typeof v === "number")
      .join(" ");
  }
  return "unknown error";
}
