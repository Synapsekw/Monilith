"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Resolved user timezone: an explicit IANA id, or null = Automatic. */
const TimeZoneContext = createContext<string | null>(null);

export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string | null;
  children: ReactNode;
}) {
  return (
    <TimeZoneContext.Provider value={timeZone}>
      {children}
    </TimeZoneContext.Provider>
  );
}

/** The signed-in user's preferred zone, or null when Automatic/unset. */
export function useTimeZone(): string | null {
  return useContext(TimeZoneContext);
}
