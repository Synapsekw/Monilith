---
type: session
date: 2026-06-20-2027
branch: develop
trigger: wrapup
status: complete
tags: [session, attachments, preview, planning]
related:
  - "[[2026-06-20-document-preview-pdf-design]]"
  - "[[2026-06-17-1400-phase4c-attachments]]"
  - "[[2026-06-20-2202-phase6f-pdf-preview-build]]"
---

# Inline PDF preview — spec + plan (6f)

## What changed

- Brainstormed → specced → planned **inline PDF preview** for attachments (proposed slice **6f**, an extension of the Phase 4c attachments subsystem). Planning only — **no code**.
- Spec `docs/superpowers/specs/2026-06-20-document-preview-pdf-design.md` (`ebc5dd1`, pushed); plan `docs/superpowers/plans/2026-06-20-document-preview-pdf.md` (`e1682f4`, pushed).
- Scope locked: **PDF only**, client-side **PDF.js** in the existing `FilePreviewLightbox` (lights up both the item Files tab and the board Files cell), **bucket-only — no new service, no third-party egress**. Dedicated PDF-only signed-URL action; bytes `fetch`ed → canvas (never top-level nav), preserving the forced-download XSS posture.
- **Office (docx/pptx) deferred** behind a convert-to-PDF seam — needs a LibreOffice engine the team isn't standing up yet; the renderer is keyed on "is there a preview PDF", so Office is additive later.
- Plan is 6 tasks, maximally parallel: batch 1 = A (helper) / B (signing) / C (renderer+dep) concurrent → batch 2 = D (card/row affordance) / E (lightbox branch) → batch 3 = F (e2e + gates). Critical-path depth 3.

## Why

PDF is the most common business document and currently renders as icon + Download. The user wanted pixel-perfect Office too, but that requires a conversion service they declined to run now — so we scoped to the zero-infra PDF win and left a clean seam for Office.

## Open threads

- **Not built.** Execution deferred to keep clear of the concurrent 6c session (avoids `pnpm add pdfjs-dist` mutating shared package.json/node_modules + polluted gates). 6c has since shipped, so the tree is now clean to build on.
- Real-risk spots at build time: PDF.js worker bundling under Next 16 (plan carries a `public/`-worker fallback).

## Next session entry point

Execute the plan inline on clean `develop` via `superpowers:subagent-driven-development` — start batch 1 (Tasks A/B/C) concurrently. See [[2026-06-20-document-preview-pdf-design]] + the plan file.
