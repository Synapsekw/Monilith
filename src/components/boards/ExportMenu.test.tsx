import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const exportBoard = vi.fn();
vi.mock("@/lib/boards/spreadsheet-actions", () => ({
  exportBoard: (...args: unknown[]) => exportBoard(...args),
}));

import { ExportMenu } from "@/components/boards/ExportMenu";

const createObjectURL = vi.fn(() => "blob:test-url");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  exportBoard.mockReset();
  createObjectURL.mockReset();
  createObjectURL.mockReturnValue("blob:test-url");
  revokeObjectURL.mockReset();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });
});

describe("ExportMenu", () => {
  it("calls exportBoard with format:csv and creates an object URL on CSV click", async () => {
    exportBoard.mockResolvedValue({
      ok: true,
      data: { fileName: "b.csv", base64: btoa("x"), mime: "text/csv" },
    });

    const user = userEvent.setup();
    render(<ExportMenu boardId="b1" />);

    // Open the dropdown
    await user.click(screen.getByRole("button", { name: /export/i }));

    // Click CSV option
    await user.click(screen.getByRole("menuitem", { name: /csv/i }));

    await waitFor(() =>
      expect(exportBoard).toHaveBeenCalledWith({
        boardId: "b1",
        format: "csv",
      }),
    );

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it("calls exportBoard with format:xlsx and creates an object URL on Excel click", async () => {
    exportBoard.mockResolvedValue({
      ok: true,
      data: {
        fileName: "b.xlsx",
        base64: btoa("x"),
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });

    const user = userEvent.setup();
    render(<ExportMenu boardId="b1" />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByRole("menuitem", { name: /excel/i }));

    await waitFor(() =>
      expect(exportBoard).toHaveBeenCalledWith({
        boardId: "b1",
        format: "xlsx",
      }),
    );

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it("shows an error message when exportBoard returns ok:false", async () => {
    exportBoard.mockResolvedValue({ ok: false, error: "Board not found." });

    const user = userEvent.setup();
    render(<ExportMenu boardId="b1" />);

    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByRole("menuitem", { name: /csv/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Board not found."),
    );
  });
});
