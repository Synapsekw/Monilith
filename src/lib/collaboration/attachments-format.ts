export type FileKind =
  | "image"
  | "video"
  | "pdf"
  | "doc"
  | "sheet"
  | "archive"
  | "other";

const PREVIEWABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
]);

/** Inline-preview allow-list: raster images + mp4/webm only. SVG is excluded
 *  on purpose — a navigated SVG can execute script; rasters loaded via <img>
 *  cannot. Everything else renders as icon + Download. Pure. */
export function isPreviewable(mime: string): boolean {
  return PREVIEWABLE.has(mime.toLowerCase());
}

/** Human-readable size: B / KB / MB, ≤1 decimal, no trailing ".0". Pure. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trim(kb)} KB`;
  return `${trim(kb / 1024)} MB`;
}

function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Coarse type bucket for icons/badges — mime first, extension fallback. Pure. */
export function fileKind(mime: string, name: string): FileKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf") return "pdf";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  if (["doc", "docx", "txt", "rtf", "md", "pages"].includes(ext)) return "doc";
  return "other";
}
