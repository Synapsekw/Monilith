// react-grid-layout v2 ships a single stylesheet (includes resize-handle styles;
// the old react-resizable CSS no longer exists as a dependency).
import "react-grid-layout/css/styles.css";

import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export const unstable_instant = false;

/**
 * Persistent shell for every dashboard route. Mirrors the boards layout; the
 * react-grid-layout CSS is imported here so the grid styles load shell-wide.
 */
export default function DashboardsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
