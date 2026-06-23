import type { ReactNode } from "react";
import { getUserTimeZone } from "@/lib/auth/session";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";

/**
 * Resolves the user timezone in its own streamed boundary so the static shell
 * doesn't block on it, then provides it to page content.
 */
export async function TimeZoneBoundary({ children }: { children: ReactNode }) {
  const timeZone = await getUserTimeZone();
  return <TimeZoneProvider timeZone={timeZone}>{children}</TimeZoneProvider>;
}
