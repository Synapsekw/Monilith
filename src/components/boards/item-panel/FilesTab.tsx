"use client";

import { useRef, useState } from "react";
import { Plus, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAttachmentDownloadUrl } from "@/lib/collaboration/actions";
import { formatSize } from "@/lib/collaboration/attachments-format";
import type { AttachmentsCache } from "@/lib/collaboration/attachments-cache";
import type { Member } from "@/lib/collaboration/activity";
import { EmptyState } from "@/components/ui/empty-state";
import { AttachmentCard } from "./AttachmentCard";
import { AttachmentRow } from "./AttachmentRow";
import { FilePreviewLightbox } from "./FilePreviewLightbox";

type ViewMode = "gallery" | "list";

export function FilesTab({
  cache,
  previewUrls,
  thumbUrls,
  members,
  currentUserId,
  isUploading,
  uploadError,
  onUpload,
  onDelete,
}: {
  cache: AttachmentsCache | undefined;
  previewUrls: Record<string, string>;
  /** Optional thumbnail-transform URLs (image rows only); falls back to full-res. */
  thumbUrls?: Record<string, string>;
  members: readonly Member[];
  currentUserId: string;
  isUploading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onDelete: (attachmentId: string) => void;
}) {
  const [mode, setMode] = useState<ViewMode>("gallery");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const attachments = cache?.attachments ?? [];
  const totalBytes = attachments.reduce((n, a) => n + a.size_bytes, 0);

  function pick(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) onUpload(f);
  }

  async function download(attachmentId: string) {
    const res = await getAttachmentDownloadUrl({ attachmentId });
    if (res.ok) window.open(res.data.url, "_blank", "noopener");
  }

  return (
    <div
      className={`flex flex-col gap-4 rounded-md ring-2 transition-shadow ${dragOver ? "ring-ring" : "ring-transparent"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        pick(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-kicker font-mono text-[10px] tracking-wide uppercase">
          {attachments.length} file{attachments.length === 1 ? "" : "s"} ·{" "}
          {formatSize(totalBytes)}
        </span>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMode("gallery")}
              aria-label="Gallery view"
              aria-pressed={mode === "gallery"}
              className={
                mode === "gallery" ? "bg-accent" : "text-muted-foreground"
              }
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMode("list")}
              aria-label="List view"
              aria-pressed={mode === "list"}
              className={
                mode === "list" ? "bg-accent" : "text-muted-foreground"
              }
            >
              <List className="size-4" />
            </Button>
          </div>
          <Button
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            <Plus className="mr-1 size-4" /> Add files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            aria-label="Add files"
            onChange={(e) => pick(e.target.files)}
          />
        </div>
      </div>

      {uploadError && (
        <p className="text-destructive text-xs" role="alert">
          {uploadError}
        </p>
      )}

      {attachments.length === 0 ? (
        <EmptyState variant="inline">
          No files yet. Drop files here or use “Add files”.
        </EmptyState>
      ) : mode === "gallery" ? (
        <div className="grid grid-cols-2 gap-3">
          {attachments.map((a, i) => (
            <AttachmentCard
              key={a.id}
              attachment={a}
              previewUrl={previewUrls[a.id]}
              thumbUrl={thumbUrls?.[a.id]}
              members={members}
              uploading={a.id.startsWith("optimistic-")}
              canDelete={a.uploaded_by === currentUserId}
              onPreview={() => setLightboxIndex(i)}
              onDownload={() => download(a.id)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col">
          {attachments.map((a, i) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              members={members}
              canDelete={a.uploaded_by === currentUserId}
              onPreview={() => setLightboxIndex(i)}
              onDownload={() => download(a.id)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <FilePreviewLightbox
          attachments={attachments}
          index={lightboxIndex}
          previewUrls={previewUrls}
          currentUserId={currentUserId}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDownload={(a) => download(a.id)}
          onDelete={(a) => {
            onDelete(a.id);
            setLightboxIndex(null);
          }}
        />
      )}
    </div>
  );
}
