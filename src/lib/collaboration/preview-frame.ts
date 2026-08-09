import type { CSSProperties } from "react";
import type { FileKind } from "@/lib/collaboration/attachments-format";

/** A preview dialog's shape: a hard px width cap plus an optional intrinsic
 *  aspect (width / height). `aspect: null` means "let the content size itself". */
export type PreviewFrame = {
  maxWidthPx: number;
  aspect: number | null;
};

const VW_CAP = 92;
const VH_CAP = 90;

const PRESETS: Record<FileKind, PreviewFrame> = {
  pdf: { maxWidthPx: 900, aspect: 1 / 1.414 },
  doc: { maxWidthPx: 900, aspect: 1 / 1.414 },
  slides: { maxWidthPx: 1200, aspect: 16 / 9 },
  sheet: { maxWidthPx: 1400, aspect: 16 / 10 },
  image: { maxWidthPx: 1100, aspect: null },
  video: { maxWidthPx: 1100, aspect: null },
  archive: { maxWidthPx: 520, aspect: null },
  other: { maxWidthPx: 520, aspect: null },
};

/** Shape to open at, before the asset has reported its real dimensions. Pure. */
export function presetFrame(kind: FileKind): PreviewFrame {
  return PRESETS[kind];
}

/** Refine a preset with an asset's measured aspect. A degenerate measurement
 *  (0, negative, NaN, Infinity) falls back to the preset rather than collapsing
 *  the dialog. Pure. */
export function measuredFrame(kind: FileKind, aspect: number): PreviewFrame {
  const preset = presetFrame(kind);
  if (!Number.isFinite(aspect) || aspect <= 0) return preset;
  return { maxWidthPx: preset.maxWidthPx, aspect };
}

/** Frame → inline style. Encoding the aspect into the WIDTH (`calc(90vh * A)`)
 *  keeps a tall page narrow and a wide deck wide without putting `aspect-ratio`
 *  on a box that also holds the header. Being pure CSS, it stays correct across
 *  window resizes with zero listeners and zero re-renders. Pure. */
export function frameStyle(frame: PreviewFrame): CSSProperties {
  const caps = [`${VW_CAP}vw`];
  if (frame.aspect !== null) {
    const a = Math.round(frame.aspect * 1000) / 1000;
    caps.push(`calc(${VH_CAP}vh * ${a})`);
  }
  caps.push(`${frame.maxWidthPx}px`);
  return { width: `min(${caps.join(", ")})`, maxHeight: `${VH_CAP}vh` };
}
