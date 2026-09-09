"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

/** Catch-all boundary for `/ask` and `/ask/[conversationId]`. This segment
 *  sits outside the `(app)` group (so it doesn't inherit that group's
 *  error.tsx) and previously fell all the way back to the root boundary. */
export default function AskError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorFallback error={error} retry={retry} />;
}
