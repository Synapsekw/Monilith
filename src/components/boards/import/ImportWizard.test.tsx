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
});
