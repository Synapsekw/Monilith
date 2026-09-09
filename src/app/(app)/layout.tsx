import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";
import { ServiceWorkerRegistrar } from "@/components/offline/ServiceWorkerRegistrar";
import { OfflineNavigationGuard } from "@/components/offline/OfflineNavigationGuard";
import { Toaster } from "@/components/ui/sonner";

/**
 * The single persistent shell for every authenticated section
 * (boards, dashboards, portfolios, goals, time, workload, settings). Because
 * this group layout is the common ancestor of all of them, Next.js preserves it
 * across section navigation — the sidebar nav, header user region and command
 * palette mount once and stream their per-user data once per page load, not on
 * every section click.
 *
 * NOTHING in this layout or in `AuthenticatedShell` may await a request-time
 * API (`cookies()`, `headers()`, …). Both render above every Suspense boundary
 * in the group, so one await there makes the whole route dynamic and Next.js
 * emits an EMPTY static shell — that is not theory: an `await cookies()` added
 * to seed the device timezone left `.next/server/app/my-work.html`,
 * `boards/[boardId].html` and every `settings/*.html` at 0 bytes while
 * `/ask` (no cookie read in its layout) prerendered ~9 KB. `pnpm build` exits
 * 0 either way and `loading.tsx` does not help a cold load, so the guard is
 * `src/test/static-shell.test.ts` plus an `ls -la` on those files after a
 * build. Request-time values are read UNAWAITED and the promise passed down to
 * a consumer that already suspends behind a fallback.
 *
 * With that held, the AppShell frame, the four skeleton fallbacks and
 * `{children}` are all in the static shell; per-user data streams behind
 * Suspense.
 *
 * Instant navigation is OFF (`instant = false` — the export was `unstable_instant`
 * until Next 16.3 stabilized it; the old name is silently ignored now, which
 * turns this opt-out into a build-breaking `blocking-route` error, so never
 * rename it back). An earlier version of
 * this docblock claimed the page segments validated instant nav via
 * `{ prefetch: 'static' }` — no such export exists anywhere and it was never
 * validated. The real blocker is architectural: the shell reads
 * `useSearchParams()` pervasively (that's how gotcha-09's 0-refetch view/tab
 * switching works — History API updates that Next.js syncs into
 * `useSearchParams()` with no RSC re-run), and pervasive `useSearchParams()`
 * fails instant-nav validation. So route-level `loading.tsx` skeletons are the
 * instant-feel mechanism instead. Do NOT flip this flag without first landing
 * the `useSearchParams`-decoupling spec — see
 * `vault/decisions/2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams.md`.
 *
 * `admin` and `home` deliberately stay OUTSIDE this group: admin runs its
 * platform-admin guard before any Suspense boundary, and home is a one-shot
 * redirect dispatcher.
 */
export const instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthenticatedShell>{children}</AuthenticatedShell>
      <Toaster />
      <ServiceWorkerRegistrar />
      {/* Sends offline link clicks through a real document navigation so the
          service worker's navigate fallback can serve the cached board. Mounted
          beside the registrar because both belong to the same offline story and
          both must survive section navigation. */}
      <OfflineNavigationGuard />
    </>
  );
}
