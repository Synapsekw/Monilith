import { describe, expect, it } from "vitest";
import { renderHtmlToPdf } from "@/lib/reports/pdf";

// Chromium is heavy; only runs when explicitly enabled (spike + local).
const RUN = process.env.PULSE_PDF_TEST === "1";

describe.skipIf(!RUN)("renderHtmlToPdf", () => {
  it("produces non-empty PDF bytes with a %PDF header", async () => {
    const html = "<!doctype html><html><body><h1>Hello</h1></body></html>";
    const bytes = await renderHtmlToPdf(html, { landscape: true });
    expect(bytes.length).toBeGreaterThan(1000);
    // PDF files start with the ASCII bytes "%PDF"
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 60_000);
});
