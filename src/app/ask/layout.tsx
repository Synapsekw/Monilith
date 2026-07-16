import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AskRailData } from "@/components/ai/ask/AskRailData";
import { Brand } from "@/components/brand/brand";

/**
 * Layout B for the full-page Ask Pulse surface. `/ask` lives OUTSIDE the `(app)`
 * route group on purpose: `(app)/layout.tsx` wraps every child in the
 * AuthenticatedShell (Pulse sidebar + header), but layout B needs the
 * conversation rail *in place of* that nav. So this layout owns the whole frame
 * — matching the repo precedent that `admin`/`home` also stay outside `(app)`.
 *
 * The frame is static (prerendered into the Cache Components shell); the rail's
 * per-user data and the page's thread both stream behind Suspense. Auth is
 * guarded by `requireUser()` inside the rail data component.
 */
export default function AskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      <aside className="bg-sidebar flex w-64 shrink-0 flex-col border-r">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <Brand />
        </div>
        <Link
          href="/my-work"
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-4 py-3 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" /> Back to Pulse
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
      <main className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
    </div>
  );
}
