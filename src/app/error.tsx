"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

/** Root catch-all boundary — covers home/, onboarding/, updates/, landing/
 *  and (auth)/ segments that lack a closer error.tsx. admin/ and ask/ have
 *  their own boundaries now (`src/app/admin/error.tsx`, `src/app/ask/error.tsx`). */
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorFallback error={error} retry={unstable_retry} />;
}
