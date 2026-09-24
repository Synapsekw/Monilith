import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for the folder gallery (`/dashboards`). A 6-card
 * grid mirrors `FolderGallery`'s layout so the real cards swap in with
 * minimal layout shift. Static Server Component — no data fetch.
 */
export default function DashboardsLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading folders"
      className="flex flex-col gap-6 p-4 md:p-6"
    >
      <Skeleton className="h-6 w-48" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}
