"use client";

import dynamic from "next/dynamic";

// The single deferred entry to the recharts-backed burn chart. Importing THIS
// module is recharts-free (the reference lives inside dynamic(() => import())),
// so CommandCenter never pulls recharts into first paint — same pattern as
// src/components/dashboards/widgets/LazyChartWidget.tsx. ssr:false is fine:
// the chart measures its container; the Overview prints whatever is mounted.
export const BurnChart = dynamic(
  () =>
    import("@/components/folders/charts/BurnChartInner").then(
      (m) => m.BurnChartInner,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted/40 h-64 w-full animate-pulse rounded-md" />
    ),
  },
);
