import {
  ReportDocument,
  type ReportDocumentProps,
} from "@/components/reports/ReportDocument";
import { REPORT_CSS } from "@/lib/reports/report-css";

/**
 * Assemble a self-contained HTML document for the report. `react-dom/server` is
 * imported dynamically (not a static top-level import) on purpose: Next 16's
 * bundler errors when `react-dom/server` is reachable from the server-action /
 * RSC static import graph. Deferring it behind `await import(...)` keeps it out
 * of that trace while still rendering server-side at runtime.
 */
export async function buildReportHtml(
  props: ReportDocumentProps,
): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(<ReportDocument {...props} />);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${REPORT_CSS}</style></head><body>${body}</body></html>`;
}
