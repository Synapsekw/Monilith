import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for a feedback detail page. Mirrors the page's
 * `mx-auto max-w-2xl space-y-5` column — back link, header, then
 * AdminFeedbackDetail's two `rounded-xl border p-6` cards (the report, then the
 * triage controls). Static Server Component — no data fetch.
 */
export default function AdminFeedbackDetailLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading feedback detail"
      className="mx-auto max-w-2xl space-y-5"
    >
      <Skeleton className="h-4 w-36" />

      <div data-testid="skeleton-header" className="flex flex-col gap-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="space-y-8">
        <div
          data-testid="report-card-skeleton"
          className="bg-surface rounded-xl border p-6"
        >
          <div className="mb-1 flex items-center gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-6 w-3/4" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>

        <div
          data-testid="triage-card-skeleton"
          className="bg-surface rounded-xl border p-6"
        >
          <Skeleton className="mb-4 h-4 w-16" />
          <div className="mb-4">
            <Skeleton className="mb-1.5 h-3 w-12" />
            <Skeleton className="h-8 w-28" />
          </div>
          <div className="mb-5">
            <Skeleton className="mb-1.5 h-3 w-48" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
    </div>
  );
}
