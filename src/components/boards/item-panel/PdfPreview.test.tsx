import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const render2d = vi.fn(() => ({ promise: Promise.resolve() }));
const getViewport = vi.fn(({ scale }: { scale: number }) => ({
  width: 120 * scale,
  height: 160 * scale,
}));
const getPage = vi.fn(async () => ({ getViewport, render: render2d }));
const destroy = vi.fn();

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({ numPages: 2, getPage }),
    destroy,
  })),
}));

import { PdfPreview } from "./PdfPreview";

/** A minimal Response that fetchWithProgress accepts (no streaming body). */
function okResponse(bytes = 8, contentLength: string | null = "8") {
  return {
    ok: true,
    headers: {
      get: (k: string) => (k === "content-length" ? contentLength : null),
    },
    body: undefined,
    arrayBuffer: async () => new ArrayBuffer(bytes),
  } as unknown as Response;
}

beforeEach(() => {
  getPage.mockClear();
  render2d.mockClear();
  getViewport.mockClear();
  global.fetch = vi.fn(async () => okResponse()) as unknown as typeof fetch;
});

afterEach(() => {
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
});

describe("PdfPreview", () => {
  it("fetches the src, renders one canvas per page, and shows the page count", async () => {
    render(<PdfPreview src="https://signed/pdf" />);
    await waitFor(() =>
      expect(screen.getByText(/2 pages?/i)).toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledWith("https://signed/pdf");
    await waitFor(() =>
      expect(document.querySelectorAll("canvas")).toHaveLength(2),
    );
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

  it("reports page 1's intrinsic aspect", async () => {
    const onAspect = vi.fn();
    render(<PdfPreview src="https://signed/pdf" onAspect={onAspect} />);
    await waitFor(() => expect(onAspect).toHaveBeenCalledWith(120 / 160));
  });

  describe("resolution", () => {
    // The bug this pins: the canvas bitmap was sized in CSS pixels, so on a
    // devicePixelRatio-2 display the page was rasterised at half the pixels the
    // screen shows and upscaled — visibly soft. The bitmap must be in DEVICE
    // pixels while the CSS box stays logical.
    it("rasterises at devicePixelRatio, not at CSS pixels", async () => {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        value: 2,
      });
      render(<PdfPreview src="https://signed/pdf" />);
      await waitFor(() =>
        expect(document.querySelectorAll("canvas").length).toBeGreaterThan(0),
      );
      // jsdom reports clientWidth 0, so fit falls back to 1 and the viewport
      // scale is exactly the DPR.
      const scales = getViewport.mock.calls.map((c) => c[0].scale);
      expect(scales).toContain(2);
    });

    it("caps the bitmap at 2x so a DPR-3 display cannot cost 9x the memory", async () => {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        value: 3,
      });
      render(<PdfPreview src="https://signed/pdf" />);
      await waitFor(() =>
        expect(document.querySelectorAll("canvas").length).toBeGreaterThan(0),
      );
      const scales = getViewport.mock.calls.map((c) => c[0].scale);
      expect(scales).toContain(2);
      expect(scales).not.toContain(3);
    });

    it("sets a logical CSS width so the dense bitmap is not drawn oversized", async () => {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        value: 2,
      });
      render(<PdfPreview src="https://signed/pdf" />);
      await waitFor(() =>
        expect(document.querySelectorAll("canvas").length).toBeGreaterThan(0),
      );
      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      expect(canvas.style.width).toBe("100%");
      expect(canvas.style.height).toBe("auto");
    });
  });

  describe("loading feedback", () => {
    it("shows a progress bar while the document downloads", async () => {
      let resolveFetch: (r: Response) => void = () => {};
      global.fetch = vi.fn(
        () => new Promise<Response>((r) => (resolveFetch = r)),
      ) as unknown as typeof fetch;

      render(<PdfPreview src="https://signed/pdf" />);
      // Visible before any bytes land — this is the window that previously
      // looked frozen.
      expect(await screen.findByRole("progressbar")).toBeInTheDocument();

      resolveFetch(okResponse());
      await waitFor(() =>
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
      );
    });

    it("reports a real percentage as bytes arrive when Content-Length is known", async () => {
      // Hand-driven stream: the test decides when each chunk lands, so the
      // intermediate percentage is observable rather than raced past.
      let releaseChunk: () => void = () => {};
      const gate = () =>
        new Promise<void>((r) => {
          releaseChunk = r;
        });
      let served = 0;
      global.fetch = vi.fn(async () => ({
        ok: true,
        headers: {
          get: (k: string) => (k === "content-length" ? "100" : null),
        },
        body: {
          getReader: () => ({
            read: async () => {
              if (served === 0) {
                served = 1;
                return { done: false, value: new Uint8Array(25) };
              }
              await gate();
              return { done: true, value: undefined };
            },
          }),
        },
      })) as unknown as typeof fetch;

      render(<PdfPreview src="https://signed/pdf" />);

      await waitFor(() =>
        expect(screen.getByRole("progressbar")).toHaveAttribute(
          "aria-valuenow",
          "25",
        ),
      );
      expect(screen.getByText(/25 B of 100 B/)).toBeInTheDocument();

      releaseChunk();
      await waitFor(() =>
        expect(screen.getByText(/2 pages?/i)).toBeInTheDocument(),
      );
    });
  });
});
