import type { ReactNode } from "react";
import { getUser } from "@/lib/auth/session";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";

/**
 * Resolves the user timezone in its own streamed boundary so the static shell
 * doesn't block on it, then provides it to page content. Identity is read
 * OUTSIDE the cache (cookie-bound `getUser`, cheap local verify) and passed into
 * the `use cache` read so the value is shared across routes and invalidated by
 * `updateTag(profileTag(userId))` on save (Phase 9.3 rule).
 */
export async function TimeZoneBoundary({ children }: { children: ReactNode }) {
  const user = await getUser();
  const timeZone = user ? await getUserTimeZoneCached(user.id) : null;
  return <TimeZoneProvider timeZone={timeZone}>{children}</TimeZoneProvider>;
}
