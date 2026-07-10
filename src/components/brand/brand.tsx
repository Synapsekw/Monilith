import Link from "next/link";
import { nunito } from "@/lib/fonts";
import { MonolithMark } from "@/components/brand/monolith-mark";
import { cn } from "@/lib/utils";

/**
 * Nav brand, linking to /landing. Expanded, it renders the MONOLITH wordmark
 * with the letter I recut as the monolith slab (the same Nunito ExtraBold face
 * as everywhere else). Collapsed, it shows the standalone cleaved mark alone.
 * A visually-hidden "MONOLITH" keeps the wordmark's accessible name intact for
 * screen readers, since the visible letters are split around the slab glyph.
 */
export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/landing"
      aria-label="MONOLITH — landing"
      className="focus-visible:ring-ring -ml-1 flex w-fit items-center gap-2 rounded-md px-1 py-0.5 focus-visible:ring-2 focus-visible:outline-none"
    >
      {collapsed ? (
        <MonolithMark className="text-foreground size-6" />
      ) : (
        <>
          <MonolithMark className="text-foreground size-5" />
          <span
            aria-hidden="true"
            className={cn(
              nunito.className,
              "inline-flex items-baseline text-sm font-extrabold tracking-wide",
            )}
          >
            MONOL
            <svg
              viewBox="8.6 3.2 6.8 17.6"
              aria-hidden="true"
              className="w-auto"
              style={{
                height: "0.72em",
                margin: "0 0.05em",
                transform: "translateY(0.008em)",
              }}
            >
              <path d="M8.6 5 15.4 3.2V20.8H8.6Z" fill="currentColor" />
            </svg>
            TH
          </span>
          <span className="sr-only">MONOLITH</span>
        </>
      )}
    </Link>
  );
}
