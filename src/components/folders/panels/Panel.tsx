import type { ReactNode } from "react";
import { Kicker } from "@/components/ui/kicker";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

/** The shared section shell every built-in Overview panel renders inside.
 *  Moved out of `Overview.tsx` (Task 5) so each panel is its own file — the
 *  markup, classes and copy are byte-identical to the pre-extraction version. */
export function Panel({
  kicker,
  title,
  children,
  className,
  id,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "bg-surface flex flex-col gap-3 rounded-lg border p-4",
        className,
      )}
    >
      <div>
        <Kicker>{kicker}</Kicker>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState variant="inline" className="flex flex-col items-center gap-2">
      This panel couldn&apos;t load.
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </EmptyState>
  );
}
