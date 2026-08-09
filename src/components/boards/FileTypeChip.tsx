import { fileTypeLabel } from "@/lib/collaboration/attachments-format";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-6 min-w-7 rounded px-1 text-[8px]",
  md: "h-8 min-w-9 rounded-md px-1.5 text-[10px]",
  lg: "h-12 min-w-14 rounded-md px-2 text-sm",
} as const;

/**
 * Monochrome mono-label chip identifying a file's type (PDF / PPT / XLS / …).
 *
 * Deliberately NOT colored: pulse-ui keeps chrome strictly monochrome and
 * reserves multi-color for status pills. A mono uppercase label also reads
 * unambiguously at 24px where distinct icon silhouettes do not, and covers any
 * future format for free.
 */
export function FileTypeChip({
  fileName,
  mimeType,
  size = "sm",
  className,
}: {
  fileName: string;
  mimeType: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "border-border bg-surface-muted text-muted-foreground inline-flex shrink-0 items-center justify-center border font-mono font-medium tracking-tight uppercase",
        SIZES[size],
        className,
      )}
    >
      {fileTypeLabel(fileName, mimeType)}
    </span>
  );
}
