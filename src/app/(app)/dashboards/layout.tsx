// react-grid-layout v2 ships a single stylesheet (includes resize-handle styles;
// the old react-resizable CSS no longer exists as a dependency). Imported in a
// dashboards-scoped layout so the grid styles load only for dashboard routes,
// not shell-wide.
import "react-grid-layout/css/styles.css";
// Touch override — MUST come after the vendor stylesheet so the
// (pointer: coarse) resize-handle rules win by source order without !important.
import "./dashboards.touch.css";

import type { ReactNode } from "react";

export default function DashboardsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
