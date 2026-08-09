import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for the report builder. Static Server Component —
 * no hooks, no data fetch.
 *
 * Mirrors ReportBuilder's frame exactly (`grid-cols-[320px_1fr]` inside a
 * `100dvh` box) so the rail does not jump sideways when the real builder
 * commits: a config rail of bordered sections on the left, one tall document
 * placeholder on the right.
 */
export default function ReportBuilderLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading report builder"
      className="grid grid-cols-[320px_1fr]"
      style={{ height: "100dvh" }}
    >
      <div className="flex flex-col gap-4 overflow-hidden border-r p-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-40" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            data-testid="builder-section-skeleton"
            className="bg-surface flex flex-col gap-2 rounded-lg border p-3"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-28 w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      <div className="flex justify-center overflow-hidden p-6">
        <Skeleton
          data-testid="builder-preview-skeleton"
          className="h-full w-full max-w-3xl"
        />
      </div>
    </div>
  );
}
