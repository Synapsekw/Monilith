import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getAttachmentSheetPreview = vi.fn();
vi.mock("@/lib/collaboration/sheet-preview-actions", () => ({
  getAttachmentSheetPreview: (...a: unknown[]) =>
    getAttachmentSheetPreview(...a),
}));

import { XlsxPreview } from "./XlsxPreview";

beforeEach(() => vi.clearAllMocks());

describe("XlsxPreview", () => {
  it("renders the first sheet's cells as text", async () => {
    getAttachmentSheetPreview.mockResolvedValue({
      ok: true,
      data: {
        sheets: [
          {
            name: "Budget",
            rowCount: 2,
            colCount: 2,
            grid: [
              ["Item", "Cost"],
              ["Rent", "1200"],
            ],
          },
        ],
      },
    });
    render(<XlsxPreview attachmentId="a1" />);
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.getByText("1200")).toBeInTheDocument();
  });

  it("switches sheets on tab click without refetching", async () => {
    getAttachmentSheetPreview.mockResolvedValue({
      ok: true,
      data: {
        sheets: [
          { name: "One", rowCount: 1, colCount: 1, grid: [["alpha"]] },
          { name: "Two", rowCount: 1, colCount: 1, grid: [["beta"]] },
        ],
      },
    });
    render(<XlsxPreview attachmentId="a1" />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByText("beta")).toBeInTheDocument();
    // Sheet switching is pure client state — no second server round-trip.
    expect(getAttachmentSheetPreview).toHaveBeenCalledTimes(1);
  });

  it("notes when the grid was truncated", async () => {
    getAttachmentSheetPreview.mockResolvedValue({
      ok: true,
      data: {
        sheets: [{ name: "Big", rowCount: 4000, colCount: 1, grid: [["x"]] }],
      },
    });
    render(<XlsxPreview attachmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/4,?000/)).toBeInTheDocument());
  });

  it("shows the server's error message on failure", async () => {
    getAttachmentSheetPreview.mockResolvedValue({
      ok: false,
      error: "This spreadsheet is too large to preview.",
    });
    render(<XlsxPreview attachmentId="a1" />);
    await waitFor(() =>
      expect(screen.getByText(/too large to preview/i)).toBeInTheDocument(),
    );
  });
});
