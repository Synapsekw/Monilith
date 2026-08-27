import { parseMarkdown } from "@/lib/boards/markdown";
import { renderBlocksToHtml } from "@/lib/boards/markdown-html";

/**
 * The printable document an agent's Markdown becomes.
 *
 * Self-contained BY REQUIREMENT, not by preference: `renderHtmlToPdf`
 * (`src/lib/reports/pdf.ts:31`) calls `setContent(..., { waitUntil:
 * "networkidle" })`, so every reference in this document would be fetched by
 * Chromium from inside our serverless function. The AST cannot express an
 * image, a script or raw HTML, the renderer escapes everything, and the CSS
 * below carries no `url(`, `@import` or `@font-face` — so there is nothing to
 * fetch and `networkidle` settles immediately.
 *
 * Visual register deliberately matches `src/lib/reports/report-css.ts` (same
 * system sans, same ink/muted/rule palette, hierarchy from size and weight
 * rather than a typeface) without importing it: that stylesheet is written
 * around the report's own block classes, none of which this markup uses.
 *
 * Pure and dependency-free — no `server-only`, no DOM.
 */
export const AGENT_PDF_CSS = `
  :root { --ink:#1a1c22; --muted:#7c8290; --line:#e7e8ee; --peri:#5866c4; }
  * { box-sizing:border-box; }
  body {
    margin:0; color:var(--ink); background:#fff;
    font:12.5px/1.65 -apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .doc { padding:0 2mm; }
  h1,h2,h3 { line-height:1.25; letter-spacing:-.01em; margin:0 0 8px; page-break-after:avoid; }
  h1 { font-size:26px; font-weight:700; margin-top:0; padding-bottom:10px; border-bottom:2px solid var(--ink); }
  h2 { font-size:17px; font-weight:600; margin-top:22px; }
  h3 { font-size:11px; font-weight:600; margin-top:16px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
  p { margin:0 0 10px; }
  ul,ol { margin:0 0 10px; padding-left:20px; }
  li { margin:0 0 4px; }
  blockquote { margin:0 0 12px; padding-left:11px; border-left:2px solid var(--peri); color:#3a3f4b; }
  code {
    font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
    background:#f4f5f8; border:1px solid var(--line); border-radius:3px; padding:0 3px;
  }
  a { color:var(--peri); text-decoration:none; }
  strong { font-weight:600; }
  del { color:var(--muted); }
`;

/** Markdown → one complete, self-contained HTML document. */
export function buildAgentPdfHtml(markdown: string): string {
  const body = renderBlocksToHtml(parseMarkdown(markdown));
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<style>${AGENT_PDF_CSS}</style></head>` +
    `<body><main class="doc">${body}</main></body></html>`
  );
}
