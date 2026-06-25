import { GoalTreeSkeleton } from "@/components/goals/GoalTreeSkeleton";

/** Instant loading fallback for the goals page. Static Server Component. */
export default function GoalsLoading() {
  return <GoalTreeSkeleton />;
}
