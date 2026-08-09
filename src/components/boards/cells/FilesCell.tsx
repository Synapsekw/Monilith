import { useRef } from "react";
import { Paperclip, Plus } from "lucide-react";
import type { Tables } from "@/types/database.types";
import { fileKind } from "@/lib/collaboration/attachments-format";
import { ThumbImg } from "@/components/boards/ThumbImg";
import { FileTypeChip } from "@/components/boards/FileTypeChip";

type A = Tables<"attachments">;
const MAX = 3;

/**
 * Read-only-ish thumbnail strip for a Files column cell: up to {@link MAX}
 * file chips (image preview when a signed URL is available, otherwise a kind
 * icon), an overflow badge, and an upload affordance. Pure presentational —
 * upload/open are delegated to callbacks. Click on a chip opens the lightbox
 * at that index; the `+`/paperclip button opens the hidden file picker.
 */
export function FilesCell({
  files,
  previewUrls,
  thumbUrls,
  onOpen,
  onUpload,
}: {
  files: readonly A[];
  previewUrls: Record<string, string>;
  /** Optional thumbnail-transform URLs (image rows only); falls back to full-res. */
  thumbUrls?: Record<string, string>;
  onOpen: (index: number) => void;
  onUpload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const shown = files.slice(0, MAX);
  const overflow = files.length - shown.length;
  return (
    <span
      aria-label={`${files.length} files`}
      className="flex items-center gap-1"
    >
      {shown.map((a, i) => {
        const url = previewUrls[a.id];
        const thumb = thumbUrls?.[a.id];
        const k = fileKind(a.mime_type, a.file_name);
        return (
          <button
            key={a.id}
            type="button"
            title={a.file_name}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(i);
            }}
            className="flex h-6 min-w-6 items-center justify-center pointer-coarse:size-11"
          >
            {k === "image" && (thumb || url) ? (
              <ThumbImg
                thumbUrl={thumb}
                fullUrl={url}
                alt=""
                className="border-border size-6 overflow-hidden rounded border object-cover pointer-coarse:size-11"
              />
            ) : (
              // Every non-image kind gets its own coloured page icon — PDF red,
              // Word blue, Excel green — rather than one generic glyph for all.
              // The button draws no border of its own here: the icon IS the
              // silhouette, and a box around it would fight the clipped corner.
              <FileTypeChip fileName={a.file_name} mimeType={a.mime_type} />
            )}
          </button>
        );
      })}
      {overflow > 0 && (
        <span className="text-muted-foreground text-xs">+{overflow}</span>
      )}
      <button
        type="button"
        aria-label="Add file"
        onClick={(e) => {
          e.stopPropagation();
          input.current?.click();
        }}
        className="text-muted-foreground hover:text-foreground grid place-items-center pointer-coarse:size-11"
      >
        {files.length ? (
          <Plus className="size-3.5" />
        ) : (
          <Paperclip className="size-3.5" />
        )}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          for (const f of Array.from(e.target.files ?? [])) onUpload(f);
          e.currentTarget.value = "";
        }}
      />
    </span>
  );
}
