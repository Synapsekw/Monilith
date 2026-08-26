import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  sourceFormatFor,
  extractInBrowser,
  EmptyExtractionError,
} from "./extract-text";

describe("sourceFormatFor", () => {
  it("maps known extensions, case-insensitively", () => {
    expect(sourceFormatFor("notes.md")).toBe("markdown");
    expect(sourceFormatFor("notes.MD")).toBe("markdown");
    expect(sourceFormatFor("a.txt")).toBe("text");
    expect(sourceFormatFor("a.pdf")).toBe("pdf");
    expect(sourceFormatFor("a.docx")).toBe("docx");
    expect(sourceFormatFor("a.xlsx")).toBe("xlsx");
  });

  it("returns null for unsupported types", () => {
    expect(sourceFormatFor("a.doc")).toBeNull();
    expect(sourceFormatFor("a.png")).toBeNull();
    expect(sourceFormatFor("noextension")).toBeNull();
  });
});

describe("extractInBrowser", () => {
  it("reads a .txt file as-is", async () => {
    const file = new File(["hello world"], "a.txt", { type: "text/plain" });
    const r = await extractInBrowser(file);
    expect(r.text).toBe("hello world");
    expect(r.format).toBe("text");
  });

  it("reads a .md file as-is", async () => {
    const file = new File(["# Title\n\nBody"], "a.md");
    const r = await extractInBrowser(file);
    expect(r.text).toBe("# Title\n\nBody");
    expect(r.format).toBe("markdown");
  });

  it("throws EmptyExtractionError on a whitespace-only result", async () => {
    const file = new File(["   \n\t  "], "a.txt");
    await expect(extractInBrowser(file)).rejects.toBeInstanceOf(
      EmptyExtractionError,
    );
  });

  it("rejects an unsupported extension", async () => {
    const file = new File(["x"], "a.png");
    await expect(extractInBrowser(file)).rejects.toThrow(/not supported/i);
  });

  it("refuses xlsx — that path is server-side", async () => {
    const file = new File(["x"], "a.xlsx");
    await expect(extractInBrowser(file)).rejects.toThrow(/server/i);
  });

  it("extracts paragraph text from a real .docx", async () => {
    // NOT `new URL("./__fixtures__/one-paragraph.docx", import.meta.url)`:
    // Vite/Vitest statically analyzes that exact call-expression shape as an
    // asset-URL request (the same mechanism the pdf.worker.min.mjs wiring
    // relies on) and rewrites a literal with a recognized extension to a
    // dev-server URL (http://localhost:3000/...) instead of leaving it a
    // runtime file:// URL — so readFile() then fails with "The URL must be of
    // scheme file". path.join sidesteps the pattern match entirely.
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "__fixtures__",
      "one-paragraph.docx",
    );
    const bytes = await readFile(fixturePath);
    const file = new File([bytes], "one-paragraph.docx");
    const r = await extractInBrowser(file);
    expect(r.format).toBe("docx");
    expect(r.text).toContain("Yesterday");
  });

  it("extracts and joins text from every page of a real .pdf", async () => {
    // extractPdf() points GlobalWorkerOptions.workerSrc at a URL derived from
    // `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`. Under
    // Vite/Vitest that literal-with-a-recognized-extension gets the same
    // asset-URL rewrite documented on the docx fixture path below (here it
    // resolves to an http://localhost:3000/... dev-server URL instead of a
    // file:// one). In a real browser that's exactly the resolvable,
    // same-origin URL PdfPreview.tsx relies on — Next's bundler does the
    // equivalent rewrite to a URL browsers can fetch. But pdf.js's fake-worker
    // fallback (jsdom has no real Worker) tries to `import()` that URL, and
    // Node's ESM loader refuses non-file/data protocols, so it fails only in
    // this Node-based test runner, not in the shipped browser code path.
    //
    // Work around it the way pdf.js itself is designed to be primed: the
    // worker module self-registers `globalThis.pdfjsWorker` when merely
    // imported (see pdf.worker.mjs's own `globalThis.pdfjsWorker = {...}`
    // tail). pdf.js's fake-worker setup checks that global FIRST and only
    // falls back to `import(workerSrc)` if it's unset — so importing the
    // worker module once here makes extractPdf's real worker wiring resolve
    // without ever hitting the URL rewrite.
    // @ts-expect-error — pdfjs-dist ships no type declarations for this
    // worker entry point; it's imported purely for its registration side
    // effect, not for any export.
    await import("pdfjs-dist/build/pdf.worker.min.mjs");

    // Same path-construction gotcha as the docx fixture above — path.join,
    // not `new URL(literal, import.meta.url)`.
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "__fixtures__",
      "two-page.pdf",
    );
    const bytes = await readFile(fixturePath);
    const file = new File([bytes], "two-page.pdf");
    const r = await extractInBrowser(file);
    expect(r.format).toBe("pdf");
    // Both pages' known text must survive extraction AND the page join —
    // this is what exercises the worker wiring, loadingTask teardown,
    // multi-page iteration and the "str" in it TextItem narrowing.
    expect(r.text).toContain("Quokka lives on page one.");
    expect(r.text).toContain("Wombat lives on page two.");
  });
});
