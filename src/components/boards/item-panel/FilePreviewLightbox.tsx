"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  fileKind,
  isPreviewable,
  isDocx,
  isSheetParseable,
} from "@/lib/collaboration/attachments-format";
import {
  presetFrame,
  measuredFrame,
  frameStyle,
} from "@/lib/collaboration/preview-frame";
import { getAttachmentPreviewUrl } from "@/lib/collaboration/actions";
import type { Attachment } from "@/lib/collaboration/attachments-cache";
import { FileTypeChip } from "@/components/boards/FileTypeChip";

// Client-only renderers — each lazily loaded only when a preview of that type
// opens, so pdfjs-dist / docx-preview never enter the server bundle or the
// board/item first paint.
const PdfPreview = dynamic(
  () => import("./PdfPreview").then((m) => m.PdfPreview),
  { ssr: false },
);
const DocxPreview = dynamic(
  () => import("./DocxPreview").then((m) => m.DocxPreview),
  { ssr: false },
);
const XlsxPreview = dynamic(
  () => import("./XlsxPreview").then((m) => m.XlsxPreview),
  { ssr: false },
);

export function FilePreviewLightbox({
  attachments,
  index,
  previewUrls,
  currentUserId,
  onIndexChange,
  onClose,
  onDownload,
  onDelete,
}: {
  attachments: readonly Attachment[];
  index: number;
  previewUrls: Record<string, string>;
  currentUserId: string;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onDownload: (a: Attachment) => void;
  onDelete: (a: Attachment) => void;
}) {
  const current = attachments[index];
  const count = attachments.length;
  // Keyed by attachment id so render can tell "resolved for THIS file" from
  // "stale / still loading" without a synchronous reset in the effect body.
  const [signed, setSigned] = useState<{
    id: string;
    url: string | null;
  } | null>(null);

  // The asset's measured aspect ratio, once it reports one. Reset during render
  // (React's sanctioned alternative to a reset effect) whenever the lightbox
  // moves to a different attachment, so a landscape page never keeps its shape
  // after navigating to a portrait one.
  const [aspect, setAspect] = useState<number | null>(null);
  const [prevIndex, setPrevIndex] = useState(index);
  if (prevIndex !== index) {
    setPrevIndex(index);
    setAspect(null);
  }

  // Fetch the signed URL for the byte-fetched formats (PDF, DOCX). Derived from
  // attachments/index locally so it does not depend on values computed after
  // the `!current` early return (rules of hooks). State is set only inside the
  // async resolution — never synchronously in the effect body.
  useEffect(() => {
    const c = attachments[index];
    if (!c) return;
    const needsBytes =
      fileKind(c.mime_type, c.file_name) === "pdf" ||
      isDocx(c.mime_type, c.file_name);
    if (!needsBytes) return;
    let cancelled = false;
    getAttachmentPreviewUrl({ attachmentId: c.id }).then((res) => {
      if (cancelled) return;
      setSigned({ id: c.id, url: res.ok ? res.data.url : null });
    });
    return () => {
      cancelled = true;
    };
  }, [attachments, index]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < count - 1) onIndexChange(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onClose, onIndexChange]);

  if (!current) return null;
  const url = previewUrls[current.id];
  const kind = fileKind(current.mime_type, current.file_name);
  const previewable = isPreviewable(current.mime_type);
  const canDelete = current.uploaded_by === currentUserId;
  // Open at the kind's preset (no flash of the wrong shape), then settle to the
  // asset's real proportions once it reports them.
  const frame =
    aspect === null ? presetFrame(kind) : measuredFrame(kind, aspect);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* `sm:max-w-none` is not redundant with `max-w-none`: tailwind-merge
          treats a variant-prefixed class as its own group, so the primitive's
          `sm:max-w-sm` survives an unprefixed override and would pin the
          dialog to 24rem on every desktop viewport. Both are required. */}
      <DialogContent
        className="flex max-h-[90vh] w-[var(--preview-w)] max-w-none flex-col gap-3 sm:max-w-none"
        style={frameStyle(frame)}
      >
        <DialogTitle className="sr-only">{current.file_name}</DialogTitle>
        <div className="flex items-center justify-between gap-2 pr-8">
          <span className="min-w-0 truncate text-sm font-medium">
            {current.file_name}
            <span className="text-muted-foreground ml-2 text-xs">
              {index + 1} of {count}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                const href = previewUrls[current.id] ?? signed?.url;
                if (href) window.open(href, "_blank", "noopener");
                else onDownload(current);
              }}
              aria-label="Open in new tab"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDownload(current)}
              aria-label="Download"
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="size-4" />
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onDelete(current)}
                aria-label="Delete"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </div>

        {/* FLEX, not grid — measured, not assumed. A grid's implicit row is
            auto-sized, so it grows to the content's full height and
            `align-items: stretch` stretches the viewer to that ROW rather than
            to this pane: a 12-page PDF made the viewer 7272px tall inside a
            616px pane, overflowed, got clipped by overflow-hidden, and its own
            overflow-auto never received a definite height to scroll within.
            A flex container stretches children to the CONTAINER, so the viewer
            is bounded and scrolls. Children that should be centred rather than
            filled say so themselves with m-auto. */}
        <div className="bg-surface-muted relative flex min-h-0 flex-1 overflow-hidden rounded-md">
          {index > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onIndexChange(index - 1)}
              aria-label="Previous"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 left-2 -translate-y-1/2"
            >
              <ChevronLeft className="size-6" />
            </Button>
          )}

          {previewable && kind === "image" && url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={current.file_name}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalHeight > 0)
                  setAspect(el.naturalWidth / el.naturalHeight);
              }}
              className="m-auto max-h-full max-w-full object-contain"
            />
          ) : previewable && kind === "video" && url ? (
            <video
              src={url}
              controls
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                if (el.videoHeight > 0)
                  setAspect(el.videoWidth / el.videoHeight);
              }}
              className="m-auto max-h-full max-w-full"
            />
          ) : kind === "pdf" ? (
            signed && signed.id === current.id ? (
              signed.url ? (
                <PdfPreview
                  src={signed.url}
                  fileName={current.file_name}
                  onAspect={setAspect}
                />
              ) : (
                <div className="text-muted-foreground m-auto py-12 text-sm">
                  Couldn’t load preview.
                </div>
              )
            ) : (
              <div className="text-muted-foreground m-auto py-12 text-sm">
                Loading preview…
              </div>
            )
          ) : isDocx(current.mime_type, current.file_name) ? (
            signed && signed.id === current.id ? (
              signed.url ? (
                <DocxPreview src={signed.url} fileName={current.file_name} />
              ) : (
                <div className="text-muted-foreground m-auto py-12 text-sm">
                  Couldn’t load preview.
                </div>
              )
            ) : (
              <div className="text-muted-foreground m-auto py-12 text-sm">
                Loading preview…
              </div>
            )
          ) : isSheetParseable(current.mime_type, current.file_name) ? (
            <XlsxPreview attachmentId={current.id} />
          ) : (
            <div className="text-muted-foreground m-auto flex flex-col items-center gap-3 py-12 text-sm">
              <FileTypeChip
                fileName={current.file_name}
                mimeType={current.mime_type}
                size="lg"
              />
              <span>No inline preview for this file type.</span>
              <button
                onClick={() => onDownload(current)}
                aria-label="Download"
                className="text-primary hover:underline"
              >
                Download
              </button>
            </div>
          )}

          {index < count - 1 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onIndexChange(index + 1)}
              aria-label="Next"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
            >
              <ChevronRight className="size-6" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
