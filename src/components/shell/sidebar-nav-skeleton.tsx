import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallback for the streamed sidebar nav. Rows match BoardsNav/
 * DashboardsNav heights so streamed content swaps in with zero layout shift.
 */
export function SidebarNavSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading navigation"
      className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-2"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}
