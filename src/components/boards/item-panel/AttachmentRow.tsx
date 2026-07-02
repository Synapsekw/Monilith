"use client";

import { Download, Eye, Trash2, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RevealOnHover } from "@/components/ui/reveal-on-hover";
import {
  canPreviewInline,
  formatSize,
} from "@/lib/collaboration/attachments-format";
import type { Attachment } from "@/lib/collaboration/attachments-cache";
import type { Member } from "@/lib/collaboration/activity";

export function AttachmentRow({
  attachment,
  members,
  canDelete,
  onPreview,
  onDownload,
  onDelete,
}: {
  attachment: Attachment;
  members: readonly Member[];
  canDelete: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const uploader =
    members.find((m) => m.userId === attachment.uploaded_by)?.fullName ??
    "Someone";
  const canPreview = canPreviewInline(attachment.mime_type);

  return (
    <div className="group hover:bg-accent flex items-center gap-3 rounded-md px-2 py-1.5 text-sm">
      <File className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={attachment.file_name}>
        {attachment.file_name}
      </span>
      <span className="text-muted-foreground w-20 shrink-0 text-right text-xs">
        {formatSize(attachment.size_bytes)}
      </span>
      <span className="text-muted-foreground w-28 shrink-0 truncate text-xs">
        {uploader}
      </span>
      <RevealOnHover className="flex shrink-0 items-center gap-2">
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
    </div>
  );
}
