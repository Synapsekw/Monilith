"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { DashboardCanvasSkeleton } from "@/components/dashboards/DashboardCanvasSkeleton";
import type { DashboardCanvas as DashboardCanvasType } from "@/components/dashboards/DashboardCanvas";

/**
 * Client boundary so react-grid-layout (DashboardCanvas' only heavy dep) is a
 * lazy chunk instead of first-load JS on the dashboards route. `ssr: false` is
 * required here — the grid measures the DOM (useContainerWidth) — and is only
 * legal in a Client Component, hence this wrapper. The loading fallback reuses
 * the same DashboardCanvasSkeleton already wired into the route's loading.tsx.
 */
const DashboardCanvas = dynamic(
  () =>
    import("@/components/dashboards/DashboardCanvas").then(
      (m) => m.DashboardCanvas,
    ),
  { ssr: false, loading: () => <DashboardCanvasSkeleton /> },
);

export function DashboardCanvasLazy(
  props: ComponentProps<typeof DashboardCanvasType>,
) {
  return <DashboardCanvas {...props} />;
}
