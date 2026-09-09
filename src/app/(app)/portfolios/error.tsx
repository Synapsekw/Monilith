"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function PortfoliosError({
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
      title="Couldn't load portfolios"
      description="Something failed while loading portfolio data. Your data is safe — try again."
    />
  );
}
