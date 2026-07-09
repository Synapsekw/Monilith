import { BoardsIndexSkeleton } from "@/components/boards/BoardsIndexSkeleton";

/** Instant loading fallback for the boards index. Static Server Component. */
export default function BoardsLoading() {
  return <BoardsIndexSkeleton />;
}
