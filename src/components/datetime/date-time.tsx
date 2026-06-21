"use client";

import { useTimeZone } from "@/lib/datetime/timezone-context";
import { formatDateTime } from "@/lib/datetime/format";

/** The single app-wide primitive for rendering an absolute timestamp. */
export function DateTime({
  value,
  className,
}: {
  value: string | number | Date;
  className?: string;
}) {
  const tz = useTimeZone();
  const date = value instanceof Date ? value : new Date(value);
  return (
    <time
      dateTime={date.toISOString()}
      className={className}
      suppressHydrationWarning
    >
      {formatDateTime(date, { timeZone: tz ?? undefined })}
    </time>
  );
}
