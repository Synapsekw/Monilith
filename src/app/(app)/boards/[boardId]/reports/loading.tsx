import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for a board's reports tab. `ReportsListPage` awaits
 * `listReportsForBoard` (and, org-permitting, `listReportTemplates`) before it
 * can render the list, so this is what shows for those bounded reads.
 *
 * Header (kicker + title + create button) above three report-row blocks.
 */
export default function ReportsListLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading reports"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
    >
      <div
        data-testid="reports-header-skeleton"
        className="flex items-end justify-between gap-4"
      >
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            data-testid="report-block-skeleton"
            className="bg-surface flex items-center justify-between gap-4 rounded-lg border p-4"
          >
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="size-7 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
