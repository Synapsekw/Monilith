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

import { ImportWizard } from "@/components/boards/import/ImportWizard";

// Mock FileReader so readAsDataURL synchronously yields a base64 result
class MockFileReader {
  result: string | null = null;
  onloadend: (() => void) | null = null;
  readAsDataURL(_file: Blob) {
    this.result = "data:application/octet-stream;base64,eA==";
    if (this.onloadend) this.onloadend();
  }
}

// "Name" auto-detects as the structural name column (proposeRoles), "Status"
// is a plain data column — this gives every commit an included role:"name"
// column without any manual mapping.
const GRID = [
  ["Name", "Status"],
  ["Task A", "Done"],
  ["Task B", "Working"],
];

function mockPreviewOk() {
  previewImport.mockResolvedValue({
    ok: true,
    data: {
      fileName: "data.xlsx",
      boardName: "my-board",
      sheets: [{ name: "Sheet1", rowCount: 3, colCount: 2, grid: GRID }],
    },
  });
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  previewImport.mockReset();
  commitImport.mockReset();
  mockPreviewOk();
  commitImport.mockResolvedValue({ ok: true, data: { boardId: "b1" } });
  vi.stubGlobal("FileReader", MockFileReader);
});

function uploadFile() {
  const fileInput = screen.getByLabelText("Choose file") as HTMLInputElement;
  const file = new File(["hello"], "data.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  fireEvent.change(fileInput, { target: { files: [file] } });
}

describe("ImportWizard", () => {
  it("full happy path: upload -> grid visible -> next -> confirm -> commitImport with derived params -> router.push", async () => {
    render(
      <ImportWizard
        destination={{ type: "new", workspaceId: "ws1" }}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    uploadFile();

    // Step 2: the mapping grid is visible — the "Name" column's editable
    // name input is a reliable marker for MappingGrid having rendered.
    await waitFor(() =>
      expect(screen.getByDisplayValue("Name")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: confirm step
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /confirm/i }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(commitImport).toHaveBeenCalledWith(
        expect.objectContaining({
          fileBase64: "eA==",
          fileName: "data.xlsx",
          sheetName: "Sheet1",
          headerRow: 0,
          excludedRows: [],
          columns: expect.arrayContaining([
            expect.objectContaining({ name: "Name", role: "name" }),
          ]),
          destination: {
            type: "new",
            workspaceId: "ws1",
            boardName: "my-board",
          },
        }),
      ),
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("/boards/b1"));
  });

  it("shows a preview error on step 1", async () => {
    previewImport.mockResolvedValue({ ok: false, error: "File too large" });

    render(
      <ImportWizard
        destination={{ type: "new", workspaceId: "ws1" }}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    uploadFile();

    await waitFor(() =>
      expect(screen.getByText("File too large")).toBeInTheDocument(),
    );
    // Still on step 1: the "Choose file" input is still present.
    expect(screen.getByLabelText("Choose file")).toBeInTheDocument();
  });

  it("shows a commit error on step 3 with grid state intact", async () => {
    commitImport.mockResolvedValue({ ok: false, error: "Server exploded" });

    render(
      <ImportWizard
        destination={{ type: "new", workspaceId: "ws1" }}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    uploadFile();
    await waitFor(() =>
      expect(screen.getByDisplayValue("Name")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /confirm/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(screen.getByText("Server exploded")).toBeInTheDocument(),
    );

    // Grid state intact: still on step 3 with the board name preserved.
    expect(screen.getByDisplayValue("my-board")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("retains per-sheet edits when switching sheets and back (state is not re-derived)", async () => {
    previewImport.mockResolvedValue({
      ok: true,
      data: {
        fileName: "data.xlsx",
        boardName: "my-board",
        sheets: [
          { name: "Sheet1", rowCount: 3, colCount: 2, grid: GRID },
          { name: "Sheet2", rowCount: 3, colCount: 2, grid: GRID },
        ],
      },
    });

    render(
      <ImportWizard
        destination={{ type: "new", workspaceId: "ws1" }}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    uploadFile();

    await waitFor(() =>
      expect(screen.getByDisplayValue("Name")).toBeInTheDocument(),
    );

    // Edit sheet 0's state: rename the "Name" column.
    fireEvent.change(screen.getByDisplayValue("Name"), {
      target: { value: "Task Name" },
    });
    expect(screen.getByDisplayValue("Task Name")).toBeInTheDocument();

    // Switch to sheet 1 — its state lazily derives fresh (untouched "Name").
    fireEvent.click(screen.getByRole("tab", { name: "Sheet2" }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Sheet2" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByDisplayValue("Name")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Task Name")).not.toBeInTheDocument();

    // Switch back to sheet 0 — the edit must have persisted, not re-derived.
    fireEvent.click(screen.getByRole("tab", { name: "Sheet1" }));
    await waitFor(() =>
      expect(screen.getByDisplayValue("Task Name")).toBeInTheDocument(),
    );
  });

  it('does not advance past step 2 when no included column has role "name", and shows the inline hint', async () => {
    render(
      <ImportWizard
        destination={{ type: "new", workspaceId: "ws1" }}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    uploadFile();

    await waitFor(() =>
      expect(screen.getByDisplayValue("Name")).toBeInTheDocument(),
    );

    // Exclude the "Name" column (the only role:"name" column) via its
    // "Include" checkbox.
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Name" }));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Still on step 2: no confirm button reachable, and the inline hint
    // (exact copy from ImportWizard.tsx) is shown.
    expect(
      screen.queryByRole("button", { name: /confirm/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Mark a column as the item name (via its column menu) before continuing.",
    );
  });

  it("resets to step 1 (fresh upload UI, no grid) after closing mid-flow and reopening", async () => {
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <ImportWizard
        destination={{ type: "new", workspaceId: "ws1" }}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    uploadFile();

    await waitFor(() =>
      expect(screen.getByDisplayValue("Name")).toBeInTheDocument(),
    );

    // Close mid-flow (step 2) via the dialog's close button.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <ImportWizard
        destination={{ type: "new", workspaceId: "ws1" }}
        open={false}
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() =>
      expect(screen.queryByDisplayValue("Name")).not.toBeInTheDocument(),
    );

    // Reopen: should be back on step 1, not resuming the old grid.
    rerender(
      <ImportWizard
        destination={{ type: "new", workspaceId: "ws1" }}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Choose file")).toBeInTheDocument(),
    );
    expect(screen.queryByDisplayValue("Name")).not.toBeInTheDocument();
  });
});
