"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function ReportsError({
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
      title="Couldn't load reports"
      description="Something failed while loading your reports. Your data is safe — try again."
    />
  );
}
