"use client";

import { Suspense } from "react";
import { useTimeZone } from "@/lib/datetime/timezone-context";
import { formatDateTime } from "@/lib/datetime/format";

/** Formats the timestamp once the streamed timezone resolves. Reading
 * useTimeZone() here suspends only this subtree (never page content) while the
 * shell's timezone promise is pending. */
function ResolvedDateTime({
  date,
  iso,
  className,
}: {
  date: Date;
  iso: string;
  className?: string;
}) {
  const tz = useTimeZone();
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {formatDateTime(date, { timeZone: tz ?? undefined })}
    </time>
  );
}

/** The single app-wide primitive for rendering an absolute timestamp. The local
 * <Suspense> fallback is an empty <time> (machine-readable, no visible text) so
 * a wrong-timezone value can never flash before the user's zone streams in. */
export function DateTime({
  value,
  className,
}: {
  value: string | number | Date;
  className?: string;
}) {
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString();
  return (
    <Suspense fallback={<time dateTime={iso} className={className} />}>
      <ResolvedDateTime date={date} iso={iso} className={className} />
    </Suspense>
  );
}
