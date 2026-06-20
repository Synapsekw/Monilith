import Link from "next/link";

/**
 * Prev/Next pager for platform list pages. Two modes:
 * - Known total → pass `total`: shows "Page X of Y" and disables Next on the last page.
 * - Unknown total (e.g. the audit feed has no exact count) → omit `total` and pass
 *   `hasNext`: shows "Page X" and drives Next off the caller's lookahead.
 */
export function Pager({
  basePath,
  page,
  pageSize,
  total,
  hasNext,
  query,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total?: number;
  hasNext?: boolean;
  query?: string;
}) {
  const known = typeof total === "number";
  const lastPage = known ? Math.max(0, Math.ceil(total! / pageSize) - 1) : null;
  const nextEnabled = known ? page < lastPage! : Boolean(hasNext);
  const prevEnabled = page > 0;

  // Nothing to page through: known single page, or first page with no next.
  if (known && total! <= pageSize) return null;
  if (!known && !prevEnabled && !nextEnabled) return null;

  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (p > 0) params.set("page", String(p));
    const s = params.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const linkCls = "rounded-md border px-3 py-1.5";
  const disabledCls =
    "cursor-not-allowed rounded-md border px-3 py-1.5 opacity-40";

  return (
    <div className="text-muted-foreground flex items-center justify-end gap-2 text-sm">
      <span className="mr-2 text-xs">
        Page {page + 1}
        {known ? ` of ${lastPage! + 1}` : null}
      </span>
      {prevEnabled ? (
        <Link href={qs(page - 1)} className={linkCls}>
          ‹ Prev
        </Link>
      ) : (
        <span className={disabledCls}>‹ Prev</span>
      )}
      {nextEnabled ? (
        <Link href={qs(page + 1)} className={linkCls}>
          Next ›
        </Link>
      ) : (
        <span className={disabledCls}>Next ›</span>
      )}
    </div>
  );
}
