"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function GoalsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErrorFallback
      error={error}
      retry={unstable_retry}
      title="Couldn't load goals"
      description="Something failed while loading goals data. Your data is safe — try again."
    />
  );
}
