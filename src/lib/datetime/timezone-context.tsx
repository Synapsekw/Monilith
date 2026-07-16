"use client";

import { createContext, use, useContext, type ReactNode } from "react";

/** The user's zone as an IANA id, or null = Automatic. It may still be an
 * unresolved promise streamed from the shell (the timezone read is not awaited
 * before content paints). */
type TimeZoneValue = string | null | Promise<string | null>;
const TimeZoneContext = createContext<TimeZoneValue>(null);

export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: TimeZoneValue;
  children: ReactNode;
}) {
  return (
    <TimeZoneContext.Provider value={timeZone}>
      {children}
    </TimeZoneContext.Provider>
  );
}

/** The user's zone, or null (Automatic). While the shell's promise is
 * unresolved this suspends the CALLING component only. Wrap consumers in a
 * local <Suspense> with no date text so a wrong-timezone value can't flash. */
export function useTimeZone(): string | null {
  const v = useContext(TimeZoneContext);
  return v !== null && typeof v === "object" && "then" in v ? use(v) : v;
}
