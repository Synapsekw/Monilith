import "server-only";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  clientFromAccessToken,
  mintSessionForUser,
} from "@/lib/mcp/oauth/session-bridge";

/**
 * A request-scoped client authenticated as a Mono (a no-login bot user), so
 * RLS judges every read and write by the Mono's own memberships.
 *
 * Never refreshes. A cached access token is reused until it is within
 * REMINT_BUFFER_MS of expiry, then a brand-new session is minted. Nothing is
 * stored outside this process, so there is no refresh token to rotate,
 * race or lose (the failure that silently broke the old scheduled agents).
 */
const REMINT_BUFFER_MS = 5 * 60 * 1000;

type Cached = { accessToken: string; expiresAt: number };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();

function toCached(session: Session): Cached {
  const expiresAt = session.expires_at
    ? session.expires_at * 1000
    : Date.now() + (session.expires_in ?? 3600) * 1000;
  return { accessToken: session.access_token, expiresAt };
}

async function freshToken(monoUserId: string): Promise<Cached> {
  const hit = cache.get(monoUserId);
  if (hit && hit.expiresAt - Date.now() > REMINT_BUFFER_MS) return hit;
  const pending = inflight.get(monoUserId);
  if (pending) return pending;
  const p = mintSessionForUser(monoUserId)
    .then((s) => {
      const c = toCached(s);
      cache.set(monoUserId, c);
      return c;
    })
    .finally(() => inflight.delete(monoUserId));
  inflight.set(monoUserId, p);
  return p;
}

export async function getMonoClient(
  monoUserId: string,
): Promise<SupabaseClient<Database>> {
  const { accessToken } = await freshToken(monoUserId);
  return clientFromAccessToken(accessToken);
}

export function __resetMonoSessionCache(): void {
  cache.clear();
  inflight.clear();
}
