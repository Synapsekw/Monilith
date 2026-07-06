"use client";

import dynamic from "next/dynamic";

// The single deferred entry point to the recharts-backed ChartWidget. Importing
// THIS module statically is recharts-free: the ChartWidget reference lives
// inside dynamic(() => import(...)), a code-split boundary. First-paint
// dashboard code (DashboardWidget, the WidgetConfigSheet preview) imports this
// wrapper so recharts + the P2 chart modules never enter the first-paint chunk.
// Mirrors the PdfPreview pattern in FilePreviewLightbox.tsx.
// Fallback = ChartWidget's own loading skeleton, so there is no layout shift
// (the widget shell / h-64 preview card owns sizing).
export const LazyChartWidget = dynamic(
  () =>
    import("@/components/dashboards/widgets/ChartWidget").then(
      (m) => m.ChartWidget,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 h-full animate-pulse rounded-md" />
    ),
  },
);
