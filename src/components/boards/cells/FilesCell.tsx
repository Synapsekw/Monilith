import { useRef } from "react";
import { Film, FileText, Paperclip, Plus } from "lucide-react";
import type { Tables } from "@/types/database.types";
import { fileKind } from "@/lib/collaboration/attachments-format";

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
  onOpen,
  onUpload,
}: {
  files: readonly A[];
  previewUrls: Record<string, string>;
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
            className="border-border flex size-6 items-center justify-center overflow-hidden rounded border pointer-coarse:size-11"
          >
            {k === "image" && url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="size-full object-cover" />
            ) : k === "video" ? (
              <Film className="size-3.5" />
            ) : (
              <FileText className="size-3.5" />
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
