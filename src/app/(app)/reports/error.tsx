"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function ReportsError({
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
      title="Couldn't load reports"
      description="Something failed while loading your reports. Your data is safe — try again."
    />
  );
}
