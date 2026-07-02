"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function TimeError({
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
      title="Couldn't load time tracking"
      description="Something failed while loading time data. Your data is safe — try again."
    />
  );
}
