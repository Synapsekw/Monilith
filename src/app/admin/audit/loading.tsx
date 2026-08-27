import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for the platform audit log. Mirrors AdminAudit's
 * `space-y-5` column: header, one `rounded-xl border p-4` card wrapping the
 * ActivityFeed's `divide-y` rows (label left, timestamp right), then the pager.
 * Static Server Component — no data fetch.
 */
export default function AdminAuditLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading audit log"
      className="space-y-5"
    >
      <div data-testid="skeleton-header" className="flex flex-col gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="bg-surface rounded-xl border p-4">
        <ul className="divide-border divide-y">
          {Array.from({ length: 12 }).map((_, i) => (
            <li
              key={i}
              data-testid="audit-row-skeleton"
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <Skeleton className="h-4 w-full max-w-64" />
              <Skeleton className="h-3 w-32 shrink-0" />
            </li>
          ))}
        </ul>
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
