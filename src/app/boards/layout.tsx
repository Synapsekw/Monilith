import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

// Cookie-bound page-load entry is dynamic; sibling client-nav is validated via
// `{ prefetch: 'static' }` on the page segments (D1). The static AppShell frame
// still prerenders; the per-user data streams behind Suspense boundaries.
export const unstable_instant = false;

/**
 * Persistent shell for every board route. The frame is part of the prerendered
 * Cache Components shell; the sidebar nav, header user region and command
 * palette stream in. Next.js preserves this layout across sibling navigation
 * (`/boards/A → /boards/B`), so the streamed shell renders once.
 */
export default function BoardsLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
