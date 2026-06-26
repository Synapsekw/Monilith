/** Read-only renderers for the virtual creation-metadata columns. Pure: they
 *  take resolved primitives, not DB rows, so the table and the item panel can
 *  both reuse them. */

export function formatDateTime(iso: string | null): string {
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
}: {
  name: string | null;
  avatarUrl?: string | null;
}) {
  if (!name)
    return (
      <span className="text-muted-foreground text-xs opacity-60">Unknown</span>
    );
  return (
    <span className="flex items-center gap-2 truncate text-xs opacity-60">
      <span className="bg-surface-muted flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-medium">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          initials(name)
        )}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function CreatedAtCell({ iso }: { iso: string | null }) {
  const formatted = formatDateTime(iso);
  if (!formatted) return <span className="text-xs" />;
  return <span className="text-xs tabular-nums opacity-60">{formatted}</span>;
}
