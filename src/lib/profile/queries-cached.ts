import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { profileTag } from "@/lib/cache/tags";
import {
  DEFAULT_THEME_PRESET,
  DEFAULT_THEME_REACH,
  isThemePresetId,
  isThemeReachId,
  type ThemePresetId,
  type ThemeReachId,
} from "@/lib/theme/presets";

/** The raw columns of the one cached read. Plain, serializable values only —
 *  narrowing and defaults are applied by the getters below, outside the cache,
 *  so a build that learns a new id never has to wait out a stale entry. */
type ProfilePreferencesRow = {
  timezone: string | null;
  theme_preset: string | null;
  theme_reach: string | null;
  celebrate_done: boolean | null;
};

/**
 * THE cached read of a user's personal display preferences — one query, one
 * cache entry, for all four getters below. They used to be four `use cache`
 * functions with four selects under the same tag: four entries, so four
 * queries on every cold cache and after every `updateTag`.
 *
 * `userId` is read OUTSIDE this scope (via the cookie-bound session helpers)
 * and passed in, so it is part of the cache key AND the cacheTag — cross-tenant
 * isolation holds by construction. Uses the cookie-free service client with an
 * EXPLICIT `id = userId` filter (that filter is the tenant boundary; the service
 * client bypasses RLS), mirroring `listMyBoardsCached` / `isOrgAdminCached`.
 *
 * Invalidation: every profile-preference action (`updateProfileTimezone`,
 * `updateProfileThemePreset`, `updateProfileThemeReach`,
 * `updateProfileCelebrateDone`) calls `updateTag(profileTag(userId))` for
 * immediate read-your-own-writes across every route; otherwise TTL-bounded by
 * `cacheLife("nav")`.
 */
async function getProfilePreferencesCached(
  userId: string,
): Promise<ProfilePreferencesRow | null> {
  "use cache";
  cacheLife("nav");
  cacheTag(profileTag(userId));

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("profiles")
    .select("timezone, theme_preset, theme_reach, celebrate_done")
    .eq("id", userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * A user's personal display timezone (null = Automatic / unset). A selector
 * over the shared cached read above.
 */
export async function getUserTimeZoneCached(
  userId: string,
): Promise<string | null> {
  const row = await getProfilePreferencesCached(userId);
  return row?.timezone ?? null;
}

/**
 * A user's theme preset. A selector over the shared cached read above.
 *
 * The column is free text (the id list lives in app code), so the value is
 * NARROWED here: anything the running build does not know — a preset removed in
 * a later release, a row written by an older one — falls back to the default
 * rather than stamping an attribute with no CSS block behind it.
 */
export async function getUserThemePresetCached(
  userId: string,
): Promise<ThemePresetId> {
  const value = (await getProfilePreferencesCached(userId))?.theme_preset;
  return isThemePresetId(value) ? value : DEFAULT_THEME_PRESET;
}

/**
 * A user's theme reach. A selector over the shared cached read above, narrowed
 * exactly as the preset is: the column is free text, so anything the running
 * build does not know falls back to `DEFAULT_THEME_REACH`.
 */
export async function getUserThemeReachCached(
  userId: string,
): Promise<ThemeReachId> {
  const value = (await getProfilePreferencesCached(userId))?.theme_reach;
  return isThemeReachId(value) ? value : DEFAULT_THEME_REACH;
}

/**
 * Whether a user wants the done celebration. A selector over the shared cached
 * read above. Defaults to `true` (the column default) when the row is missing.
 */
export async function getUserCelebrateDoneCached(
  userId: string,
): Promise<boolean> {
  const row = await getProfilePreferencesCached(userId);
  return row?.celebrate_done ?? true;
}
