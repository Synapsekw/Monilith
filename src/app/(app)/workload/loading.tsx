import { WorkloadGridSkeleton } from "@/components/workload/WorkloadGridSkeleton";

/** Instant loading fallback for the workload grid. Static Server Component. */
export default function WorkloadLoading() {
  return <WorkloadGridSkeleton />;
}
