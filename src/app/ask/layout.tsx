import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AskRailData } from "@/components/ai/ask/AskRailData";
import { Brand } from "@/components/brand/brand";

/**
 * Layout B for the full-page Ask AI surface. `/ask` lives OUTSIDE the `(app)`
 * route group on purpose: `(app)/layout.tsx` wraps every child in the
 * AuthenticatedShell (Monolith sidebar + header), but layout B needs the
 * conversation rail *in place of* that nav. So this layout owns the whole frame
 * — matching the repo precedent that `admin`/`home` also stay outside `(app)`.
 *
 * It owns the frame, but not a bespoke surface model: it mirrors `AppShell`
 * exactly — the wash paints on the root, the rail is transparent atmosphere
 * with no divider, and `<main>` is the single inset opaque card on the same
 * `mr-2 mb-2 ml-1` gutter. `<main>` stays `overflow-hidden`, not `auto`:
 * `/ask` delegates scrolling to `MessageList`, and a card-level scroller would
 * stack a second scrollbar on the same axis. Because it IS a scroll container
 * though, globals.css's `main { scrollbar-gutter: stable }` would reserve 10px
 * inside the card's right border that can never hold a scrollbar — on top of
 * the 10px `MessageList` legitimately reserves. `[scrollbar-gutter:auto]` opts
 * this one out; the real scroller keeps the stable gutter.
 *
 * The frame is static (prerendered into the Cache Components shell); the rail's
 * per-user data and the page's thread both stream behind Suspense. Auth is
 * guarded by `requireUser()` inside the rail data component.
 */
export default function AskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-wash flex h-svh w-full overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <Brand />
        </div>
        <Link
          href="/my-work"
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-4 py-3 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" /> Back to Monolith
        </Link>
        <Suspense
          fallback={
            <div className="text-muted-foreground px-4 py-3 text-xs">
              Loading conversations…
            </div>
          }
        >
          <AskRailData />
        </Suspense>
      </aside>
      <main className="bg-content-surface border-content-edge shadow-content-lift mr-2 mb-2 ml-1 flex min-h-0 min-w-0 flex-1 [scrollbar-gutter:auto] flex-col overflow-hidden rounded-xl border">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
    </div>
  );
}
