"use client";

import { Download, Eye, Trash2, Play, FileText } from "lucide-react";
import {
  fileKind,
  formatSize,
  isPreviewable,
} from "@/lib/collaboration/attachments-format";
import type { Attachment } from "@/lib/collaboration/attachments-cache";
import type { Member } from "@/lib/collaboration/activity";

export function AttachmentCard({
  attachment,
  previewUrl,
  members,
  uploading,
  canDelete,
  onPreview,
  onDownload,
  onDelete,
}: {
  attachment: Attachment;
  previewUrl?: string;
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

  return (
    <div className="group bg-surface relative flex flex-col overflow-hidden rounded-md border">
      <div className="bg-surface-muted relative flex aspect-video items-center justify-center">
        {previewable && kind === "image" && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
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
          <div className="bg-background/70 absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            {previewable && (
              <button
                onClick={onPreview}
                aria-label="Preview"
                className="text-muted-foreground hover:text-foreground"
              >
                <Eye className="size-4" />
              </button>
            )}
            <button
              onClick={onDownload}
              aria-label="Download"
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="size-4" />
            </button>
            {canDelete && (
              <button
                onClick={onDelete}
                aria-label="Delete"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
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
