import { NotFoundFallback } from "@/components/shell/not-found-fallback";

export default function BoardNotFound() {
  return (
    <NotFoundFallback
      title="Board not found"
      description="This board may have been deleted, or you may not have access to it."
      backHref="/boards"
      backLabel="All boards"
    />
  );
}
