"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shared fallback body for route-level error boundaries (error.tsx files).
 * Copy must not depend on error.message — Next strips server error messages
 * in production; only `digest` survives (shown for support correlation).
 */
export function ErrorFallback({
  error,
  retry,
  title = "Something went wrong",
  description = "An unexpected error kept this page from loading. Your data is safe.",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  description?: string;
}) {
  useEffect(() => {
    // Observability: route errors would otherwise vanish client-side.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="text-foreground text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      <Button onClick={retry} className="mt-2">
        Try again
      </Button>
      {error.digest ? (
        <p className="text-muted-foreground text-xs">
          Error code: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
