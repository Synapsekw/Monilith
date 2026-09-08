import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading fallback for the `(auth)` group (login, signup,
 * forgot-password, change-password). The group shares one layout
 * (`AuthLayout`) that centers a single card, so one loader covers every
 * route in it rather than four near-identical per-route files.
 *
 * A centered card skeleton — heading + a few field-shaped rows + a
 * full-width action — mirroring the card `AuthLayout` centers in its
 * `max-w-sm` column.
 */
export default function AuthLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      data-testid="auth-card-skeleton"
      className="flex w-full flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
