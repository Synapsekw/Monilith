/** Read-only renderers for the virtual creation-metadata columns. Pure: they
 *  take resolved primitives, not DB rows, so the table and the item panel can
 *  both reuse them. */

import Image from "next/image";

/**
 * Format a creation timestamp for the board table / item panel.
 *
 * Deliberately NOT `formatDateTime` from `@/lib/datetime/format`: this one is
 * null/invalid-tolerant (renders "" instead of throwing/"Invalid Date"), and
 * these cells SSR inside client components, where swapping the formatter
 * would change rendered output. Both formatters share the undefined-locale
 * hazard of gotcha-50 (`toLocale*`/`Intl` default locale differs Node vs
 * browser) — if a hydration mismatch ever surfaces here, pin "en-US" per the
 * board convention rather than delegating to the lib helper.
 */
export function formatCreatedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function CreatedByCell({
  name,
  avatarUrl,
  showAvatar = true,
}: {
  name: string | null;
  avatarUrl?: string | null;
  /** When false, render the name as plain text only (no avatar). Used by the
   *  read-only table columns; the item panel keeps the avatar. */
  showAvatar?: boolean;
}) {
  if (!name)
    return (
      <span className="text-muted-foreground text-xs opacity-60">Unknown</span>
    );
  return (
    <span className="flex items-center gap-2 truncate text-xs opacity-60">
      {showAvatar ? (
        <span className="bg-surface-muted flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-medium">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              width={20}
              height={20}
              unoptimized
              className="size-full object-cover"
            />
          ) : (
            initials(name)
          )}
        </span>
      ) : null}
      <span className="truncate">{name}</span>
    </span>
  );
}

export function CreatedAtCell({ iso }: { iso: string | null }) {
  const formatted = formatCreatedAt(iso);
  if (!formatted) return <span className="text-xs" />;
  return (
    <span className="font-mono text-xs tabular-nums opacity-60">
      {formatted}
    </span>
  );
}
