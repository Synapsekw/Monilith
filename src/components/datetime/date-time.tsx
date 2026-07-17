"use client";

import { useResolvedTimeZone } from "@/lib/datetime/timezone-context";
import { useDeviceTimeZone } from "@/lib/datetime/device-timezone";
import { formatDateTime } from "@/lib/datetime/format";

/**
 * The single app-wide primitive for rendering an absolute timestamp. It paints
 * a correct, human-readable value on FIRST paint — the device zone (Automatic,
 * the majority) or the explicit personal zone once the streamed promise
 * resolves — instead of blanking. `suppressHydrationWarning` because the seeded
 * cookie zone and the client-detected zone can differ by a text swap (never a
 * layout jump); the `dateTime` attr is always the stable machine-readable ISO.
 * The only blank is a first-ever visit with no cookie, filled at hydration.
 */
export function DateTime({
  value,
  className,
}: {
  value: string | number | Date;
  className?: string;
}) {
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString();
  const deviceZone = useDeviceTimeZone();
  const zone = useResolvedTimeZone(deviceZone);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {zone ? formatDateTime(date, { timeZone: zone }) : ""}
    </time>
  );
}
