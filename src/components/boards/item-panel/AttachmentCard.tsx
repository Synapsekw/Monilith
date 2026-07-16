"use client";

import { Download, Eye, Trash2, Play, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RevealOnHover } from "@/components/ui/reveal-on-hover";
import {
  canPreviewInline,
  fileKind,
  formatSize,
  isPreviewable,
} from "@/lib/collaboration/attachments-format";
import type { Attachment } from "@/lib/collaboration/attachments-cache";
import type { Member } from "@/lib/collaboration/activity";
import { ThumbImg } from "@/components/boards/ThumbImg";

export function AttachmentCard({
  attachment,
  previewUrl,
  thumbUrl,
  members,
  uploading,
  canDelete,
  onPreview,
  onDownload,
  onDelete,
}: {
  attachment: Attachment;
  previewUrl?: string;
  /** Optional thumbnail-transform URL (image rows only); falls back to full-res. */
  thumbUrl?: string;
  members: readonly Member[];
  uploading?: boolean;
  canDelete: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const kind = fileKind(attachment.mime_type, attachment.file_name);
  const uploader =
    members.find((m) => m.userId === attachment.uploaded_by)?.fullName ??
    "Someone";
  const previewable = isPreviewable(attachment.mime_type);
  const canPreview = canPreviewInline(attachment.mime_type);

  return (
    <div className="group bg-surface-muted card-lift border-border hover:border-border-bright relative flex flex-col overflow-hidden rounded-lg border">
      <div className="bg-background relative flex aspect-video items-center justify-center">
        {previewable && kind === "image" && (thumbUrl || previewUrl) ? (
          <ThumbImg
            thumbUrl={thumbUrl}
            fullUrl={previewUrl}
            alt={attachment.file_name}
            className="h-full w-full object-cover"
          />
        ) : kind === "video" ? (
          <Play className="text-muted-foreground size-8" aria-hidden />
        ) : (
          <FileText className="text-muted-foreground size-8" aria-hidden />
        )}

        {uploading && (
          <div className="bg-background/60 absolute inset-0 grid place-items-center text-xs">
            Uploading…
          </div>
        )}

        {!uploading && (
          <RevealOnHover className="bg-background/70 absolute inset-0 flex items-center justify-center gap-2">
            {canPreview && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onPreview}
                aria-label="Preview"
                className="text-muted-foreground hover:text-foreground"
              >
                <Eye className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDownload}
              aria-label="Download"
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="size-4" />
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                aria-label="Delete"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </RevealOnHover>
        )}
      </div>

      <div className="flex flex-col gap-0.5 p-2">
        <span
          className="truncate text-sm font-medium"
          title={attachment.file_name}
        >
          {attachment.file_name}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatSize(attachment.size_bytes)} · {uploader}
        </span>
      </div>
    </div>
  );
}
