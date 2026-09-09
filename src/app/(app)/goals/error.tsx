"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function GoalsError({
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
      title="Couldn't load goals"
      description="Something failed while loading goals data. Your data is safe — try again."
    />
  );
}
