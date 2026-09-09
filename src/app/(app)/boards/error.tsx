"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function BoardsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorFallback
      error={error}
      retry={retry}
      title="Couldn't load boards"
      description="Something failed while loading this board data. Your data is safe — try again."
    />
  );
}
