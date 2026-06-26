import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const previewImport = vi.fn();
const commitImport = vi.fn();
vi.mock("@/lib/boards/spreadsheet-actions", () => ({
  previewImport: (...args: unknown[]) => previewImport(...args),
  commitImport: (...args: unknown[]) => commitImport(...args),
}));

import { ImportDialog } from "@/components/boards/import/ImportDialog";

// Mock FileReader so readAsDataURL synchronously yields a base64 result
class MockFileReader {
  result: string | null = null;
  onloadend: (() => void) | null = null;
  readAsDataURL(_file: Blob) {
    this.result = "data:application/octet-stream;base64,eA==";
    if (this.onloadend) this.onloadend();
  }
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  previewImport.mockReset();
  commitImport.mockReset();

  // Default preview response: 2 columns
  previewImport.mockResolvedValue({
    ok: true,
    data: {
      boardName: "my-board",
      columns: [
        {
          header: "Status",
          kind: "status",
          options: [{ id: "o1", label: "Done", color: "#00c875" }],
          sampleValues: ["Done"],
        },
        {
          header: "Count",
          kind: "numbers",
          options: [],
          sampleValues: ["1", "2"],
        },
      ],
      rowCount: 2,
      sampleRows: [
        ["Done", "1"],
        ["Done", "2"],
      ],
      droppedSheets: [],
    },
  });

  commitImport.mockResolvedValue({ ok: true, data: { boardId: "b1" } });

  // Install mock FileReader globally
  vi.stubGlobal("FileReader", MockFileReader);
});

describe("ImportDialog", () => {
  it("renders both column headers after file selection", async () => {
    render(
      <ImportDialog workspaceId="ws1" open={true} onOpenChange={() => {}} />,
    );

    // There should be a hidden file input
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    // Simulate picking a file
    const file = new File(["hello"], "data.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Wait for the preview to render — use getAllByText since Radix portal may duplicate nodes
    await waitFor(() =>
      expect(screen.getAllByText("Status").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Count").length).toBeGreaterThan(0);
  });

  it("calls commitImport with edited mapping and navigates on success", async () => {
    const onOpenChange = vi.fn();
    render(
      <ImportDialog
        workspaceId="ws1"
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["hello"], "data.xlsx", {
      type: "application/octet-stream",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Wait for preview stage
    await waitFor(() =>
      expect(screen.getAllByText("Status").length).toBeGreaterThan(0),
    );

    // Change the "Status" column kind from "status" to "text" via its <select>
    // The selects are labeled by column header; find the one near "Status"
    const selects = screen.getAllByRole("combobox");
    // First select corresponds to "Status" column
    fireEvent.change(selects[0], { target: { value: "text" } });

    // Click "Create board"
    fireEvent.click(screen.getByRole("button", { name: /create board/i }));

    await waitFor(() =>
      expect(commitImport).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws1",
          boardName: "my-board",
          columnMappings: expect.arrayContaining([
            expect.objectContaining({
              header: "Status",
              kind: "text",
              options: [],
            }),
            expect.objectContaining({ header: "Count", kind: "numbers" }),
          ]),
        }),
      ),
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("/boards/b1"));
  });

  it("shows error when previewImport fails", async () => {
    previewImport.mockResolvedValue({ ok: false, error: "File too large" });

    render(
      <ImportDialog workspaceId="ws1" open={true} onOpenChange={() => {}} />,
    );

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["x"], "data.csv", { type: "text/csv" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByText("File too large")).toBeInTheDocument(),
    );
  });

  it("keeps status options when kind stays status, drops them when changed", async () => {
    const onOpenChange = vi.fn();
    render(
      <ImportDialog
        workspaceId="ws1"
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["hello"], "data.xlsx", {
      type: "application/octet-stream",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getAllByText("Status").length).toBeGreaterThan(0),
    );

    // Do NOT change the Status kind — leave it as "status"
    fireEvent.click(screen.getByRole("button", { name: /create board/i }));

    await waitFor(() =>
      expect(commitImport).toHaveBeenCalledWith(
        expect.objectContaining({
          columnMappings: expect.arrayContaining([
            expect.objectContaining({
              header: "Status",
              kind: "status",
              options: [{ id: "o1", label: "Done", color: "#00c875" }],
            }),
          ]),
        }),
      ),
    );
  });
});
