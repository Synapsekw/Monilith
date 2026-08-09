import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const renderAsync = vi.fn(async () => undefined);
vi.mock("docx-preview", () => ({
  renderAsync: (...a: unknown[]) => renderAsync(...a),
}));

import { DocxPreview } from "./DocxPreview";

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(["x"]),
  })) as unknown as typeof fetch;
});

describe("DocxPreview", () => {
  it("renders into a sandboxed iframe that cannot run scripts", () => {
    const { container } = render(<DocxPreview src="https://s/x.docx" />);
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    // The whole security model: same-origin so we can reach contentDocument,
    // but NO allow-scripts, so a malicious .docx cannot execute anything.
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-scripts");
  });

  it("fetches the source and hands the blob to docx-preview", async () => {
    render(<DocxPreview src="https://s/x.docx" />);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("https://s/x.docx"),
    );
    await waitFor(() => expect(renderAsync).toHaveBeenCalled());
  });

  it("shows an error state when the fetch fails", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    render(<DocxPreview src="https://s/x.docx" />);
    await waitFor(() =>
      expect(
        screen.getByText(/couldn’t render this document/i),
      ).toBeInTheDocument(),
    );
  });
});
