import { Skeleton } from "@/components/ui/skeleton";

/** Rows per placeholder due-bucket section (Overdue / Today / Upcoming …). */
const SECTION_ROWS = [3, 4, 2];

/**
 * Loading state for the My Work page. Mirrors the page header (`border-b px-6
 * py-3`, title + hint) and MyWorkList's grouped-by-due layout: a centered
 * `max-w-3xl` column of `gap-8` sections, each with an uppercase bucket label +
 * count line and a bordered `divide-y` row list. Rows match the real ones
 * (`px-4 py-2.5`, two-line text block + status pill + due date). Static —
 * 0 data fetch.
 */
export function MyWorkSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading my work"
      className="flex h-full flex-col"
    >
      <div
        data-testid="skeleton-header"
        className="flex items-center justify-between border-b px-6 py-3"
      >
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <div className="flex flex-col gap-8">
            {SECTION_ROWS.map((rows, s) => (
              <section key={s} data-testid="bucket-section-skeleton">
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-6" />
                </div>
                <ul className="bg-surface divide-y overflow-hidden rounded-[14px] border">
                  {Array.from({ length: rows }).map((_, i) => (
                    <li
                      key={i}
                      data-testid="my-work-row-skeleton"
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-5 w-16 shrink-0" />
                      <Skeleton className="h-3 w-10 shrink-0" />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
