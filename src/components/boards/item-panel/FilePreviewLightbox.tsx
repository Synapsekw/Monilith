"use client";

import { useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  fileKind,
  isPreviewable,
} from "@/lib/collaboration/attachments-format";
import type { Attachment } from "@/lib/collaboration/attachments-cache";

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
            <button
              onClick={() => onDownload(current)}
              aria-label="Open in new tab"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-4" />
            </button>
            <button
              onClick={() => onDownload(current)}
              aria-label="Download"
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="size-4" />
            </button>
            {canDelete && (
              <button
                onClick={() => onDelete(current)}
                aria-label="Delete"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="bg-surface-muted relative grid min-h-64 place-items-center rounded-md">
          {index > 0 && (
            <button
              onClick={() => onIndexChange(index - 1)}
              aria-label="Previous"
              className="hover:text-foreground text-muted-foreground absolute top-1/2 left-2 -translate-y-1/2"
            >
              <ChevronLeft className="size-6" />
            </button>
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
            <button
              onClick={() => onIndexChange(index + 1)}
              aria-label="Next"
              className="hover:text-foreground text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2"
            >
              <ChevronRight className="size-6" />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
