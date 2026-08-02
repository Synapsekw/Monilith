---
type: spec
status: approved
date: 2026-06-20
phase: 6
slice: 6f
tags: [spec, phase/6, attachments, preview, pdf, files]
related:
  - "[[00-north-star]]"
  - "[[2026-06-17-phase-4c-attachments-design]]"
  - "[[2026-06-19-phase-6b-custom-fields-statuses-design]]"
---

# Inline document preview — PDF (attachments extension)

> An extension of the Phase 4c attachments subsystem, not a new phase. Suggested sequencing:
> **after 6c (time tracking)**, as an independent attachments enhancement (call it **6f** if a slot
> is wanted). It has no dependency on 6c/6d/6e and can be built any time the attachments surface is
> free. This spec covers **PDF only**. Office (Word/PowerPoint/Excel) preview is explicitly deferred
> to a future spec because it requires an Office→PDF conversion engine (see §6).

## 1. Goal & scope

Today every attachment that is not a raster image or mp4/webm video renders as **icon + Download** —
including PDFs, the single most common business document. This feature adds **inline PDF rendering**
to the existing preview lightbox, for both attachment surfaces:

- item-level attachments (Phase 4c — the item-panel **Files tab**), and
- Files-column attachments (Phase 6b G3 — the board **Files cell**).

PDFs render with Mozilla **PDF.js** (`pdfjs-dist`) to `<canvas>` in a web worker, **fully
client-side**, with **no new backend service** and **no third-party data egress** — it works with
just the existing private Supabase Storage bucket. The renderer is deliberately keyed on _"is there a
PDF to show"_ rather than _"is the original a PDF,"_ so that a future Office→PDF conversion step slots
in additively with no rework (§6).

### In scope

- Inline render of `application/pdf` attachments in `FilePreviewLightbox`.
- Multi-page **scroll**, page count, and **basic zoom** (fit-width, +/−).
- A PDF-only signed-URL path consumed exclusively by `fetch` → PDF.js (never top-level navigation).
- Lazy loading: `pdfjs-dist` is a client-only dynamic chunk loaded **only when the lightbox opens on
  a PDF** — zero cost to board/item first paint.

### Decisions (locked during brainstorming)

| Decision                 | Choice                                                                          | Rationale                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format scope (this spec) | **PDF only**                                                                    | PDF needs no conversion — it renders client-side as-is. Office needs a LibreOffice engine (a service the team isn't standing up yet). Clean slice.       |
| Renderer                 | **PDF.js (`pdfjs-dist`) → `<canvas>` in a worker, client-only**                 | Renders without executing the PDF's embedded JS; no server, no infra, no tenant-byte egress. Industry-standard, well-maintained.                         |
| Where it renders         | **Extend `FilePreviewLightbox` with one `kind === "pdf"` branch**               | Single existing render surface used by both the Files tab and the Files cell. One change lights up both surfaces; no new viewer component plumbing.      |
| Cell rendering           | **Board Files cells keep the kind-icon** (no first-page thumbnail)              | Rendering N PDFs on board paint blows the perf/data budget. Full render happens only on lightbox-open. Thumbnails are a possible later add.              |
| Signing                  | **New PDF-only signed-URL action**, bytes fetched via `fetch` and fed to PDF.js | Never point an `<iframe>`/`<embed>`/tab at a PDF (that path can run embedded JS / phish). `fetch`→canvas keeps the forced-download security posture.     |
| Office forward-compat    | **Render keyed on an available preview-PDF, not on the original's type**        | Native PDF previews the original; a future Office attachment previews its `derived_pdf_path`. The conversion pipeline becomes a pure additive follow-up. |

### Out of scope (deferred — YAGNI)

- **Word / PowerPoint / Excel preview** — needs an Office→PDF conversion engine (§6). Separate spec.
- **PDF thumbnails inside board cells** — cells keep the kind-icon; revisit with lazy/IntersectionObserver if wanted.
- PDF **text search, text selection, printing, form-filling, annotation, download-of-a-page**.
- Server-side thumbnail generation, page pre-rasterization, caching of rendered pages across sessions.

## 2. Architecture

Three small units, each independently understandable and testable:

### 2.1 `PdfPreview` — the renderer (new, client-only)

`src/components/boards/item-panel/PdfPreview.tsx`, `"use client"`.

- Props: `{ src: string }` where `src` is a short-lived signed URL to the PDF bytes (plus an optional
  `fileName` for the a11y label).
- On mount: `fetch(src)` → `ArrayBuffer` → `pdfjsLib.getDocument({ data })`. Render each page to a
  `<canvas>` inside a scrollable column. Show page count and a small zoom control (fit-width default,
  `+`/`−` steps). Pages render **lazily** (render visible pages first; large PDFs don't decode every
  page up front).
- PDF.js worker configured via `GlobalWorkerOptions.workerSrc`. **The exact worker-bundling approach
  for Next.js 16 must be verified against `node_modules/next/dist/docs/` at plan time** — this is the
  one integration with framework-version risk.
- **Imported with `next/dynamic` and `{ ssr: false }`** from the lightbox so `pdfjs-dist` never
  enters the server bundle and never loads until a PDF lightbox opens.
- Loading and error states: spinner while fetching/parsing; on parse failure, fall back to the
  existing "No inline preview / Download" affordance (a corrupt or password-protected PDF must never
  white-screen the lightbox).

### 2.2 `FilePreviewLightbox` — the integration point (modify)

`src/components/boards/item-panel/FilePreviewLightbox.tsx` gains exactly one branch in the existing
image / video / fallback `if` ladder:

```
previewable && kind === "image"  → <img>
previewable && kind === "video"  → <video>
kind === "pdf" && pdfUrl         → <PdfPreview src={pdfUrl} />   // NEW
otherwise                        → "No inline preview" + Download // unchanged
```

`fileKind()` already returns `"pdf"` for `application/pdf` (see `attachments-format.ts`), so no
classification change is needed. The lightbox receives the PDF's signed URL the same way it receives
`previewUrls` today (looked up by attachment id).

### 2.3 PDF signing (modify `actions.ts` + a small helper)

A new server action mints a **PDF-only**, short-TTL signed URL:

```ts
getAttachmentPdfUrl({ attachmentId }): ActionResult<{ url: string }>
```

- Loads the attachment row (RLS-scoped, org-isolated — unchanged from existing actions).
- **Rejects** any attachment whose `mime_type` is not `application/pdf` (defense in depth — the only
  bytes we ever sign for inline `fetch` are PDFs the client renders via PDF.js).
- Signs **without** a `download` disposition (the bytes are consumed by `fetch`, not navigated to) at
  a short TTL (reuse `PREVIEW_TTL`).
- The lightbox calls this when opening on a `kind === "pdf"` attachment. Native raster/video continue
  to use `getAttachmentPreviewUrls`; the forced-download `getAttachmentDownloadUrl` is unchanged.

> Alternative considered: fold PDF into `getAttachmentPreviewUrls` by adding `application/pdf` to the
> `isPreviewable` set. **Rejected** — `isPreviewable` also gates `<img>`/top-level preview surfaces;
> widening it risks a PDF reaching a navigation/`<img>` context. A dedicated PDF path keeps the
> raster/video allow-list narrow and the PDF bytes on the `fetch`→canvas path only.

## 3. Data flow

1. User opens an attachment in the lightbox (Files tab or Files cell), index lands on a PDF.
2. Lightbox sees `kind === "pdf"`, calls `getAttachmentPdfUrl({ attachmentId })` → short-TTL signed URL.
3. Lightbox lazily imports `PdfPreview` (first PDF open in the session pulls the `pdfjs-dist` chunk).
4. `PdfPreview` `fetch`es the URL → `ArrayBuffer` → PDF.js renders pages to canvas in the worker.
5. User scrolls pages / zooms — all client-side, no further round-trips. Download/Delete/Prev/Next
   chrome in the lightbox is unchanged.

No RSC navigation, no Server Action mutation — opening a preview is pure client state (existing
lightbox pattern). PDF.js executes none of the document's embedded scripts.

## 4. Security

- **No top-level PDF navigation.** Bytes are read by `fetch` and drawn to `<canvas>`; we never set an
  `<iframe src>`, `<embed>`, or `window.open` to a PDF. This preserves the Phase 4c posture where
  arbitrary uploads are forced-download to prevent HTML/SVG/PDF script execution.
- **PDF.js does not run embedded JavaScript** by default (we do not enable `enableScripting`).
- **Tenant isolation unchanged.** `getAttachmentPdfUrl` is RLS-scoped exactly like the existing
  signing actions; signed URLs are short-lived; the bucket stays private. Nothing leaves Monolith's
  trust boundary — no third-party viewer, no conversion vendor.
- **MIME gate.** The signing action refuses to sign anything but `application/pdf`, so the PDF path
  can never be coerced into signing/serving a different object type inline.

## 5. Testing

- **Unit** — `getAttachmentPdfUrl`: signs for a PDF row, **rejects** a non-PDF mime, behaves under
  the RLS-scoped not-found path. `fileKind` already covered; add a guard assertion that `pdf` routes
  to the PDF branch.
- **Component** — `FilePreviewLightbox`: with `pdfjs-dist`/`PdfPreview` mocked, asserts the PDF
  branch renders for a PDF attachment, the image/video branches are untouched, and a PDF.js parse
  error falls back to the Download affordance.
- **e2e (Playwright)** — upload a small fixture PDF → open the lightbox → assert a canvas is present
  and the page count shows; assert scroll/zoom controls operate.
- **Gates** (AGENTS.md §4): `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green; no new
  advisor warnings (no schema change in this spec, so advisors are unaffected).

## 6. Forward-compat: Office preview (future, out of scope here)

This spec is deliberately shaped so Office support is **additive**, not a rewrite:

- The lightbox already asks "**is there a preview PDF for this attachment?**" — for a native PDF that
  is the original object; for a future `.docx`/`.pptx`, it will be a **derived PDF**.
- When Office is built, it adds: (a) a conversion engine (LibreOffice/Gotenberg as an external
  service, or a managed API — an infra decision deferred by the team for now); (b) an async pipeline
  that writes the converted PDF under a `derived/<…>` prefix in the **same** bucket and records a
  `derived_pdf_path` + conversion status on the attachment; (c) a tiny change to the signing action
  to return the derived PDF's path for Office rows. `PdfPreview` itself does not change.
- Nothing in this PDF slice blocks that, and nothing here needs to be undone to get there.

### Performance / data-fetching budget (AGENTS.md §5)

| Question                                | Answer                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| First board/item paint                  | **0 new round-trips.** Cells/rows render from already-loaded attachment metadata (the kind-icon).    |
| Per interaction (open a PDF)            | One signed-URL action call + one bytes `fetch` + a one-time lazy `pdfjs-dist` chunk. No RSC re-run.  |
| Server data changed by the interaction? | **No** → pure client state + existing lightbox open/close. No Server Action mutation, no revalidate. |
| Hot-path read bounded & indexed?        | Yes — one PDF at a time; pages lazy-render; signing reads a single attachment row by id (PK).        |

## 7. Execution sketch (full DAG lives in the plan)

Three units with light coupling: **(A) signing action** and **(B) `PdfPreview` renderer** are
independent and parallelizable; **(C) lightbox integration** depends on both. The `writing-plans`
step produces the task-level Execution DAG, parallel batches, and critical path per AGENTS.md §6.
