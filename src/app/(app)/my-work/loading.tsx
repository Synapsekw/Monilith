import { MyWorkSkeleton } from "@/components/my-work/MyWorkSkeleton";

/** Instant loading fallback for the My Work page. Static Server Component. */
export default function MyWorkLoading() {
  return <MyWorkSkeleton />;
}
