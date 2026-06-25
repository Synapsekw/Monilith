import { TimeCardSkeleton } from "@/components/time/TimeCardSkeleton";

/** Instant loading fallback for the time card. Static Server Component. */
export default function TimeLoading() {
  return <TimeCardSkeleton />;
}
