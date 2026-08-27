import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  /** Completes the `aria-label` — e.g. "users" → "Loading users". */
  label: string;
  /**
   * The page's column template, passed verbatim (e.g.
   * `"grid grid-cols-[2fr_1.4fr_1fr_0.8fr_90px] gap-3"`). It must be a literal
   * at the call site so Tailwind's scanner emits the arbitrary track sizes —
   * a composed string would never reach the generated CSS.
   */
  gridClass: string;
  /** Cell widths per row, one entry per column. `null` renders an empty cell. */
  cellWidths: (string | null)[];
  rows?: number;
  /** Which control strip sits above the table, if any. */
  toolbar?: "none" | "search" | "filters";
};

/**
 * Shared loading state for the three platform-admin list pages (users,
 * organizations, feedback). They are the same page shape — `space-y-5` header,
 * a control strip, one bordered grid table, a pager — differing only in column
 * template and toolbar, so the fallback is parameterized rather than copied
 * three times.
 *
 * Static Server Component: no hooks, no data fetch. That is the whole point —
 * `loading.tsx` wraps the page segment in a Suspense boundary, which is what
 * lets the admin pages await Supabase in their body without blocking the
 * navigation (see gotcha-48: route skeletons are Pulse's instant-nav
 * mechanism).
 */
export function AdminListSkeleton({
  label,
  gridClass,
  cellWidths,
  rows = 8,
  toolbar = "none",
}: Props) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={`Loading ${label}`}
      className="space-y-5"
    >
      <div data-testid="skeleton-header" className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      {toolbar === "search" && (
        <div data-testid="skeleton-toolbar" className="flex gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-24 shrink-0" />
        </div>
      )}

      {toolbar === "filters" && (
        <div
          data-testid="skeleton-toolbar"
          className="flex flex-wrap items-center gap-2"
        >
          <Skeleton className="h-3 w-10" />
          {["w-20", "w-12", "w-16"].map((w, i) => (
            <Skeleton key={`kind-${i}`} className={`h-7 ${w}`} />
          ))}
          <Skeleton className="ml-4 h-3 w-12" />
          {["w-24", "w-12", "w-16", "w-16", "w-24", "w-20", "w-20"].map(
            (w, i) => (
              <Skeleton key={`status-${i}`} className={`h-7 ${w}`} />
            ),
          )}
        </div>
      )}

      <div className="bg-surface overflow-hidden rounded-xl border">
        <div
          data-testid="skeleton-table-header"
          className={`${gridClass} border-b px-4 py-2.5`}
        >
          {cellWidths.map((_, i) => (
            <Skeleton key={i} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            data-testid="admin-row-skeleton"
            className={`${gridClass} items-center border-b px-4 py-3 last:border-b-0`}
          >
            {cellWidths.map((w, i) =>
              w === null ? (
                <span key={i} />
              ) : (
                <Skeleton key={i} className={`h-4 ${w}`} />
              ),
            )}
          </div>
        ))}
      </div>

      <div
        data-testid="skeleton-pager"
        className="flex items-center justify-end gap-2"
      >
        <Skeleton className="mr-2 h-3 w-14" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
      </div>
    </div>
  );
}
