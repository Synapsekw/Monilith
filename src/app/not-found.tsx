import { NotFoundFallback } from "@/components/shell/not-found-fallback";

/** Branded global 404 — also catches every unmatched URL app-wide. */
export default function RootNotFound() {
  return (
    <NotFoundFallback
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      backHref="/"
      backLabel="Go home"
    />
  );
}
