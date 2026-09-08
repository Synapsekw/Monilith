import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for the legacy `/boards/[boardId]/reports/[reportId]`
 * deep link. The page itself only redirects to `/reports/[reportId]` (the
 * builder's real home) and reads nothing, so this rarely has anything to
 * cover — but it keeps the same header + block shape as the reports list
 * (`../loading.tsx`) rather than a bare frame for the instant it's visible.
 */
export default function LegacyReportBuilderLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading report"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
    >
      <div data-testid="report-header-skeleton" className="flex flex-col gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            data-testid="report-block-skeleton"
            className="bg-surface rounded-lg border p-4"
          >
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-24 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
