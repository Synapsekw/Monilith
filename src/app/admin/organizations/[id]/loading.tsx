import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for a single organization's admin page. Mirrors
 * AdminOrgPage's `space-y-8` column: back link + header, the MembersTable
 * (`w-full text-sm` table with a bordered head and `divide-y` body), the AI
 * plan Card, then the activity section. Static Server Component — no data
 * fetch, which matters here because the page awaits three reads at once
 * (members RPC, audit, org AI settings).
 */
export default function AdminOrgLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading organization"
      className="space-y-8"
    >
      <div data-testid="skeleton-header" className="flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-1 h-6 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div data-testid="members-table-skeleton" className="space-y-3">
        <div className="border-border flex items-center gap-3 border-b py-2">
          {["w-20", "w-10", "w-12"].map((w, i) => (
            <Skeleton key={i} className={`h-3 ${w}`} />
          ))}
        </div>
        <div className="divide-border divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              data-testid="member-row-skeleton"
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-52" />
              </div>
              <Skeleton className="h-8 w-28 shrink-0" />
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      <div
        data-testid="ai-plan-card-skeleton"
        className="bg-surface rounded-xl border p-6"
      >
        <Skeleton className="h-5 w-20" />
        <Skeleton className="mt-2 h-4 w-full max-w-96" />
        <div className="mt-6 flex flex-wrap gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      <section className="space-y-3">
        <Skeleton className="h-4 w-20" />
        <ul className="divide-border divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
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
      </section>
    </div>
  );
}
