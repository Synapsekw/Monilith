import { Skeleton } from "@/components/ui/skeleton";

/** Route skeleton (gotcha-48: loading.tsx is the instant-nav mechanism). Mirrors header + tabs + six KPI cards. */
export default function FolderLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading command center"
      className="flex flex-col gap-3 p-4 md:p-6"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-9 w-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
