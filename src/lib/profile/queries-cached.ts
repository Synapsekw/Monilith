import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { profileTag } from "@/lib/cache/tags";

/**
 * Cached read of a user's personal display timezone (null = Automatic / unset).
 * `userId` is read OUTSIDE this scope (via the cookie-bound session helpers) and
 * passed in, so it is part of the cache key AND the cacheTag — cross-tenant
 * isolation holds by construction. Uses the cookie-free service client with an
 * EXPLICIT `id = userId` filter (that filter is the tenant boundary; the service
 * client bypasses RLS), mirroring `listMyBoardsCached` / `isOrgAdminCached`.
 *
 * Invalidation: `updateProfileTimezone` calls `updateTag(profileTag(userId))`
 * for immediate read-your-own-writes across every route; otherwise TTL-bounded
 * by `cacheLife("nav")`.
 */
export async function getUserTimeZoneCached(
  userId: string,
): Promise<string | null> {
  "use cache";
  cacheLife("nav");
  cacheTag(profileTag(userId));

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  return data?.timezone ?? null;
}
