import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { profileTag } from "@/lib/cache/tags";
import {
  DEFAULT_THEME_PRESET,
  isThemePresetId,
  type ThemePresetId,
} from "@/lib/theme/presets";

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

/**
 * Cached read of a user's theme preset. Same shape and invalidation contract as
 * `getUserTimeZoneCached` above — `userId` is the cache key AND the cacheTag, and
 * the service client carries an explicit `id = userId` filter as the tenant
 * boundary.
 *
 * The column is free text (the id list lives in app code), so the value is
 * NARROWED here: anything the running build does not know — a preset removed in
 * a later release, a row written by an older one — falls back to the default
 * rather than stamping an attribute with no CSS block behind it.
 */
export async function getUserThemePresetCached(
  userId: string,
): Promise<ThemePresetId> {
  "use cache";
  cacheLife("nav");
  cacheTag(profileTag(userId));

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("theme_preset")
    .eq("id", userId)
    .maybeSingle();
  const value = data?.theme_preset;
  return isThemePresetId(value) ? value : DEFAULT_THEME_PRESET;
}
