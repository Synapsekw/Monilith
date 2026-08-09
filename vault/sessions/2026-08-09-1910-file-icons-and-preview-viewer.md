---
type: session
date: 2026-08-09-1910
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  [
    "[[2026-08-09-gotcha-85-a-cache-first-service-worker-poisons-turbopack-dev]]",
    "[[2026-08-09-gotcha-86-bash-3-2-swallows-a-multibyte-char-into-a-variable-name]]",
  ]
---

# File-type icons and a real document viewer

## What changed

- **Files column** — every non-image file now shows a coloured page icon in its conventional
  colour (PDF red, Word blue, Excel green, PowerPoint orange) with its label on the body. New
  `--file-*` token palette in both themes, `FileTypeChip`, and `fileTypeTone`/`fileTypeLabel` in
  `attachments-format.ts`. This is a **deliberate scoped exception** to pulse-ui's monochrome-chrome
  rule — the second sanctioned multi-colour set after status pills. A monochrome chip shipped first
  and was rejected: it could not distinguish a deck from a spreadsheet at 24px.
- **Preview modal** — opens at a per-kind preset then settles to the asset's measured aspect
  (`preview-frame.ts`, emitted as a `--preview-w` CSS `min()` so resize costs zero re-renders).
- **DOCX and XLSX/CSV render inline, with no third party.** DOCX parses in-browser via
  `docx-preview` inside an iframe declared `sandbox="allow-same-origin"` and deliberately **without**
  `allow-scripts`. Spreadsheets parse **server-side** by reusing the import wizard's
  `parseWorkbookSheets` (exceljs, already zip-bomb/row/col guarded), so no spreadsheet parser ships
  to the browser and React escapes every cell. Adding SheetJS would have shipped a second parser for
  a format the repo already parses. PPTX rendering deliberately deferred — every in-browser renderer
  surveyed is immature and echarts-heavy.
- **PDF quality + feedback** — the canvas bitmap was sized in CSS pixels, so every Retina display
  saw half the resolution. Now rendered at `devicePixelRatio` (capped at 2), lazily per page via
  IntersectionObserver, with `fetchWithProgress` streaming real byte counts into a `PreviewProgress`
  bar that is determinate only when `Content-Length` is known.
- **Three regressions I shipped and then fixed**, all layout/environment rather than logic:
  `sm:max-w-sm` survived tailwind-merge and clamped the "bigger" modal to **384px** (narrower than
  before); a grid pane's auto-sized row let the viewer grow to 7272px inside a 616px box so nothing
  scrolled; and `finish-task.sh` aborted mid-run on macOS bash 3.2.
- **Two ADRs** — [[2026-08-09-gotcha-85-a-cache-first-service-worker-poisons-turbopack-dev]] and
  [[2026-08-09-gotcha-86-bash-3-2-swallows-a-multibyte-char-into-a-variable-name]].

## Why

The Files column rendered one generic glyph for every non-image type and the preview was a fixed
768px box, so attachments were effectively unusable as a work surface. The constraint that shaped
every technical choice was the owner's: **customer data must not leave our infrastructure**, which
ruled out the Office Online viewer and pushed both new renderers to client-side or our own server.

## How to test (for the user)

1. Pull `develop`, `pnpm install`, then `rm -rf .next && pnpm dev`.
2. Open a board with a Files column holding a PDF, `.docx`, `.xlsx`, `.pptx`, a `.zip` and an image.
3. **Column:** five distinct coloured page icons — red / blue / green / orange / amber — labels
   legible on each. The image still shows its thumbnail.
4. **Portrait PDF:** large, tall modal. **Landscape PDF:** wide modal — the case presets alone get
   wrong. **ZIP:** small card. **XLSX:** wide.
5. **Multi-page PDF:** text is crisp on a Retina screen; scrolling works and later pages render as
   you reach them; a large file shows a progress bar counting real megabytes.
6. **DOCX** renders formatted text; **XLSX** shows a grid whose sheet tabs switch with no network
   request.
7. **Single-page PDF and an image:** still centred, not stretched — the grid→flex pane change
   affects how every preview type is positioned.
8. Toggle light/dark and re-check icon legibility.

## Open threads

- **Not verified end-to-end by me.** The Chrome extension was not connected and `/boards` redirects
  to login, so every visual claim rests on the test suite, the built CSS, and a headless-Chrome
  layout harness — not on a rendered board. Step 7 above is the one most worth the owner's eyes.
- **PPTX has no inline preview** — deck-shaped card and Download only. Revisit with either a renderer
  tested against real decks or self-hosted LibreOffice → PDF conversion (which also keeps data in).
- `.doc`/`.ppt` legacy binaries fall to the download card by design.
- Offline support is now untestable under `pnpm dev` (the service worker is production-only);
  exercise it with `pnpm build && pnpm start`.

## Next session entry point

Files work is complete and merged; nothing is in flight in this repo. Either take the owner-facing
items from §3 "Next" (the `monolith-desktop` git remote, or the dashboard-widget `SECURITY DEFINER`
question that may be affecting users today), or pick up PPTX preview as its own scoped decision.
