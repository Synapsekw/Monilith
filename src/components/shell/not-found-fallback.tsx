import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Shared body for not-found.tsx route files (server component — no hooks). */
export function NotFoundFallback({
  title,
  description,
  backHref,
  backLabel,
}: {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="text-foreground text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      <Button asChild variant="outline" className="mt-2">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </div>
  );
}
