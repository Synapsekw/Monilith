"use client";

import { useEffect, useRef, useState } from "react";
import { formatSize } from "@/lib/collaboration/attachments-format";
import { fetchWithProgress } from "@/lib/collaboration/fetch-with-progress";
import { PreviewProgress } from "./PreviewProgress";

type Status = "loading" | "ready" | "error";

/**
 * Client-only DOCX renderer. Mirrors PdfPreview: the bytes are fetched from a
 * short-lived signed URL and parsed in the browser, so the file never reaches
 * a third party.
 *
 * The document is rendered INSIDE an iframe declared `sandbox="allow-same-origin"`
 * and deliberately WITHOUT `allow-scripts`. Omitting allow-scripts means a
 * hostile .docx cannot execute script, and the iframe boundary keeps the
 * document's own CSS from leaking into the app chrome. `allow-same-origin` is
 * required so we can reach `contentDocument` to render into, and so blob-URL
 * images inside the document still resolve. This matters because the app ships
 * no CSP yet (see the note in next.config.ts).
 */
export function DocxPreview({ src }: { src: string; fileName?: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [download, setDownload] = useState<{
    received: number;
    total: number | null;
  } | null>(null);

  // jsdom (and some browsers) can have about:blank's document ready before the
  // load event ever fires, so poll once on mount rather than relying on onLoad
  // alone. Cheap and idempotent — setFrameReady(true) twice is a no-op.
  useEffect(() => {
    if (frameRef.current?.contentDocument) setFrameReady(true);
  }, []);

  useEffect(() => {
    if (!frameReady) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus("loading");
        const [{ renderAsync }, bytes] = await Promise.all([
          import("docx-preview"),
          fetchWithProgress(src, (p) => {
            if (!cancelled) setDownload(p);
          }),
        ]);
        if (cancelled) return;
        // Past the download; docx-preview exposes no render progress, so the
        // bar goes indeterminate rather than inventing a percentage.
        setDownload(null);
        const blob = new Blob([bytes]);

        const doc = frameRef.current?.contentDocument;
        if (!doc) return;
        doc.body.replaceChildren();
        doc.body.style.margin = "0";
        doc.body.style.background = "#fff";

        await renderAsync(blob, doc.body, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
        });
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, frameReady]);

  if (status === "error") {
    return (
      <div className="text-muted-foreground py-12 text-sm">
        Couldn’t render this document. Use Download above to open it.
      </div>
    );
  }

  return (
    <div className="relative min-h-0 w-full">
      {status === "loading" && (
        <div className="bg-popover absolute inset-0 grid place-items-center rounded">
          <PreviewProgress
            label={
              download
                ? download.total
                  ? `Downloading ${formatSize(download.received)} of ${formatSize(download.total)}`
                  : `Downloading ${formatSize(download.received)}`
                : "Rendering document…"
            }
            value={
              download?.total ? download.received / download.total : undefined
            }
          />
        </div>
      )}
      <iframe
        ref={frameRef}
        title="Document preview"
        sandbox="allow-same-origin"
        srcDoc="<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
        onLoad={() => setFrameReady(true)}
        className="h-full w-full rounded border-0 bg-white"
      />
    </div>
  );
}
