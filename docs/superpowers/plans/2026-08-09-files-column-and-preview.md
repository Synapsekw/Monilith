# Files Column & Preview Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Files column distinct per-type chips, and make the preview modal large and shaped to its content, with inline DOCX/XLSX/CSV rendering that never sends tenant bytes to a third party.

**Architecture:** Extend the canonical `attachments-format.ts` vocabulary with a `slides` kind plus pure label/allow-list helpers; add a pure `preview-frame.ts` that turns a file kind (and later a measured aspect ratio) into a CSS width — so modal shape is pure CSS with zero resize listeners. DOCX renders client-side via `docx-preview` inside a script-less sandboxed iframe. XLSX/CSV are parsed **server-side** by the existing, already-hardened `parseWorkbookSheets()` and rendered as a plain React table, so no spreadsheet parser ever enters the browser bundle.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4 + shadcn, Vitest + React Testing Library, Supabase Storage signed URLs, `pdfjs-dist` (existing), `exceljs` (existing, server-only), `docx-preview` (new, client-only).

**Spec:** `docs/superpowers/specs/2026-08-07-files-column-and-preview-design.md`

## Global Constraints

- **Next.js 16.** Server Components by default; Server Actions for all mutations. Confirm APIs against `node_modules/next/dist/docs/` — do not trust training data.
- **TypeScript strict. Avoid `any`** — justify in a comment when genuinely unavoidable.
- **Zod at every boundary.** Server action inputs parse through a schema in `src/lib/validations/`.
- **Reuse canonical modules.** Server actions return `ActionResult` and fail via `fail` from `src/lib/actions/result.ts`. Never re-declare those shapes.
- **pulse-ui design system.** Chrome is strictly monochrome — semantic tokens only (`bg-surface-muted`, `text-muted-foreground`, `border-border`), never raw Tailwind colors (`bg-zinc-800`, `text-red-500`). Mono type is `font-mono` (JetBrains Mono).
- **No new client-side spreadsheet parser.** `exceljs` stays server-only. Do not add SheetJS/`xlsx`.
- **All heavy renderers are `dynamic(…, { ssr: false })`** so they never enter the server bundle or a board's first paint.
- **Commit identity is pinned** to `Danijel Jovanovic <info@synapse-solutions.ai>`; `start-task.sh` asserts it.
- **Stage by path.** Never `git add -A` / `git add .` / `git commit -a`.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must all pass before finishing.

## File Structure

**Create:**

| Path                                               | Responsibility                                       |
| -------------------------------------------------- | ---------------------------------------------------- |
| `src/lib/collaboration/preview-frame.ts`           | Pure: file kind + optional aspect → CSS width/height |
| `src/lib/collaboration/sheet-preview-actions.ts`   | Server action parsing an xlsx/csv attachment         |
| `src/components/boards/FileTypeChip.tsx`           | Monochrome mono-label type chip                      |
| `src/components/boards/item-panel/DocxPreview.tsx` | Client-only DOCX renderer (sandboxed iframe)         |
| `src/components/boards/item-panel/XlsxPreview.tsx` | Client sheet table + sheet tabs                      |

**Modify:** `src/lib/collaboration/attachments-format.ts` (vocabulary), `src/lib/validations/collaboration-actions.ts` (schema rename), `src/lib/collaboration/actions.ts` (generalize the signed-URL action), `src/components/boards/cells/FilesCell.tsx`, `src/components/boards/item-panel/AttachmentCard.tsx`, `AttachmentRow.tsx`, `PdfPreview.tsx` (add `onAspect`), `FilePreviewLightbox.tsx` (the rewire).

## Execution DAG

- **Batch 1 (parallel):** Task 1, Task 2, Task 3
- **Batch 2 (parallel):** Task 4 (needs 1), Task 5 (needs 3), Task 6 (needs 3)
- **Batch 3:** Task 7 (needs 2, 4, 5, 6)
- **Critical path:** Task 3 → Task 6 → Task 7

---

### Task 1: File-type vocabulary

**Files:**

- Modify: `src/lib/collaboration/attachments-format.ts`
- Test: `src/lib/collaboration/attachments-format.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type FileKind = "image" | "video" | "pdf" | "doc" | "sheet" | "slides" | "archive" | "other"`
  - `fileTypeLabel(fileName: string, mime: string): string`
  - `isDocx(mime: string, name: string): boolean`
  - `isSheetParseable(mime: string, name: string): boolean`
  - `isInlineParseable(mime: string, name: string): boolean`
  - `canPreviewInline(mime: string, name: string): boolean` — **signature changed**, now takes the filename too.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/collaboration/attachments-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  fileKind,
  fileTypeLabel,
  isDocx,
  isSheetParseable,
  isInlineParseable,
  canPreviewInline,
} from "./attachments-format";

describe("fileKind — slides", () => {
  it.each(["deck.pptx", "deck.ppt", "deck.key", "deck.odp"])(
    "classifies %s as slides",
    (name) => {
      expect(fileKind("application/octet-stream", name)).toBe("slides");
    },
  );

  it("classifies .ods as a sheet and .odt as a doc", () => {
    expect(fileKind("application/octet-stream", "b.ods")).toBe("sheet");
    expect(fileKind("application/octet-stream", "b.odt")).toBe("doc");
  });

  it("does not treat an extensionless name as its own extension", () => {
    // "zip" with no dot must NOT classify as an archive.
    expect(fileKind("application/octet-stream", "zip")).toBe("other");
  });
});

describe("fileTypeLabel", () => {
  it.each([
    ["report.pdf", "PDF"],
    ["deck.pptx", "PPT"],
    ["deck.ppt", "PPT"],
    ["notes.docx", "DOC"],
    ["notes.doc", "DOC"],
    ["budget.xlsx", "XLS"],
    ["budget.xls", "XLS"],
    ["rows.csv", "CSV"],
    ["bundle.tar", "ZIP"],
    ["photo.jpeg", "JPG"],
    ["clip.mp4", "MP4"],
  ])("labels %s as %s", (name, expected) => {
    expect(fileTypeLabel(name, "application/octet-stream")).toBe(expected);
  });

  it("caps an unknown long extension at 4 characters", () => {
    expect(fileTypeLabel("a.sketchfile", "application/octet-stream")).toBe(
      "SKET",
    );
  });

  it("falls back to the mime subtype when there is no extension", () => {
    expect(fileTypeLabel("noextension", "image/png")).toBe("PNG");
  });

  it("falls back to FILE when it has neither", () => {
    expect(fileTypeLabel("noextension", "")).toBe("FILE");
  });
});

describe("inline-parse allow-list", () => {
  const DOCX =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const XLSX =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("accepts docx by mime or by extension", () => {
    expect(isDocx(DOCX, "a.bin")).toBe(true);
    expect(isDocx("application/octet-stream", "a.docx")).toBe(true);
  });

  it("rejects legacy binary .doc — docx-preview cannot parse it", () => {
    expect(isDocx("application/msword", "a.doc")).toBe(false);
  });

  it("accepts xlsx/xls/csv as sheets", () => {
    expect(isSheetParseable(XLSX, "a.bin")).toBe(true);
    expect(isSheetParseable("application/octet-stream", "a.xls")).toBe(true);
    expect(isSheetParseable("text/csv", "a.csv")).toBe(true);
  });

  it("gates the signable set to pdf + docx + sheets", () => {
    expect(isInlineParseable("application/pdf", "a.pdf")).toBe(true);
    expect(isInlineParseable(DOCX, "a.docx")).toBe(true);
    expect(isInlineParseable("text/csv", "a.csv")).toBe(true);
    // Not parseable — must never be signed for inline fetch.
    expect(isInlineParseable("image/svg+xml", "a.svg")).toBe(false);
    expect(isInlineParseable("application/zip", "a.zip")).toBe(false);
    expect(isInlineParseable("application/vnd.ms-powerpoint", "a.pptx")).toBe(
      false,
    );
  });

  it("canPreviewInline covers rasters, video, and the parseable set", () => {
    expect(canPreviewInline("image/png", "a.png")).toBe(true);
    expect(canPreviewInline("video/mp4", "a.mp4")).toBe(true);
    expect(canPreviewInline("application/pdf", "a.pdf")).toBe(true);
    expect(canPreviewInline("text/csv", "a.csv")).toBe(true);
    expect(canPreviewInline("application/zip", "a.zip")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/collaboration/attachments-format.test.ts`
Expected: FAIL — `fileTypeLabel is not a function`, and the `slides` cases fail.

- [ ] **Step 3: Implement the vocabulary**

In `src/lib/collaboration/attachments-format.ts`, extend the union and add the helpers. Replace the existing `fileKind` body and the existing `canPreviewInline`:

```ts
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

/** Coarse type bucket for icons/badges — mime first, extension fallback. Pure. */
export function fileKind(mime: string, name: string): FileKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf") return "pdf";
  const ext = extOf(name);
  if (ARCHIVE_EXT.includes(ext)) return "archive";
  if (SHEET_EXT.includes(ext)) return "sheet";
  if (SLIDES_EXT.includes(ext)) return "slides";
  if (DOC_EXT.includes(ext)) return "doc";
  return "other";
}

/** Canonical short *family* label for the type chip — 3 chars where possible so
 *  the smallest chip stays narrow. Deliberately a family label, not the literal
 *  extension: "PPTX"/"DOCX" would widen every chip for no gained information,
 *  and the exact filename is already on the chip's `title`. Pure. */
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

export function fileTypeLabel(fileName: string, mime: string): string {
  const ext = extOf(fileName);
  const mapped = LABEL_BY_EXT[ext];
  if (mapped) return mapped;
  if (ext) return ext.toUpperCase().slice(0, 4);
  const sub = mime.toLowerCase().split("/")[1] ?? "";
  if (sub) return sub.toUpperCase().slice(0, 4);
  return "FILE";
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
 *  server. Never a top-level navigation, so no file here can execute script by
 *  being opened. Pure. */
export function isInlineParseable(mime: string, name: string): boolean {
  return isPdf(mime) || isDocx(mime, name) || isSheetParseable(mime, name);
}

/** UI affordance gate: which attachments can open an inline preview at all.
 *  This is NOT a signing gate — `isPreviewable` still governs the raster/video
 *  signed URLs and `isInlineParseable` governs byte-fetch. Pure. */
export function canPreviewInline(mime: string, name: string): boolean {
  return isPreviewable(mime) || isInlineParseable(mime, name);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/collaboration/attachments-format.test.ts`
Expected: PASS. If a pre-existing test called `canPreviewInline(mime)` with one argument, update that call site in the test to pass a filename — the signature intentionally changed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collaboration/attachments-format.ts src/lib/collaboration/attachments-format.test.ts
git commit -m "feat(files): add slides kind, type labels, and the inline-parse allow-list"
```

---

### Task 2: Preview frame sizing

**Files:**

- Create: `src/lib/collaboration/preview-frame.ts`
- Test: `src/lib/collaboration/preview-frame.test.ts`

**Interfaces:**

- Consumes: `FileKind` from `@/lib/collaboration/attachments-format` (Task 1). If Task 1 has not landed, `slides` may not exist yet — add it to the local `PRESETS` map regardless; TypeScript will reconcile once Task 1 merges.
- Produces:
  - `type PreviewFrame = { maxWidthPx: number; aspect: number | null }`
  - `presetFrame(kind: FileKind): PreviewFrame`
  - `measuredFrame(kind: FileKind, aspect: number): PreviewFrame`
  - `frameStyle(frame: PreviewFrame): CSSProperties`

**Design note:** `frameStyle` emits only `width` + `maxHeight`. Encoding the aspect into the _width_ (`calc(90vh * A)`) means a tall portrait page gets a narrow dialog and a wide deck gets a wide one, without putting `aspect-ratio` on a box that also contains a header. Pure CSS ⇒ correct through window resizes with zero listeners and zero re-renders.

- [ ] **Step 1: Write the failing test**

Create `src/lib/collaboration/preview-frame.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { presetFrame, measuredFrame, frameStyle } from "./preview-frame";

describe("presetFrame", () => {
  it("gives PDFs a portrait page shape", () => {
    const f = presetFrame("pdf");
    expect(f.maxWidthPx).toBe(900);
    expect(f.aspect).toBeCloseTo(1 / 1.414, 3);
  });

  it("gives decks a wide 16:9 shape", () => {
    expect(presetFrame("slides")).toEqual({
      maxWidthPx: 1200,
      aspect: 16 / 9,
    });
  });

  it("gives sheets the widest shape", () => {
    expect(presetFrame("sheet").maxWidthPx).toBe(1400);
  });

  it("lets images and video size themselves", () => {
    expect(presetFrame("image").aspect).toBeNull();
    expect(presetFrame("video").aspect).toBeNull();
  });

  it("gives unpreviewable files a small card", () => {
    expect(presetFrame("other").maxWidthPx).toBe(520);
    expect(presetFrame("archive").maxWidthPx).toBe(520);
  });
});

describe("measuredFrame", () => {
  it("overrides the preset aspect with the measured one", () => {
    expect(measuredFrame("pdf", 1.6)).toEqual({ maxWidthPx: 900, aspect: 1.6 });
  });

  it("ignores a degenerate aspect and falls back to the preset", () => {
    expect(measuredFrame("pdf", 0)).toEqual(presetFrame("pdf"));
    expect(measuredFrame("pdf", -3)).toEqual(presetFrame("pdf"));
    expect(measuredFrame("pdf", Number.NaN)).toEqual(presetFrame("pdf"));
    expect(measuredFrame("pdf", Number.POSITIVE_INFINITY)).toEqual(
      presetFrame("pdf"),
    );
  });
});

describe("frameStyle", () => {
  it("caps width by viewport, aspect-derived height, and the px cap", () => {
    expect(frameStyle({ maxWidthPx: 1200, aspect: 16 / 9 })).toEqual({
      width: "min(92vw, calc(90vh * 1.778), 1200px)",
      maxHeight: "90vh",
    });
  });

  it("omits the aspect term when there is no aspect", () => {
    expect(frameStyle({ maxWidthPx: 520, aspect: null })).toEqual({
      width: "min(92vw, 520px)",
      maxHeight: "90vh",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/collaboration/preview-frame.test.ts`
Expected: FAIL — cannot find module `./preview-frame`.

- [ ] **Step 3: Implement the module**

Create `src/lib/collaboration/preview-frame.ts`:

```ts
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
 *  (0, negative, NaN, Infinity) falls back to the preset rather than
 *  collapsing the dialog. Pure. */
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/collaboration/preview-frame.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collaboration/preview-frame.ts src/lib/collaboration/preview-frame.test.ts
git commit -m "feat(files): pure preview-frame sizing from file kind and measured aspect"
```

---

### Task 3: Server actions — generalized signed URL + sheet parsing

**Files:**

- Modify: `src/lib/validations/collaboration-actions.ts:63-71`
- Modify: `src/lib/collaboration/actions.ts:284-311` (the `getAttachmentPdfUrl` block) and its import block at `:1-18`
- Create: `src/lib/collaboration/sheet-preview-actions.ts`
- Test: `src/lib/collaboration/sheet-preview-actions.test.ts`

**Interfaces:**

- Consumes: `isInlineParseable` / `isSheetParseable` (Task 1); existing `parseWorkbookSheets` from `@/lib/boards/spreadsheet/parse-workbook`; existing `MAX_BYTES`, `MAX_COLS`, `PREVIEW_GRID_ROWS`, `type SheetPreview` from `@/lib/boards/spreadsheet/types`; existing `fail` / `ActionResult` from `@/lib/actions/result`.
- Produces:
  - `getAttachmentPreviewUrl(input: { attachmentId: string }): Promise<ActionResult<{ url: string }>>` — replaces `getAttachmentPdfUrl`.
  - `getAttachmentSheetPreview(input: { attachmentId: string }): Promise<ActionResult<{ sheets: SheetPreview[] }>>` where `SheetPreview = { name: string; rowCount: number; colCount: number; grid: string[][] }`.

**Why a separate file for the sheet action:** it is the only collaboration action that imports `exceljs` (via `parseWorkbookSheets`). Isolating it keeps that dependency edge obvious and keeps `actions.ts` from growing further.

- [ ] **Step 1: Rename the schema**

In `src/lib/validations/collaboration-actions.ts`, rename `attachmentPdfUrlSchema` → `attachmentPreviewUrlSchema` and its inferred type. One schema serves both actions — the input shape is identical.

```ts
export const attachmentPreviewUrlSchema = z.object({
  attachmentId: z.string().uuid(),
});

export type AttachmentPreviewUrlInput = z.infer<
  typeof attachmentPreviewUrlSchema
>;
```

- [ ] **Step 2: Write the failing test for the sheet action**

Create `src/lib/collaboration/sheet-preview-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const createSignedUrl = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));

const parseWorkbookSheets = vi.fn();
vi.mock("@/lib/boards/spreadsheet/parse-workbook", () => ({
  parseWorkbookSheets: (...a: unknown[]) => parseWorkbookSheets(...a),
}));

import { getAttachmentSheetPreview } from "./sheet-preview-actions";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://signed.example/x" },
    error: null,
  });
  global.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
});

describe("getAttachmentSheetPreview", () => {
  it("rejects an attachment that is not a spreadsheet", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        storage_path: "p",
        mime_type: "application/pdf",
        file_name: "a.pdf",
        size_bytes: 10,
      },
      error: null,
    });
    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(false);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects a missing row without signing", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(false);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("truncates each sheet to PREVIEW_GRID_ROWS but reports the true rowCount", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        storage_path: "p",
        mime_type: "text/csv",
        file_name: "a.csv",
        size_bytes: 100,
      },
      error: null,
    });
    const grid = Array.from({ length: 250 }, (_, i) => [`r${i}`, "b"]);
    parseWorkbookSheets.mockResolvedValue([{ name: "Sheet1", grid }]);

    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [sheet] = res.data.sheets;
    expect(sheet.name).toBe("Sheet1");
    expect(sheet.rowCount).toBe(250);
    expect(sheet.colCount).toBe(2);
    expect(sheet.grid).toHaveLength(200); // PREVIEW_GRID_ROWS
  });

  it("surfaces a parser failure as a failed ActionResult", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        storage_path: "p",
        mime_type: "text/csv",
        file_name: "a.csv",
        size_bytes: 100,
      },
      error: null,
    });
    parseWorkbookSheets.mockRejectedValue(new Error("empty"));
    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(false);
  });

  it("rejects an oversized file before fetching any bytes", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        storage_path: "p",
        mime_type: "text/csv",
        file_name: "a.csv",
        size_bytes: 99_000_000,
      },
      error: null,
    });
    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/collaboration/sheet-preview-actions.test.ts`
Expected: FAIL — cannot find module `./sheet-preview-actions`.

- [ ] **Step 4: Implement the sheet action**

Create `src/lib/collaboration/sheet-preview-actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { attachmentPreviewUrlSchema } from "@/lib/validations/collaboration-actions";
import { isSheetParseable } from "@/lib/collaboration/attachments-format";
import { parseWorkbookSheets } from "@/lib/boards/spreadsheet/parse-workbook";
import {
  MAX_BYTES,
  PREVIEW_GRID_ROWS,
  type SheetPreview,
} from "@/lib/boards/spreadsheet/types";
import { fail, type ActionResult } from "@/lib/actions/result";

const PREVIEW_TTL = 300;

/**
 * Parse an xlsx/xls/csv attachment into a bounded grid for the preview modal.
 *
 * Parsing happens HERE, on the server, reusing the import wizard's
 * `parseWorkbookSheets` — which already carries the zip-bomb guard (it rejects
 * on declared dimensions before allocating a grid) and the MAX_ROWS/MAX_COLS
 * caps. That keeps exceljs and its node-only dependencies out of the browser
 * bundle entirely, and means the client only ever receives plain strings that
 * React escapes on render.
 */
export async function getAttachmentSheetPreview(input: {
  attachmentId: string;
}): Promise<ActionResult<{ sheets: SheetPreview[] }>> {
  const parsed = attachmentPreviewUrlSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // RLS scopes this to the caller's org; a missing row is indistinguishable
  // from one they cannot see, which is the intent.
  const { data: row, error } = await supabase
    .from("attachments")
    .select("storage_path, mime_type, file_name, size_bytes")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (error || !row) return fail("Attachment not found.");

  if (!isSheetParseable(row.mime_type, row.file_name))
    return fail("Not a spreadsheet.");

  // Check the recorded size before spending a signed URL or a byte of transfer.
  if (row.size_bytes > MAX_BYTES)
    return fail("This spreadsheet is too large to preview.");

  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrl(row.storage_path, PREVIEW_TTL);
  if (signErr || !signed) return fail("Could not read the file.");

  const res = await fetch(signed.signedUrl);
  if (!res.ok) return fail("Could not read the file.");
  const buf = Buffer.from(await res.arrayBuffer());
  // Re-check against the real byte length — size_bytes is client-reported.
  if (buf.length > MAX_BYTES)
    return fail("This spreadsheet is too large to preview.");

  let raw;
  try {
    raw = await parseWorkbookSheets(buf, row.file_name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return fail(`Could not parse this spreadsheet: ${msg}`);
  }

  const sheets: SheetPreview[] = raw.map((s) => ({
    name: s.name,
    // rowCount/colCount describe the WHOLE sheet; grid is the truncated view,
    // so the UI can say "showing 200 of 4,000 rows".
    rowCount: s.grid.length,
    colCount: s.grid.reduce((max, r) => Math.max(max, r.length), 0),
    grid: s.grid.slice(0, PREVIEW_GRID_ROWS),
  }));

  return { ok: true, data: { sheets } };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/collaboration/sheet-preview-actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Generalize the signed-URL action**

In `src/lib/collaboration/actions.ts`, replace the whole `getAttachmentPdfUrl` function with the version below, update the schema import to `attachmentPreviewUrlSchema`, and add `isInlineParseable` to the existing `attachments-format` import.

```ts
export async function getAttachmentPreviewUrl(input: {
  attachmentId: string;
}): Promise<ActionResult<{ url: string }>> {
  const parsed = attachmentPreviewUrlSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("attachments")
    .select("storage_path, mime_type, file_name")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (error || !row) return fail("Attachment not found.");

  // Defense in depth: the only bytes we ever sign for inline `fetch` (no
  // download disposition) are formats a parser consumes — PDF via PDF.js,
  // DOCX via docx-preview. The bytes reach a parser, never a top-level
  // navigation, so nothing signed here can execute script by being opened.
  if (!isInlineParseable(row.mime_type, row.file_name))
    return fail("Not a previewable file.");

  // No `download` disposition. Short TTL (shared with the gallery window).
  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrl(row.storage_path, PREVIEW_TTL);
  if (signErr || !signed) return fail("Could not sign preview URL.");
  return { ok: true, data: { url: signed.signedUrl } };
}
```

- [ ] **Step 7: Update the one call site and verify nothing references the old name**

Run: `rg "getAttachmentPdfUrl|attachmentPdfUrlSchema" src/`
Expected: only `src/components/boards/item-panel/FilePreviewLightbox.tsx`. Change its import to `getAttachmentPreviewUrl` and update the call. Re-run the search until it returns no hits.

- [ ] **Step 8: Run the full suite**

Run: `pnpm vitest run src/lib/collaboration/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/validations/collaboration-actions.ts src/lib/collaboration/actions.ts src/lib/collaboration/sheet-preview-actions.ts src/lib/collaboration/sheet-preview-actions.test.ts src/components/boards/item-panel/FilePreviewLightbox.tsx
git commit -m "feat(files): generalize the preview-url action and add server-side sheet parsing"
```

---

### Task 4: FileTypeChip and its consumers

**Files:**

- Create: `src/components/boards/FileTypeChip.tsx`
- Test: `src/components/boards/FileTypeChip.test.tsx`
- Modify: `src/components/boards/cells/FilesCell.tsx:39-68`
- Modify: `src/components/boards/item-panel/AttachmentCard.tsx:44-59`
- Modify: `src/components/boards/item-panel/AttachmentRow.tsx:31-35`

**Interfaces:**

- Consumes: `fileTypeLabel`, `fileKind`, `canPreviewInline(mime, name)` (Task 1); existing `cn` from `@/lib/utils`; existing `ThumbImg` from `@/components/boards/ThumbImg`.
- Produces: `<FileTypeChip fileName={string} mimeType={string} size?={"sm"|"md"|"lg"} className?={string} />`

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/FileTypeChip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileTypeChip } from "./FileTypeChip";

describe("FileTypeChip", () => {
  it("renders the family label for a deck", () => {
    render(<FileTypeChip fileName="q3.pptx" mimeType="application/x" />);
    expect(screen.getByText("PPT")).toBeInTheDocument();
  });

  it("renders PDF for a pdf", () => {
    render(<FileTypeChip fileName="a.pdf" mimeType="application/pdf" />);
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });

  it("uses monochrome tokens only — never a raw color class", () => {
    const { container } = render(
      <FileTypeChip fileName="a.xlsx" mimeType="application/x" />,
    );
    const cls = container.firstElementChild?.className ?? "";
    expect(cls).not.toMatch(/\b(bg|text|border)-(red|green|blue|orange)-/);
    expect(cls).toContain("font-mono");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/boards/FileTypeChip.test.tsx`
Expected: FAIL — cannot find module `./FileTypeChip`.

- [ ] **Step 3: Implement the chip**

Create `src/components/boards/FileTypeChip.tsx`:

```tsx
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/boards/FileTypeChip.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Adopt the chip in FilesCell**

In `src/components/boards/cells/FilesCell.tsx`, replace the per-chip body. Drop the now-unused `Film` and `FileText` imports, and add `import { FileTypeChip } from "@/components/boards/FileTypeChip";`. Keep the wrapping `<button>`, its `title`, and its `onClick` exactly as they are — only the inner content and the button's size classes change:

```tsx
<button
  key={a.id}
  type="button"
  title={a.file_name}
  onClick={(e) => {
    e.stopPropagation();
    onOpen(i);
  }}
  className="border-border flex h-6 items-center justify-center overflow-hidden rounded border pointer-coarse:h-11"
>
  {k === "image" && (thumb || url) ? (
    <ThumbImg
      thumbUrl={thumb}
      fullUrl={url}
      alt=""
      className="size-6 object-cover pointer-coarse:size-11"
    />
  ) : (
    <FileTypeChip
      fileName={a.file_name}
      mimeType={a.mime_type}
      className="border-0 bg-transparent"
    />
  )}
</button>
```

Note the button loses its fixed `size-6` (square) in favour of `h-6` so a 3–4 character label is not clipped; the chip supplies `min-w-7`. The chip's own border is suppressed because the button already draws one.

- [ ] **Step 6: Adopt the chip in AttachmentCard and AttachmentRow**

In `AttachmentCard.tsx`, replace the `<FileText className="text-muted-foreground size-8" aria-hidden />` fallback with `<FileTypeChip fileName={attachment.file_name} mimeType={attachment.mime_type} size="lg" />`, and drop the `FileText` import. Keep the `Play` icon for video. Update its `canPreviewInline(attachment.mime_type)` call to `canPreviewInline(attachment.mime_type, attachment.file_name)`.

In `AttachmentRow.tsx`, replace `<File className="text-muted-foreground size-4 shrink-0" aria-hidden />` with `<FileTypeChip fileName={attachment.file_name} mimeType={attachment.mime_type} size="md" />`, drop the `File` import, and likewise update the `canPreviewInline` call to pass `attachment.file_name`.

- [ ] **Step 7: Run the affected suites**

Run: `pnpm vitest run src/components/boards/cells/FilesCell.test.tsx src/components/boards/item-panel/AttachmentCard.test.tsx src/components/boards/item-panel/AttachmentRow.test.tsx src/components/boards/FileTypeChip.test.tsx`
Expected: PASS. Existing tests asserting on a generic file icon will need their assertion updated to the label text — that is the intended behavior change, not a regression.

- [ ] **Step 8: Commit**

```bash
git add src/components/boards/FileTypeChip.tsx src/components/boards/FileTypeChip.test.tsx src/components/boards/cells/FilesCell.tsx src/components/boards/item-panel/AttachmentCard.tsx src/components/boards/item-panel/AttachmentRow.tsx
git commit -m "feat(files): distinct mono type chips in the files column, card, and row"
```

---

### Task 5: DocxPreview

**Files:**

- Create: `src/components/boards/item-panel/DocxPreview.tsx`
- Test: `src/components/boards/item-panel/DocxPreview.test.tsx`
- Modify: `package.json` (add `docx-preview`)

**Interfaces:**

- Consumes: a signed URL string from `getAttachmentPreviewUrl` (Task 3).
- Produces: `<DocxPreview src={string} />` — a client-only component, imported by Task 7 via `dynamic(…, { ssr: false })`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add docx-preview@^0.4.0`
Verify it resolves to 0.4.0 (Apache-2.0, sole runtime dep `jszip`).

- [ ] **Step 2: Write the failing test**

Create `src/components/boards/item-panel/DocxPreview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const renderAsync = vi.fn(async () => undefined);
vi.mock("docx-preview", () => ({
  renderAsync: (...a: unknown[]) => renderAsync(...a),
}));

import { DocxPreview } from "./DocxPreview";

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(["x"]),
  })) as unknown as typeof fetch;
});

describe("DocxPreview", () => {
  it("renders into a sandboxed iframe that cannot run scripts", async () => {
    const { container } = render(<DocxPreview src="https://s/x.docx" />);
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    // The whole security model: same-origin so we can reach contentDocument,
    // but NO allow-scripts, so a malicious .docx cannot execute anything.
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-scripts");
  });

  it("fetches the source and hands the blob to docx-preview", async () => {
    render(<DocxPreview src="https://s/x.docx" />);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("https://s/x.docx"),
    );
    await waitFor(() => expect(renderAsync).toHaveBeenCalled());
  });

  it("shows an error state when the fetch fails", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    render(<DocxPreview src="https://s/x.docx" />);
    await waitFor(() =>
      expect(
        screen.getByText(/couldn’t render this document/i),
      ).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/components/boards/item-panel/DocxPreview.test.tsx`
Expected: FAIL — cannot find module `./DocxPreview`.

- [ ] **Step 4: Implement the renderer**

Create `src/components/boards/item-panel/DocxPreview.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Status = "loading" | "ready" | "error";

/**
 * Client-only DOCX renderer. Mirrors PdfPreview: the bytes are fetched from a
 * short-lived signed URL and parsed in the browser, so the file never reaches
 * a third party.
 *
 * The document is rendered INSIDE an iframe declared `sandbox="allow-same-origin"`
 * and deliberately WITHOUT `allow-scripts`. Omitting allow-scripts means a
 * hostile .docx cannot execute script, and the iframe boundary keeps the
 * document's own CSS from leaking into the app chrome. `allow-same-origin` is
 * required so we can reach `contentDocument` to render into, and so blob-URL
 * images inside the document still resolve. This matters because the app ships
 * no CSP yet (see the note in next.config.ts).
 */
export function DocxPreview({ src }: { src: string; fileName?: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!frameReady) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus("loading");
        const [{ renderAsync }, res] = await Promise.all([
          import("docx-preview"),
          fetch(src),
        ]);
        if (cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;

        const doc = frameRef.current?.contentDocument;
        if (!doc) return;
        doc.body.replaceChildren();
        doc.body.style.margin = "0";
        doc.body.style.background = "#fff";

        await renderAsync(blob, doc.body, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
        });
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, frameReady]);

  if (status === "error") {
    return (
      <div className="text-muted-foreground py-12 text-sm">
        Couldn’t render this document. Use Download above to open it.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {status === "loading" && (
        <div className="text-muted-foreground absolute inset-0 grid place-items-center text-sm">
          Loading preview…
        </div>
      )}
      <iframe
        ref={frameRef}
        title="Document preview"
        sandbox="allow-same-origin"
        srcDoc="<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
        onLoad={() => setFrameReady(true)}
        className="h-full w-full rounded border-0 bg-white"
      />
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/components/boards/item-panel/DocxPreview.test.tsx`
Expected: PASS (3 tests). If jsdom never fires the iframe `onLoad`, set `frameReady` from a `useEffect` that checks `frameRef.current?.contentDocument` is non-null instead — but try `onLoad` first.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/boards/item-panel/DocxPreview.tsx src/components/boards/item-panel/DocxPreview.test.tsx
git commit -m "feat(files): client-side DOCX preview in a script-less sandboxed iframe"
```

---

### Task 6: XlsxPreview

**Files:**

- Create: `src/components/boards/item-panel/XlsxPreview.tsx`
- Test: `src/components/boards/item-panel/XlsxPreview.test.tsx`

**Interfaces:**

- Consumes: `getAttachmentSheetPreview` (Task 3), returning `ActionResult<{ sheets: SheetPreview[] }>` where `SheetPreview = { name: string; rowCount: number; colCount: number; grid: string[][] }`.
- Produces: `<XlsxPreview attachmentId={string} />` — client-only, imported by Task 7 via `dynamic(…, { ssr: false })`.

**Note:** the component is named `XlsxPreview` (not `SheetPreview`) because `SheetPreview` is already an exported **type** in `src/lib/boards/spreadsheet/types.ts`. Do not shadow it.

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/item-panel/XlsxPreview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getAttachmentSheetPreview = vi.fn();
vi.mock("@/lib/collaboration/sheet-preview-actions", () => ({
  getAttachmentSheetPreview: (...a: unknown[]) =>
    getAttachmentSheetPreview(...a),
}));

import { XlsxPreview } from "./XlsxPreview";

beforeEach(() => vi.clearAllMocks());

describe("XlsxPreview", () => {
  it("renders the first sheet's cells as text", async () => {
    getAttachmentSheetPreview.mockResolvedValue({
      ok: true,
      data: {
        sheets: [
          {
            name: "Budget",
            rowCount: 2,
            colCount: 2,
            grid: [
              ["Item", "Cost"],
              ["Rent", "1200"],
            ],
          },
        ],
      },
    });
    render(<XlsxPreview attachmentId="a1" />);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.getByText("1200")).toBeInTheDocument();
  });

  it("switches sheets on tab click without refetching", async () => {
    getAttachmentSheetPreview.mockResolvedValue({
      ok: true,
      data: {
        sheets: [
          { name: "One", rowCount: 1, colCount: 1, grid: [["alpha"]] },
          { name: "Two", rowCount: 1, colCount: 1, grid: [["beta"]] },
        ],
      },
    });
    render(<XlsxPreview attachmentId="a1" />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByText("beta")).toBeInTheDocument();
    // Sheet switching is pure client state — no second server round-trip.
    expect(getAttachmentSheetPreview).toHaveBeenCalledTimes(1);
  });

  it("notes when the grid was truncated", async () => {
    getAttachmentSheetPreview.mockResolvedValue({
      ok: true,
      data: {
        sheets: [{ name: "Big", rowCount: 4000, colCount: 1, grid: [["x"]] }],
      },
    });
    render(<XlsxPreview attachmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/4,?000/)).toBeInTheDocument());
  });

  it("shows the server's error message on failure", async () => {
    getAttachmentSheetPreview.mockResolvedValue({
      ok: false,
      error: "This spreadsheet is too large to preview.",
    });
    render(<XlsxPreview attachmentId="a1" />);
    await waitFor(() =>
      expect(screen.getByText(/too large to preview/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/boards/item-panel/XlsxPreview.test.tsx`
Expected: FAIL — cannot find module `./XlsxPreview`.

- [ ] **Step 3: Implement the viewer**

Create `src/components/boards/item-panel/XlsxPreview.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { getAttachmentSheetPreview } from "@/lib/collaboration/sheet-preview-actions";
import type { SheetPreview } from "@/lib/boards/spreadsheet/types";
import { cn } from "@/lib/utils";

/**
 * Spreadsheet preview. The workbook is parsed on the SERVER (see
 * sheet-preview-actions.ts) and arrives as plain strings, so no spreadsheet
 * parser ships to the browser and React escapes every cell on render — there
 * is no HTML-injection surface here by construction.
 *
 * Switching sheets is pure client state over the already-fetched payload:
 * zero additional server round-trips.
 */
export function XlsxPreview({ attachmentId }: { attachmentId: string }) {
  const [sheets, setSheets] = useState<SheetPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);
    setActive(0);
    getAttachmentSheetPreview({ attachmentId }).then((res) => {
      if (cancelled) return;
      if (res.ok) setSheets(res.data.sheets);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  if (error)
    return <div className="text-muted-foreground py-12 text-sm">{error}</div>;
  if (!sheets)
    return (
      <div className="text-muted-foreground py-12 text-sm">
        Loading preview…
      </div>
    );
  if (sheets.length === 0)
    return (
      <div className="text-muted-foreground py-12 text-sm">
        This workbook has no sheets.
      </div>
    );

  const sheet = sheets[active] ?? sheets[0];
  const truncated = sheet.rowCount > sheet.grid.length;

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <tbody>
            {sheet.grid.map((row, r) => (
              <tr key={r} className={r === 0 ? "bg-surface-muted" : undefined}>
                <td className="text-kicker border-border sticky left-0 border px-2 py-1 text-right font-mono tabular-nums">
                  {r + 1}
                </td>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "border-border max-w-56 truncate border px-2 py-1",
                      r === 0 && "font-medium",
                    )}
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3">
        <div role="tablist" className="flex min-w-0 gap-1 overflow-x-auto">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              role="tab"
              type="button"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "shrink-0 rounded px-2 py-1 text-xs",
                i === active
                  ? "bg-surface-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
        {truncated && (
          <span className="text-kicker shrink-0 text-xs">
            Showing {sheet.grid.length.toLocaleString()} of{" "}
            {sheet.rowCount.toLocaleString()} rows
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/boards/item-panel/XlsxPreview.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/item-panel/XlsxPreview.tsx src/components/boards/item-panel/XlsxPreview.test.tsx
git commit -m "feat(files): spreadsheet preview with sheet tabs over the server-parsed grid"
```

---

### Task 7: Rewire the lightbox

**Files:**

- Modify: `src/components/boards/item-panel/PdfPreview.tsx:17-73` (add `onAspect`)
- Modify: `src/components/boards/item-panel/FilePreviewLightbox.tsx` (whole file)
- Test: `src/components/boards/item-panel/FilePreviewLightbox.test.tsx`

**Interfaces:**

- Consumes: `presetFrame` / `measuredFrame` / `frameStyle` (Task 2); `getAttachmentPreviewUrl` (Task 3); `FileTypeChip` (Task 4); `DocxPreview` (Task 5); `XlsxPreview` (Task 6); `fileKind` / `isDocx` / `isSheetParseable` / `isPreviewable` (Task 1).
- Produces: nothing downstream.

- [ ] **Step 1: Add `onAspect` to PdfPreview**

In `PdfPreview.tsx`, add an optional `onAspect?: (aspect: number) => void` prop and call it once with page 1's intrinsic ratio. `base` is **already computed** at line 49 — this is one added call, not extra work:

```tsx
export function PdfPreview({
  src,
  onAspect,
}: {
  src: string;
  fileName?: string;
  onAspect?: (aspect: number) => void;
}) {
```

Inside the page loop, immediately after `const base = page.getViewport({ scale: 1 });`:

```tsx
// Report page 1's intrinsic shape so the modal can size itself to a
// portrait vs landscape document. Fires once per document.
if (n === 1 && base.height > 0) onAspect?.(base.width / base.height);
```

Add `onAspect` to the effect's dependency array.

- [ ] **Step 2: Write the failing tests**

Add to `src/components/boards/item-panel/FilePreviewLightbox.test.tsx`. First confirm the file's import line covers everything the new tests use — add whatever is missing:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

The suite also needs the two new dynamic children stubbed, so a jsdom run never tries to load `docx-preview` or hit a server action:

```tsx
vi.mock("./DocxPreview", () => ({
  DocxPreview: () => <div data-testid="docx" />,
}));
vi.mock("./XlsxPreview", () => ({
  XlsxPreview: () => <div data-testid="xlsx" />,
}));
```

Then the new cases:

```tsx
it("opens at the kind preset and refines to the image's measured aspect", async () => {
  const attachments = [
    {
      id: "a1",
      file_name: "wide.png",
      mime_type: "image/png",
      size_bytes: 10,
      uploaded_by: "u1",
    },
  ];
  const { container } = render(
    <FilePreviewLightbox
      attachments={attachments as never}
      index={0}
      previewUrls={{ a1: "https://s/a1.png" }}
      currentUserId="u1"
      onIndexChange={() => {}}
      onClose={() => {}}
      onDownload={() => {}}
      onDelete={() => {}}
    />,
  );

  const panel = await screen.findByRole("dialog");
  // image preset: no aspect term yet
  expect(panel.style.width).toBe("min(92vw, 1100px)");

  const img = container.querySelector("img") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: 1600 });
  Object.defineProperty(img, "naturalHeight", { value: 900 });
  fireEvent.load(img);

  await waitFor(() =>
    expect(panel.style.width).toBe("min(92vw, calc(90vh * 1.778), 1100px)"),
  );
});

it("opens a deck at the 16:9 preset even though it cannot render", async () => {
  const attachments = [
    {
      id: "a1",
      file_name: "q3.pptx",
      mime_type: "application/vnd.ms-powerpoint",
      size_bytes: 10,
      uploaded_by: "u1",
    },
  ];
  render(
    <FilePreviewLightbox
      attachments={attachments as never}
      index={0}
      previewUrls={{}}
      currentUserId="u1"
      onIndexChange={() => {}}
      onClose={() => {}}
      onDownload={() => {}}
      onDelete={() => {}}
    />,
  );
  const panel = await screen.findByRole("dialog");
  expect(panel.style.width).toBe("min(92vw, calc(90vh * 1.778), 1200px)");
  expect(screen.getByText("PPT")).toBeInTheDocument();
});

it("opens in a new tab rather than downloading", async () => {
  const open = vi.fn();
  vi.stubGlobal("open", open);
  const onDownload = vi.fn();
  const attachments = [
    {
      id: "a1",
      file_name: "a.png",
      mime_type: "image/png",
      size_bytes: 10,
      uploaded_by: "u1",
    },
  ];
  render(
    <FilePreviewLightbox
      attachments={attachments as never}
      index={0}
      previewUrls={{ a1: "https://s/a1.png" }}
      currentUserId="u1"
      onIndexChange={() => {}}
      onClose={() => {}}
      onDownload={onDownload}
      onDelete={() => {}}
    />,
  );
  await userEvent.click(screen.getByLabelText("Open in new tab"));
  expect(open).toHaveBeenCalledWith("https://s/a1.png", "_blank", "noopener");
  expect(onDownload).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/components/boards/item-panel/FilePreviewLightbox.test.tsx`
Expected: FAIL — the dialog has no inline `width`, and "Open in new tab" still calls `onDownload`.

- [ ] **Step 4: Rewire the lightbox**

In `FilePreviewLightbox.tsx`:

1. Add the two new dynamic imports alongside the existing `PdfPreview` one:

```tsx
const DocxPreview = dynamic(
  () => import("./DocxPreview").then((m) => m.DocxPreview),
  { ssr: false },
);
const XlsxPreview = dynamic(
  () => import("./XlsxPreview").then((m) => m.XlsxPreview),
  { ssr: false },
);
```

2. **Rename the existing `pdf` state to `signed`** — it now holds the signed URL for PDFs _and_ DOCX, so the old name would mislead. The `{ id, url }` shape stays exactly as it is:

```tsx
// was: const [pdf, setPdf] = useState<{ id: string; url: string | null } | null>(null)
const [signed, setSigned] = useState<{ id: string; url: string | null } | null>(
  null,
);
```

Every `pdf.` / `setPdf(` reference in the file becomes `signed.` / `setSigned(`.

3. Replace the PDF-only signed-URL effect with one that covers PDF **and** DOCX, keyed by attachment id exactly as before (the `{ id, url }` shape is what lets render tell "resolved for THIS file" from "stale"):

```tsx
useEffect(() => {
  const c = attachments[index];
  if (!c) return;
  const needsBytes =
    fileKind(c.mime_type, c.file_name) === "pdf" ||
    isDocx(c.mime_type, c.file_name);
  if (!needsBytes) return;
  let cancelled = false;
  getAttachmentPreviewUrl({ attachmentId: c.id }).then((res) => {
    if (cancelled) return;
    setSigned({ id: c.id, url: res.ok ? res.data.url : null });
  });
  return () => {
    cancelled = true;
  };
}, [attachments, index]);
```

4. Add aspect state, reset whenever the attachment changes:

```tsx
const [aspect, setAspect] = useState<number | null>(null);
useEffect(() => setAspect(null), [index]);
```

5. Compute the frame and apply it to `DialogContent`:

```tsx
const frame = aspect === null ? presetFrame(kind) : measuredFrame(kind, aspect);
```

```tsx
<DialogContent
  className="flex max-w-none flex-col gap-3"
  style={frameStyle(frame)}
>
```

`max-w-none` is required — it defeats the primitive's default `sm:max-w-sm`, which would otherwise win over the inline width.

6. Report aspect from the image and video branches, and pass `onAspect` to `PdfPreview`:

```tsx
<img
  src={url}
  alt={current.file_name}
  onLoad={(e) => {
    const el = e.currentTarget;
    if (el.naturalHeight > 0) setAspect(el.naturalWidth / el.naturalHeight);
  }}
  className="max-h-full max-w-full object-contain"
/>
```

```tsx
<video
  src={url}
  controls
  onLoadedMetadata={(e) => {
    const el = e.currentTarget;
    if (el.videoHeight > 0) setAspect(el.videoWidth / el.videoHeight);
  }}
  className="max-h-full max-w-full"
/>
```

```tsx
<PdfPreview src={signed.url} onAspect={setAspect} />
```

7. Add the DOCX and sheet branches to the content switch, before the final fallback:

```tsx
) : isDocx(current.mime_type, current.file_name) ? (
  signed && signed.id === current.id ? (
    signed.url ? (
      <DocxPreview src={signed.url} />
    ) : (
      <div className="text-muted-foreground py-12 text-sm">
        Couldn’t load preview.
      </div>
    )
  ) : (
    <div className="text-muted-foreground py-12 text-sm">
      Loading preview…
    </div>
  )
) : isSheetParseable(current.mime_type, current.file_name) ? (
  <XlsxPreview attachmentId={current.id} />
) : (
```

8. Replace the bare-text fallback with a chip-led file card:

```tsx
<div className="text-muted-foreground flex flex-col items-center gap-3 py-12 text-sm">
  <FileTypeChip
    fileName={current.file_name}
    mimeType={current.mime_type}
    size="lg"
  />
  <span>No inline preview for this file type.</span>
  <button
    onClick={() => onDownload(current)}
    className="text-primary hover:underline"
  >
    Download
  </button>
</div>
```

9. Fix the header: give "Open in new tab" its own handler.

```tsx
<Button
  variant="ghost"
  size="icon-sm"
  onClick={() => {
    const href = previewUrls[current.id] ?? signed?.url;
    if (href) window.open(href, "_blank", "noopener");
    else onDownload(current);
  }}
  aria-label="Open in new tab"
  className="text-muted-foreground hover:text-foreground"
>
  <ExternalLink className="size-4" />
</Button>
```

10. Make the content pane fill the now-shaped dialog — change its wrapper from `min-h-64` to `min-h-0 flex-1`:

```tsx
<div className="bg-surface-muted relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-md">
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/boards/item-panel/FilePreviewLightbox.test.tsx src/components/boards/item-panel/PdfPreview.test.tsx`
Expected: PASS. Existing lightbox tests asserting `sm:max-w-3xl` must be updated — that class is intentionally gone.

- [ ] **Step 6: Run every gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. `pnpm build` is the one that catches `docx-preview` accidentally entering the server bundle — if it fails there, confirm the `dynamic(…, { ssr: false })` wrapper is present.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/item-panel/PdfPreview.tsx src/components/boards/item-panel/FilePreviewLightbox.tsx src/components/boards/item-panel/FilePreviewLightbox.test.tsx
git commit -m "feat(files): content-shaped preview modal with docx and spreadsheet rendering"
```

---

## Verification

**Automated:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all four green.

**Manual acceptance** (after merge, on `develop`):

1. Open any board with a Files column; add one each of: PDF (one portrait, one landscape), `.docx`, `.xlsx`, `.csv`, `.pptx`, `.png`, `.zip`.
2. **Files column:** every non-image chip shows its own mono label — `PDF`, `DOC`, `XLS`, `CSV`, `PPT`, `ZIP`. Images still show a thumbnail.
3. **Portrait PDF:** click it. The modal is tall and narrow, noticeably bigger than before.
4. **Landscape PDF:** the modal is wide — this is the case presets alone would get wrong.
5. **DOCX:** renders formatted text, not a "no preview" message.
6. **XLSX with multiple sheets:** renders a grid; clicking sheet tabs switches instantly with no network activity (check the Network panel); a >200-row sheet shows "Showing 200 of N rows".
7. **PPTX:** opens in a wide 16:9 frame with a `PPT` chip and a working Download — no rendered slides, as designed.
8. **ZIP:** small card, not a huge empty frame.
9. **Resize the window** with a preview open: the modal re-proportions smoothly with no flicker.
10. **Header:** "Open in new tab" opens a tab; "Download" downloads.
