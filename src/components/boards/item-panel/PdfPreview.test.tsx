import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const render2d = vi.fn(() => ({ promise: Promise.resolve() }));
const getPage = vi.fn(async () => ({
  getViewport: () => ({ width: 120, height: 160 }),
  render: render2d,
}));
const destroy = vi.fn();

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({ numPages: 2, getPage, destroy }),
  })),
}));

import { PdfPreview } from "./PdfPreview";

beforeEach(() => {
  getPage.mockClear();
  render2d.mockClear();
  global.fetch = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
});

describe("PdfPreview", () => {
  it("fetches the src, renders one canvas per page, and shows the page count", async () => {
    render(<PdfPreview src="https://signed/pdf" />);
    await waitFor(() =>
      expect(screen.getByText(/2 pages?/i)).toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledWith("https://signed/pdf");
    expect(document.querySelectorAll("canvas")).toHaveLength(2);
  });

  it("shows an error message when parsing fails", async () => {
    const pdfjs = await import("pdfjs-dist");
    (
      pdfjs.getDocument as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce({ promise: Promise.reject(new Error("bad pdf")) });
    render(<PdfPreview src="https://signed/bad" />);
    await waitFor(() =>
      expect(screen.getByText(/couldn.t render this pdf/i)).toBeInTheDocument(),
    );
  });
});
