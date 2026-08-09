export type FileKind =
  | "image"
  | "video"
  | "pdf"
  | "doc"
  | "sheet"
  | "slides"
  | "archive"
  | "other";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

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

/** True only for application/pdf (case-insensitive). Pure. */
export function isPdf(mime: string): boolean {
  return mime.toLowerCase() === "application/pdf";
}

/** Lowercased extension, or "" when the name has no dot. Pure.
 *  Note the `lastIndexOf` guard: a bare name like "zip" has no extension and
 *  must not be classified as an archive. */
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

const ARCHIVE_EXT = ["zip", "rar", "7z", "tar", "gz"];
const SHEET_EXT = ["xls", "xlsx", "csv", "numbers", "ods"];
const SLIDES_EXT = ["ppt", "pptx", "key", "odp"];
const DOC_EXT = ["doc", "docx", "txt", "rtf", "md", "pages", "odt"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "avi", "mkv"];

/** Coarse type bucket for icons/badges — mime first, extension fallback. Pure.
 *
 *  The extension fallback covers pdf/image/video too, not just the Office
 *  formats: an upload whose browser reported `application/octet-stream` (which
 *  happens for plenty of real files) would otherwise land in "other" and show
 *  a generic grey icon despite an unambiguous `.pdf` on the end of its name.
 *  Note this is a LABELLING path only — the security gates (`isPreviewable`,
 *  `isPdf`) remain mime-only on purpose, so a mislabelled extension can never
 *  widen what we are willing to render or sign. */
export function fileKind(mime: string, name: string): FileKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf") return "pdf";
  const ext = extOf(name);
  if (ext === "pdf") return "pdf";
  if (ARCHIVE_EXT.includes(ext)) return "archive";
  if (SHEET_EXT.includes(ext)) return "sheet";
  if (SLIDES_EXT.includes(ext)) return "slides";
  if (DOC_EXT.includes(ext)) return "doc";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  return "other";
}

/** Canonical short *family* label for the type chip — 3 chars where possible so
 *  the smallest chip stays narrow. Deliberately a family label, not the literal
 *  extension: "PPTX"/"DOCX" would widen every chip for no gained information,
 *  and the exact filename is already on the chip's `title`. */
const LABEL_BY_EXT: Record<string, string> = {
  pdf: "PDF",
  ppt: "PPT",
  pptx: "PPT",
  key: "PPT",
  odp: "PPT",
  doc: "DOC",
  docx: "DOC",
  odt: "DOC",
  rtf: "DOC",
  pages: "DOC",
  xls: "XLS",
  xlsx: "XLS",
  ods: "XLS",
  numbers: "XLS",
  csv: "CSV",
  zip: "ZIP",
  rar: "ZIP",
  "7z": "ZIP",
  tar: "ZIP",
  gz: "ZIP",
  jpg: "JPG",
  jpeg: "JPG",
};

/** Short uppercase type label for the chip. Extension first, mime-subtype
 *  fallback, "FILE" as last resort. Pure. */
export function fileTypeLabel(fileName: string, mime: string): string {
  const ext = extOf(fileName);
  const mapped = LABEL_BY_EXT[ext];
  if (mapped) return mapped;
  if (ext) return ext.toUpperCase().slice(0, 4);
  const sub = mime.toLowerCase().split("/")[1] ?? "";
  if (sub) return sub.toUpperCase().slice(0, 4);
  return "FILE";
}

/** Which slot of the `--file-*` palette a file paints with. Deliberately
 *  coarser than FileKind: `csv` and `xlsx` are different kinds but the same
 *  spreadsheet green, and every image/video shares one media tone. */
export type FileTone =
  | "pdf"
  | "doc"
  | "xls"
  | "ppt"
  | "zip"
  | "media"
  | "generic";

const TONE_BY_KIND: Record<FileKind, FileTone> = {
  pdf: "pdf",
  doc: "doc",
  sheet: "xls",
  slides: "ppt",
  archive: "zip",
  image: "media",
  video: "media",
  other: "generic",
};

/** Palette slot for a file, derived from its kind. Pure. */
export function fileTypeTone(fileName: string, mime: string): FileTone {
  return TONE_BY_KIND[fileKind(mime, fileName)];
}

/** True for OOXML .docx only. Legacy binary .doc is NOT included — docx-preview
 *  cannot parse it, so it must fall through to the download card. Pure. */
export function isDocx(mime: string, name: string): boolean {
  return mime.toLowerCase() === DOCX_MIME || extOf(name) === "docx";
}

/** True for the workbook formats `parseWorkbookSheets` can read. Pure. */
export function isSheetParseable(mime: string, name: string): boolean {
  const m = mime.toLowerCase();
  return (
    ["xlsx", "xls", "csv"].includes(extOf(name)) ||
    [XLSX_MIME, XLS_MIME, "text/csv"].includes(m)
  );
}

/** Server-side allow-list: the ONLY files whose bytes we sign for an inline
 *  `fetch` (no download disposition). Each entry has a parser that consumes the
 *  bytes — PDF via PDF.js, DOCX via docx-preview, workbooks via exceljs on the
 *  server. Never a top-level navigation, so nothing signed here can execute
 *  script by being opened. Pure. */
export function isInlineParseable(mime: string, name: string): boolean {
  return isPdf(mime) || isDocx(mime, name) || isSheetParseable(mime, name);
}

/** UI affordance gate: which attachments can open an inline lightbox preview.
 *  This is NOT a signing gate — `isPreviewable` still governs the raster/video
 *  signed URLs and `isInlineParseable` governs the byte-fetch set. Pure. */
export function canPreviewInline(mime: string, name: string): boolean {
  return isPreviewable(mime) || isInlineParseable(mime, name);
}
