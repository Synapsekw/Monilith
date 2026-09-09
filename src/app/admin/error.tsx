"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

/** Catch-all boundary for `/admin` and its sub-routes (organizations/,
 *  feedback/, audit/, users/). This segment sits outside the `(app)` group
 *  (its own layout runs `requirePlatformAdmin` before any Suspense boundary)
 *  and previously fell all the way back to the root boundary. */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorFallback error={error} retry={retry} />;
}
