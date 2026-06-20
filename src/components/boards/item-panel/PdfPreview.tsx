"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

// Worker asset URL. pdfjs-dist v6 ships the worker as pdf.worker.min.mjs.
// Verified to resolve under Next 16's bundler via `new URL(..., import.meta.url)`;
// the documented fallback is a copied worker in /public.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Status = "loading" | "ready" | "error";

export function PdfPreview({ src }: { src: string; fileName?: string }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let doc: Awaited<
      ReturnType<typeof pdfjsLib.getDocument>["promise"]
    > | null = null;

    (async () => {
      try {
        setStatus("loading");
        const bytes = await (await fetch(src)).arrayBuffer();
        if (cancelled) return;
        doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        const host = pagesRef.current;
        if (!host) return;
        host.replaceChildren();

        // Fit-width off the container, falling back to 1.0 (e.g. in jsdom).
        const fitWidth = host.clientWidth || 0;

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const fit = fitWidth > 0 ? fitWidth / base.width : 1;
          const viewport = page.getViewport({ scale: fit * scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto mb-2 max-w-full rounded shadow-sm";
          host.appendChild(canvas);

          // pdfjs v6 renders to the canvas directly (it acquires the 2d
          // context internally); no embedded JS is ever executed.
          await page.render({ canvas, viewport }).promise;
        }
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [src, scale]);

  if (status === "error") {
    return (
      <div className="text-muted-foreground py-12 text-sm">
        Couldn’t render this PDF. Use Download above to open it.
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="text-muted-foreground flex items-center justify-end gap-2 text-xs">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
          className="hover:text-foreground"
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setScale((s) => Math.min(3, s + 0.25))}
          className="hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
        <span>
          {status === "loading"
            ? "Loading…"
            : `${pageCount} page${pageCount === 1 ? "" : "s"}`}
        </span>
      </div>
      <div ref={pagesRef} className="max-h-[60vh] w-full overflow-auto" />
    </div>
  );
}
