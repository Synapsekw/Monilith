"use client";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReportDocument, type ReportDocumentProps } from "./ReportDocument";
import { REPORT_CSS } from "@/lib/reports/report-css";

export function PreviewPane(props: ReportDocumentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<Root | null>(null);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    if (!doc.getElementById("r-css")) {
      doc.head.innerHTML = `<style id="r-css">${REPORT_CSS}</style>`;
      const mount = doc.createElement("div");
      mount.id = "r-root";
      doc.body.appendChild(mount);
      rootRef.current = createRoot(mount);
    }
    rootRef.current?.render(<ReportDocument {...props} />);
  });

  useEffect(() => () => rootRef.current?.unmount(), []);

  return (
    <iframe
      ref={iframeRef}
      title="Report preview"
      style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
    />
  );
}
