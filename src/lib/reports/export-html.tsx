import { renderToStaticMarkup } from "react-dom/server";
import {
  ReportDocument,
  type ReportDocumentProps,
} from "@/components/reports/ReportDocument";
import { REPORT_CSS } from "@/lib/reports/report-css";

export function buildReportHtml(props: ReportDocumentProps): string {
  const body = renderToStaticMarkup(<ReportDocument {...props} />);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${REPORT_CSS}</style></head><body>${body}</body></html>`;
}
