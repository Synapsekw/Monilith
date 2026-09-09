"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function TimeError({
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
      title="Couldn't load time tracking"
      description="Something failed while loading time data. Your data is safe — try again."
    />
  );
}
