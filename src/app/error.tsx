"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

/** Root catch-all boundary — covers admin/, home/, onboarding/, updates/,
 *  landing/ and (auth)/ segments that lack a closer error.tsx. */
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorFallback error={error} retry={unstable_retry} />;
}
