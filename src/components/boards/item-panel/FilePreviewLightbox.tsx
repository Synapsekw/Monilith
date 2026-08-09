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
} from "@/lib/collaboration/attachments-format";
import { getAttachmentPreviewUrl } from "@/lib/collaboration/actions";
import type { Attachment } from "@/lib/collaboration/attachments-cache";

// Client-only PDF.js renderer — lazily loaded only when a PDF lightbox opens,
// so `pdfjs-dist` never enters the server bundle or the board/item first paint.
const PdfPreview = dynamic(
  () => import("./PdfPreview").then((m) => m.PdfPreview),
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
  // Keyed by attachment id so render can tell "resolved for THIS pdf" from
  // "stale / still loading" without a synchronous reset in the effect body.
  const [pdf, setPdf] = useState<{ id: string; url: string | null } | null>(
    null,
  );

  // Fetch the PDF's signed URL when the lightbox lands on a PDF. Derived from
  // attachments/index locally so it does not depend on values computed after
  // the `!current` early return (rules of hooks). State is set only inside the
  // async resolution — never synchronously in the effect body.
  useEffect(() => {
    const c = attachments[index];
    if (!c || fileKind(c.mime_type, c.file_name) !== "pdf") return;
    let cancelled = false;
    getAttachmentPreviewUrl({ attachmentId: c.id }).then((res) => {
      if (cancelled) return;
      setPdf({ id: c.id, url: res.ok ? res.data.url : null });
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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
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
              onClick={() => onDownload(current)}
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

        <div className="bg-surface-muted relative grid min-h-64 place-items-center rounded-md">
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
              className="max-h-[60vh] object-contain"
            />
          ) : previewable && kind === "video" && url ? (
            <video src={url} controls className="max-h-[60vh]" />
          ) : kind === "pdf" ? (
            pdf && pdf.id === current.id ? (
              pdf.url ? (
                <PdfPreview src={pdf.url} fileName={current.file_name} />
              ) : (
                <div className="text-muted-foreground py-12 text-sm">
                  Couldn’t load preview.
                </div>
              )
            ) : (
              <div className="text-muted-foreground py-12 text-sm">
                Loading preview…
              </div>
            )
          ) : (
            <div className="text-muted-foreground flex flex-col items-center gap-3 py-12 text-sm">
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
