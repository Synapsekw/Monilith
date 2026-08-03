import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback for the streamed header user region (bell + avatar). */
export function HeaderUserSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading account"
      className="flex items-center gap-2"
    >
      <Skeleton variant="chrome" className="size-8" />
      <Skeleton variant="chrome" className="size-8 rounded-full" />
    </div>
  );
}
