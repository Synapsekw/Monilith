"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

/** In-shell catch-all boundary — renders inside AuthenticatedShell and also
 *  covers settings/ and workload/, which have no segment boundary of their own. */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorFallback error={error} retry={unstable_retry} />;
}
