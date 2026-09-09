"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

/** In-shell catch-all boundary — renders inside AuthenticatedShell and also
 *  covers settings/ and workload/, which have no segment boundary of their own. */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorFallback error={error} retry={retry} />;
}
