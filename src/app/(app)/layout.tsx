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
 * Cookie-bound page-load entry is dynamic; the static AppShell frame still
 * prerenders and per-user data streams behind Suspense.
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
