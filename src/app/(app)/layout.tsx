import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

/**
 * The single persistent shell for every authenticated section
 * (boards, dashboards, portfolios, goals, time, workload, settings). Because
 * this group layout is the common ancestor of all of them, Next.js preserves it
 * across section navigation — the sidebar nav, header user region and command
 * palette mount once and stream their per-user data once per page load, not on
 * every section click.
 *
 * Hoisted from the former per-section layouts: cookie-bound page-load entry is
 * dynamic; sibling client-nav is validated via `{ prefetch: 'static' }` on the
 * page segments. The static AppShell frame still prerenders; per-user data
 * streams behind Suspense.
 *
 * `admin` and `home` deliberately stay OUTSIDE this group: admin runs its
 * platform-admin guard before any Suspense boundary, and home is a one-shot
 * redirect dispatcher.
 */
export const unstable_instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
