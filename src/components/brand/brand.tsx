import Link from "next/link";
import { nunito } from "@/lib/fonts";
import { MonolithMark } from "@/components/brand/monolith-mark";
import { cn } from "@/lib/utils";

/**
 * Nav brand: the monolith mark plus the MONOLITH wordmark, linking to /landing.
 * In the collapsed rail the wordmark is hidden; the mark and the link's
 * aria-label keep the accessible name intact.
 */
export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/landing"
      aria-label="MONOLITH — landing"
      className="focus-visible:ring-ring -ml-1 flex w-fit items-center gap-2 rounded-md px-1 py-0.5 focus-visible:ring-2 focus-visible:outline-none"
    >
      <MonolithMark className="text-foreground size-6" />
      {!collapsed ? (
        <span
          className={cn(
            nunito.className,
            "text-sm font-extrabold tracking-wide",
          )}
        >
          MONOLITH
        </span>
      ) : null}
    </Link>
  );
}
