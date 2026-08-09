"use client";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReportDocument, type ReportDocumentProps } from "./ReportDocument";
import { REPORT_CSS } from "@/lib/reports/report-css";

/**
 * Live preview of the printed report, rendered into an iframe so the document's
 * own print stylesheet (`REPORT_CSS`) cannot collide with the app's Tailwind.
 *
 * Props are `ReportDocumentProps` verbatim and are forwarded untouched — that
 * 1:1 pass-through is the point. The multi-board shape (`boards`, `totals`,
 * `pooledChartSeries`, `scopeLabel`, `omittedBoardCount`) therefore arrived here
 * for free, and there is nowhere in this file for the preview to diverge from
 * what `exportReportPdf` renders server-side.
 */
export function PreviewPane(props: ReportDocumentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<Root | null>(null);

  // Create the iframe document + a dedicated React root once per mount.
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><style>${REPORT_CSS}</style></head><body><div id="r-root"></div></body></html>`,
    );
    doc.close();
    const mount = doc.getElementById("r-root");
    if (!mount) return;
    const root = createRoot(mount);
    rootRef.current = root;
    return () => {
      // Null the ref first so the render effect below can't touch a dead root,
      // and defer unmount out of the commit phase (React 19 errors if a root is
      // unmounted synchronously while another render is in progress).
      rootRef.current = null;
      queueMicrotask(() => root.unmount());
    };
  }, []);

  // Re-render the document from local props on every commit — no server
  // round-trip. Guarded on rootRef so a torn-down root is never updated.
  useEffect(() => {
    rootRef.current?.render(<ReportDocument {...props} />);
  });

  return (
    <iframe
      ref={iframeRef}
      title="Report preview"
      style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
    />
  );
}
