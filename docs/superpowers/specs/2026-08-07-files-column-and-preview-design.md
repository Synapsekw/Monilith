# Files column & preview modal — design

**Date:** 2026-08-07
**Status:** Approved, ready for planning

## Context

Two related complaints about the attachments experience:

1. **The Files column can't tell file types apart.** `FilesCell.tsx` renders an image thumbnail
   for rasters, `Film` for video, and a generic `FileText` for _everything else_ — so a PDF, a
   deck, a spreadsheet, a Word doc and a ZIP are visually identical chips.
2. **The preview modal is tiny and one-shaped.** `FilePreviewLightbox.tsx` is a fixed
   `sm:max-w-3xl` (≈768px) dialog with `max-h-[60vh]` panes regardless of what's inside. A
   landscape deck and a portrait A4 page get the same cramped box.

A third gap surfaced while scoping: inline rendering only exists for raster images, mp4/webm and
PDF. Office files fall through to _"No inline preview for this file type."_ The constraint set on
fixing that was explicit — **customer data must not leave our infrastructure**, which rules out
the Microsoft Office Online viewer (it requires a publicly-reachable signed URL and Microsoft
fetches the bytes).

Intended outcome: file types are identifiable at a glance in the column; the preview modal is
large and shaped to its content; and DOCX/XLSX/CSV render inline without a third party or new
server infrastructure.

## Non-goals

- **PPTX rendering.** Every in-browser PPTX renderer surveyed is immature (`@aiden0z/pptx-renderer`
  and `react-pptx-preview-kit` both pull in echarts 6; `react-pptx-preview-kit` is at v0.1.x with
  two published versions). Fidelity against real decks is unproven. `.pptx` gets the `slides`
  kind, a `PPT` chip and a 16:9 deck-shaped card — no rendered slides. This is a separate
  decision after a renderer is tested against real files.
- **Legacy binary `.doc` / `.ppt`.** Not parseable by the chosen libraries; they fall to the card.
- **A Content-Security-Policy.** Still the deliberate follow-up documented at `next.config.ts:82`.
  Its absence _is_ load-bearing for decision D below.

## Design

### A. Type vocabulary — `src/lib/collaboration/attachments-format.ts`

The canonical module for file-type reasoning; extend it rather than adding a parallel helper.

- `FileKind` gains `"slides"` — `ppt`, `pptx`, `key`, `odp`. Extend `sheet` with `ods`, `doc`
  with `odt`.
- New pure `fileTypeLabel(fileName, mime): string` — the canonical **family** label, uppercase,
  3 chars wherever possible so the smallest chip stays narrow: `pptx|ppt|key|odp → PPT`,
  `docx|doc|odt|rtf → DOC`, `xlsx|xls|ods → XLS`, `csv → CSV`, `pdf → PDF`,
  `zip|rar|7z|tar|gz → ZIP`, otherwise the extension uppercased and capped at 4 (`MP4`, `PNG`,
  `WEBP`). Extension first, mime-subtype fallback, `FILE` as last resort. Deliberately a family
  label, not the literal extension — `PPTX` and `DOCX` would widen every chip for no gained
  information, and the exact filename is already on the chip's `title`.
- `canPreviewInline()` extended to the newly-renderable set (it gates the `Eye` affordance in
  `AttachmentCard` / `AttachmentRow`).
- New `isInlineParseable(mime, name): boolean` — the **server-side** allow-list of files whose
  bytes we are willing to sign for `fetch`-and-parse: PDF, DOCX, XLSX/XLS, CSV.

All pure; table-driven Vitest.

### B. `<FileTypeChip>` — `src/components/boards/FileTypeChip.tsx`

Placed beside `ThumbImg.tsx`, which sets the precedent for a component shared between
`boards/cells/` and `boards/item-panel/`.

- Neutral tile, hairline `border-border`, `font-mono uppercase` label, sizes `sm` (column cell,
  ~28×24 — sized so the rare 4-char label still fits without clipping) / `md` (list row) /
  `lg` (gallery card). The chip carries the full filename as its `title`, as `FilesCell` does today.
- **Strictly monochrome.** `pulse-ui`'s rule — _"Chrome is strictly monochrome. Color is
  earned"_ — stands; status pills remain the only sanctioned multi-color surface. Colored
  Drive/Finder-style icons were considered and rejected on that basis.
- Consumers: `FilesCell` (replaces the generic `FileText`), `AttachmentCard` (replaces its bare
  `FileText`), `AttachmentRow` (replaces its bare `File`), and the lightbox's no-preview state.
- Images keep `ThumbImg`; the chip is the fallback when no thumbnail URL resolved.

### C. Smart modal shape — `src/lib/collaboration/preview-frame.ts` (new, pure)

Two-stage sizing: a per-kind preset on open (no layout jump, no flash of the wrong shape), then
refinement to the asset's measured aspect.

| Kind              | Preset max width | Preset aspect      |
| ----------------- | ---------------- | ------------------ |
| `pdf`, `doc`      | 900px            | 1 : 1.414 portrait |
| `slides`          | 1200px           | 16 : 9             |
| `sheet`           | 1400px           | 16 : 10            |
| `image`, `video`  | 1100px           | none (fit content) |
| `archive`,`other` | 520px            | none (card)        |

`frameStyle(frame)` emits `width: min(92vw, calc(90vh * A), Wpx)` plus `aspect-ratio`. Being
**pure CSS**, the modal stays correctly shaped through window resizes with zero resize listeners
and zero re-renders.

Measured-aspect sources (lightbox holds `aspect` state, reset on index change):

- image → `onLoad`, `naturalWidth / naturalHeight`
- video → `onLoadedMetadata`, `videoWidth / videoHeight`
- pdf → new `onAspect` prop on `PdfPreview`, reporting page 1's `getViewport({ scale: 1 })` —
  **already computed** at `PdfPreview.tsx:49`, so this is one callback, not extra work
- docx / sheet / slides → preset only

### D. DOCX preview — `src/components/boards/item-panel/DocxPreview.tsx`

`docx-preview@0.4.0` (Apache-2.0, 952KB, sole dependency `jszip`, updated 2026-07),
`dynamic(…, { ssr: false })` exactly like `PdfPreview` so it never enters the server bundle or
the board's first paint.

**Security:** rendered into an iframe declared `sandbox="allow-same-origin"` — deliberately
**without** `allow-scripts`. Omitting `allow-scripts` means a malicious `.docx` cannot execute
script and its embedded CSS cannot leak into the app chrome, while `allow-same-origin` keeps
`contentDocument` reachable so blob-URL images still resolve. This mitigation is required
because the app ships no CSP (`next.config.ts:82`).

`.docx` only. Legacy `.doc` falls to the file card.

### E. XLSX / CSV preview — server-parsed, **no new dependency**

`parseWorkbookSheets()` in `src/lib/boards/spreadsheet/parse-workbook.ts` already parses xlsx and
csv via exceljs for the board import wizard, and already carries the hardening this needs: a
zip-bomb guard that rejects on declared dimensions _before_ allocating the grid, `MAX_ROWS = 2000`,
`MAX_COLS = 40`, and an existing `PREVIEW_GRID_ROWS = 200` constant.

- New server action `getAttachmentSheetPreview({ attachmentId })` — RLS-checked row → sign →
  fetch bytes → `parseWorkbookSheets` → return the first `PREVIEW_GRID_ROWS` rows per sheet.
- Client `SheetPreview.tsx` renders a plain React `<table>` with sheet tabs. React escapes text
  nodes, so XSS is impossible by construction. (`sheet_to_html`-style raw-HTML rendering is
  explicitly not used.)
- **exceljs stays server-only** — its 21MB unpacked and node-only dependencies (`archiver`,
  `unzipper`, `tmp`, `readable-stream`) never reach the browser bundle.

Adding SheetJS was the obvious move and would have been wrong: it ships a second parser for a
format this repo already parses, and npm's `xlsx` is frozen at 0.18.5 since SheetJS moved
distribution to its own CDN registry.

### F. Generalize the signed-URL action — `src/lib/collaboration/actions.ts`

`getAttachmentPdfUrl` → `getAttachmentPreviewUrl`, gated on `isInlineParseable` instead of the
hardcoded `mime === "application/pdf"` check. The existing guarantee and its comment are
preserved verbatim: no `download` disposition, bytes consumed by `fetch` → parser, never
top-level navigation, short `PREVIEW_TTL`. One call site (`FilePreviewLightbox`).

### G. Modal chrome fix

`FilePreviewLightbox.tsx:100-117` wires _both_ "Open in new tab" and "Download" to `onDownload`.
Since the header is being rebuilt for the new sizing, "Open in new tab" gets a real
`window.open(url, "_blank", "noopener")`.

## Performance & data-fetching budget (working agreement #5)

- **First paint** of a board or item panel: unchanged. `PdfPreview`, `DocxPreview` and
  `SheetPreview` are all `ssr: false` dynamic imports, fetched only when a preview opens.
- **Opening a preview:** one server action — `getAttachmentPreviewUrl` (pdf/docx) or
  `getAttachmentSheetPreview` (xlsx/csv). Same cost as today's PDF path.
- **In-modal interaction** (arrow navigation between attachments, pdf zoom, sheet-tab switching,
  window resize): **0 new server round-trips.** Sheet tabs switch over the already-returned
  grid; modal shape is pure CSS `min()`, so resize costs 0 re-renders.
- **Bounded reads:** sheet previews are capped server-side at 200 rows × 40 columns before any
  grid is allocated. Attachment lists are already bounded by item.

## Execution DAG (working agreement #6)

**Batch 1** — no shared files, fully parallel:

- **T1** — `attachments-format.ts` vocabulary (`slides`, `fileTypeLabel`, `isInlineParseable`,
  `canPreviewInline`) + `FileTypeChip.tsx`. _Produces:_ type vocabulary, chip component.
- **T2** — `preview-frame.ts` presets + `frameStyle`. _Produces:_ frame module.
- **T3** — `getAttachmentSheetPreview` server action + `getAttachmentPreviewUrl` generalization.
  _Consumes:_ nothing (uses existing `parseWorkbookSheets`). _Produces:_ sheet-preview action.

**Batch 2:**

- **T4** — `FilesCell`, `AttachmentCard`, `AttachmentRow` adopt `FileTypeChip`. _Consumes:_ T1.
- **T5** — `DocxPreview.tsx` (sandboxed iframe renderer). _Consumes:_ T3's signed-URL action.
- **T6** — `SheetPreview.tsx` client table + sheet tabs. _Consumes:_ T3.

**Batch 3:**

- **T7** — `FilePreviewLightbox` rewire: frame sizing, aspect plumbing (incl. `PdfPreview`'s new
  `onAspect`), new renderers, header fix. _Consumes:_ T2, T4, T5, T6.

**Critical path:** T3 → T6 → T7.

## Testing

- **Pure units (Vitest):** `fileTypeLabel` / `fileKind` / `isInlineParseable` truth tables
  including extension-vs-mime disagreement and unknown types; `presetFrame` / `frameStyle`
  output for each kind and for measured aspects.
- **Components (RTL):** `FileTypeChip` renders the right label per input; `FilesCell` shows chips
  for non-image kinds and thumbnails for images; `FilePreviewLightbox` applies the preset frame
  on open and the refined frame after an `<img>` `load` event; "Open in new tab" opens rather
  than downloads.
- **Server action:** `getAttachmentPreviewUrl` refuses a mime outside `isInlineParseable`;
  `getAttachmentSheetPreview` truncates to `PREVIEW_GRID_ROWS` and surfaces the existing
  oversize-sheet error.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Manual acceptance:** upload one each of PDF (portrait + landscape), DOCX, XLSX, CSV, PPTX,
  PNG and ZIP to an item; confirm distinct chips in the Files column, and that each opens at a
  sensibly-shaped, large modal.
