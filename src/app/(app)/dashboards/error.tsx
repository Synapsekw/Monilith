"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function DashboardsError({
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
      title="Couldn't load dashboards"
      description="Something failed while loading dashboard data. Your data is safe — try again."
    />
  );
}
