"use client";

import dynamic from "next/dynamic";

// The single deferred entry to the recharts-backed usage trend. Importing THIS
// module is recharts-free (the reference lives inside dynamic(() => import())),
// so UsageBreakdown — and with it /settings/ai — never pulls recharts into
// first-load JS. Same pattern as dashboards/widgets/LazyChartWidget.tsx and
// folders/charts/BurnChart.tsx. The fallback is the chart's exact box
// (`h-40 w-full`, see UsageTrendChart's ChartContainer), so the swap causes no
// layout shift.
export const LazyUsageTrendChart = dynamic(
  () =>
    import("@/components/settings/UsageTrendChart").then(
      (m) => m.UsageTrendChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="usage-trend-skeleton"
        className="bg-muted/40 h-40 w-full animate-pulse rounded-md"
      />
    ),
  },
);
