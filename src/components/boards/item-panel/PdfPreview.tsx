"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { formatSize } from "@/lib/collaboration/attachments-format";
import { fetchWithProgress } from "@/lib/collaboration/fetch-with-progress";
import { PreviewProgress } from "./PreviewProgress";

// Worker asset URL. pdfjs-dist v6 ships the worker as pdf.worker.min.mjs.
// Verified to resolve under Next 16's bundler via `new URL(..., import.meta.url)`;
// the documented fallback is a copied worker in /public.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Status = "loading" | "ready" | "error";

/**
 * Device-pixel cap for the rendered bitmap.
 *
 * A canvas sized in CSS pixels is rendered at 1 device pixel per CSS pixel and
 * then upscaled by the display — which is why the preview looked soft on every
 * Retina screen. Rendering at `devicePixelRatio` fixes that, but the cost is
 * quadratic: DPR 2 is 4x the pixels and 4x the memory of DPR 1. 2 is the point
 * where the page is sharp on every mainstream display; going to 3 for the rare
 * DPR-3 phone would cost 9x for a difference nobody can see at this size.
 */
const MAX_DPR = 2;

/** How far outside the scroller a page starts rendering, as a % of viewport. */
const PRERENDER_MARGIN = "150%";

export function PdfPreview({
  src,
  onAspect,
}: {
  src: string;
  fileName?: string;
  /** Reports page 1's intrinsic width/height so the modal can shape itself to
   *  a portrait vs landscape document. Fires once per loaded document. */
  onAspect?: (aspect: number) => void;
}) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [download, setDownload] = useState<{
    received: number;
    total: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The loading task owns teardown in pdfjs v6 (destroy() lives here, not on
    // the resolved document proxy); destroying it tears down the worker too.
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    let observer: IntersectionObserver | null = null;

    (async () => {
      try {
        setStatus("loading");
        const bytes = await fetchWithProgress(src, (p) => {
          if (!cancelled) setDownload(p);
        });
        if (cancelled) return;

        loadingTask = pdfjsLib.getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        const host = pagesRef.current;
        if (!host) return;
        host.replaceChildren();

        // Fit-width off the container, falling back to 1.0 (e.g. in jsdom).
        const fitWidth = host.clientWidth || 0;
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

        // Size a placeholder per page BEFORE rendering anything, so the
        // scrollbar is correct from the first frame and nothing reflows under
        // the user as pages fill in. getPage() parses the page dictionary
        // only — it does not rasterise — so this stays cheap on long files.
        const slots: HTMLDivElement[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          if (n === 1 && base.height > 0) onAspect?.(base.width / base.height);

          const slot = document.createElement("div");
          slot.dataset.page = String(n);
          slot.className =
            "bg-background relative mx-auto mb-2 w-full overflow-hidden rounded shadow-sm";
          // aspect-ratio keeps the placeholder the exact shape of the page it
          // will hold, so the canvas drops in with zero layout shift.
          slot.style.aspectRatio = `${base.width} / ${base.height}`;
          host.appendChild(slot);
          slots.push(slot);
        }

        async function renderSlot(slot: HTMLDivElement) {
          if (slot.dataset.rendered) return;
          slot.dataset.rendered = "1";
          const n = Number(slot.dataset.page);
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const fit = fitWidth > 0 ? fitWidth / base.width : 1;
          const viewport = page.getViewport({ scale: fit * scale * dpr });

          const canvas = document.createElement("canvas");
          // Bitmap in DEVICE pixels; CSS box left to the layout. This pairing
          // is the whole fix — setting only `width`/`height` renders at 1x.
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.className = "block";
          slot.replaceChildren(canvas);

          // pdfjs v6 renders to the canvas directly (it acquires the 2d
          // context internally); no embedded JS is ever executed.
          await page.render({ canvas, viewport }).promise;
        }

        // Render on approach rather than all at once: a long document showed
        // nothing until every page had rasterised, and at DPR 2 holding every
        // page as a bitmap is a real memory cost. Only pages the user actually
        // reaches are ever rendered.
        if (typeof IntersectionObserver === "function") {
          observer = new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (!e.isIntersecting) continue;
                const slot = e.target as HTMLDivElement;
                observer?.unobserve(slot);
                void renderSlot(slot);
              }
            },
            { root: host, rootMargin: `${PRERENDER_MARGIN} 0px` },
          );
          for (const s of slots) observer.observe(s);
        } else {
          // No IntersectionObserver (jsdom, very old browsers): render eagerly
          // so the preview still works, just without the laziness.
          for (const s of slots) await renderSlot(s);
        }

        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      loadingTask?.destroy?.();
    };
  }, [src, scale, onAspect]);

  if (status === "error") {
    return (
      <div className="text-muted-foreground py-12 text-sm">
        Couldn’t render this PDF. Use Download above to open it.
      </div>
    );
  }

  const downloadLabel = !download
    ? "Loading preview…"
    : download.total
      ? `Downloading ${formatSize(download.received)} of ${formatSize(download.total)}`
      : `Downloading ${formatSize(download.received)}`;

  return (
    <div className="relative flex min-h-0 w-full flex-col gap-2">
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
        <span>{`${pageCount} page${pageCount === 1 ? "" : "s"}`}</span>
      </div>

      {/* min-h-0 lets this flex child actually shrink so the scroller works;
          without it the container grows past the modal instead of scrolling. */}
      <div
        ref={pagesRef}
        data-scroll-container
        className="min-h-0 w-full flex-1 overflow-auto"
      />

      {/* The progress OVERLAYS rather than replaces the pages container: a
          `hidden` container reports clientWidth 0, which would collapse the
          fit-width maths to scale 1 and render every page at 72dpi — the exact
          blurriness this change exists to remove. */}
      {status === "loading" && (
        <div className="bg-popover absolute inset-0 grid place-items-center rounded-md">
          <PreviewProgress
            label={downloadLabel}
            value={
              download?.total ? download.received / download.total : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
