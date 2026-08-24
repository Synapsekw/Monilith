/**
 * Browser-side text extraction for the reference-document library.
 *
 * Every parser is DYNAMICALLY imported. `pdfjs-dist` and `docx-preview` are
 * large and must never enter the initial bundle — the same reason
 * FilePreviewLightbox.tsx lazy-loads its renderers.
 *
 * `.xlsx` is deliberately NOT handled here. exceljs has node-only dependencies,
 * and `parseWorkbookSheets` already carries the zip-bomb guard (it rejects on
 * declared dimensions before allocating a grid). Reimplementing that in the
 * browser to save a round trip would trade a security control for latency, so
 * workbooks go through `sheet-extract-actions.ts` on the server instead.
 */

export type SourceFormat =
  | "pasted"
  | "markdown"
  | "text"
  | "pdf"
  | "docx"
  | "xlsx";

/** Thrown when a file parses fine but yields no text — e.g. a scanned PDF. */
export class EmptyExtractionError extends Error {
  constructor(fileName: string) {
    super(
      `We couldn't read any text from "${fileName}". If it's a scan or an ` +
        `image-only document, paste the text instead.`,
    );
    this.name = "EmptyExtractionError";
  }
}

const BY_EXTENSION: Record<string, SourceFormat> = {
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
};

export function sourceFormatFor(fileName: string): SourceFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(fileName);
  if (!m) return null;
  return BY_EXTENSION[m[1]!.toLowerCase()] ?? null;
}

async function extractPdf(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  // Same worker wiring as PdfPreview.tsx — pdfjs-dist v6 ships the worker as
  // pdf.worker.min.mjs and it resolves under Next 16 via import.meta.url.
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const buf = await file.arrayBuffer();
  // The loading task owns teardown in pdfjs v6 (destroy() lives here, not on
  // the resolved document proxy) — same as PdfPreview.tsx.
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim(),
    );
  }
  await loadingTask.destroy();
  return pages.filter(Boolean).join("\n\n");
}

async function extractDocx(file: File): Promise<string> {
  const { renderAsync } = await import("docx-preview");
  // docx-preview renders into a DOM node; there is no text-only API. Rendering
  // into a DETACHED container and reading block-level text is what keeps this
  // to the parser the codebase already ships (DocxPreview.tsx) rather than
  // adding a second docx dependency for one function.
  const container = document.createElement("div");
  await renderAsync(
    new Blob([await file.arrayBuffer()]),
    container,
    undefined,
    {
      className: "docx",
      inWrapper: false,
      ignoreLastRenderedPageBreak: true,
      experimental: false,
    },
  );
  // Join per block element. Reading container.textContent directly would run
  // paragraphs together with no separator, which destroys list and heading
  // structure — the very thing a "structure to imitate" document is for.
  const blocks = Array.from(
    container.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, td, th"),
  )
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return blocks.join("\n\n");
}

export async function extractInBrowser(
  file: File,
): Promise<{ text: string; format: SourceFormat }> {
  const format = sourceFormatFor(file.name);
  if (!format)
    throw new Error(
      `"${file.name}" is not supported. Use .md, .txt, .pdf, .docx or .xlsx, ` +
        `or paste the text.`,
    );
  if (format === "xlsx")
    throw new Error(
      "Spreadsheets are extracted on the server; call extractSheetText instead.",
    );

  const text =
    format === "pdf"
      ? await extractPdf(file)
      : format === "docx"
        ? await extractDocx(file)
        : await file.text();

  if (text.trim().length === 0) throw new EmptyExtractionError(file.name);
  return { text, format };
}
