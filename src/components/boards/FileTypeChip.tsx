import {
  fileTypeLabel,
  fileTypeTone,
  type FileTone,
} from "@/lib/collaboration/attachments-format";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-6 w-5 text-3xs",
  md: "h-8 w-6.5 text-2xs",
  lg: "h-12 w-10 text-xs",
} as const;

/** Tone → fill. Written out rather than composed as `bg-file-${tone}` because
 *  Tailwind scans source statically and never sees an interpolated class. */
const TONE_FILL: Record<FileTone, string> = {
  pdf: "bg-file-pdf",
  doc: "bg-file-doc",
  xls: "bg-file-xls",
  ppt: "bg-file-ppt",
  zip: "bg-file-zip",
  media: "bg-file-media",
  generic: "bg-file-generic",
};

/**
 * A file-type icon: a page silhouette in the format's conventional colour with
 * its short label across the body — PDF red, Word blue, Excel green,
 * PowerPoint orange.
 *
 * This is a deliberate, scoped exception to pulse-ui's "chrome is strictly
 * monochrome" rule, and the second sanctioned multi-colour set after status
 * pills. The justification is recognition, not decoration: users arrive
 * already knowing these colours from Finder, Drive and Office, and a Files
 * column exists precisely so a deck can be told from a spreadsheet without
 * reading. A monochrome variant was tried first and could not do that at 24px.
 *
 * Colour is never the only channel — the label is always present — so the icon
 * still resolves for a colourblind or greyscale reader.
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
  const tone = fileTypeTone(fileName, mimeType);
  return (
    <span
      className={cn(
        // The clipped top-right corner is what reads as "document" rather than
        // "coloured box"; it is the whole silhouette at this size.
        "relative inline-flex shrink-0 items-end justify-center rounded-[3px] pb-0.5 font-mono leading-none font-semibold tracking-tight text-white uppercase [clip-path:polygon(0_0,68%_0,100%_26%,100%_100%,0_100%)]",
        TONE_FILL[tone],
        SIZES[size],
        className,
      )}
    >
      {fileTypeLabel(fileName, mimeType)}
    </span>
  );
}
