"use client";

import { useReportWebVitals } from "next/web-vitals";

/**
 * Real-user Web-Vitals (RUM) reporter — Phase 9.6.
 *
 * Mounted app-wide via `Providers` (root layout's single client boundary). On
 * every Core Web Vital sample (TTFB / FCP / LCP / CLS / INP) Next.js invokes the
 * registered callback. This is field data — the correct place to measure INP,
 * which lab/Lighthouse cannot (it needs real interaction). The synthetic budget
 * lives in `.lighthouserc.json` / the CI `lighthouse` job.
 *
 * Sink (kept deliberately minimal — no analytics dependency):
 *   - dev:  console.debug the metric.
 *   - prod: `navigator.sendBeacon` to NEXT_PUBLIC_WEB_VITALS_ENDPOINT if set,
 *           falling back to a keepalive `fetch`; otherwise a no-op.
 *
 * The handler is module-scoped so its reference is stable across re-renders —
 * Next.js warns that a changing callback reference reports duplicated data.
 */

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];
type WebVitalsMetric = Parameters<ReportWebVitalsCallback>[0];

function reportMetric(metric: WebVitalsMetric): void {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[web-vitals]", {
      name: metric.name,
      value: metric.value,
      rating: "rating" in metric ? metric.rating : undefined,
      id: metric.id,
    });
    return;
  }

  // Static property access so Next.js inlines this at build time in the client
  // bundle (dynamic process.env[...] access would not be replaced).
  const endpoint = process.env.NEXT_PUBLIC_WEB_VITALS_ENDPOINT;
  if (!endpoint) return; // no sink configured → no-op

  const body = JSON.stringify(metric);

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
  ) {
    navigator.sendBeacon(endpoint, body);
  } else {
    void fetch(endpoint, {
      body,
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    }).catch(() => {
      // Beacons are best-effort; never let reporting break the app.
    });
  }
}

export function WebVitals() {
  useReportWebVitals(reportMetric);
  return null;
}
