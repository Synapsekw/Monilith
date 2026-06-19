import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilesCell } from "@/components/boards/cells/FilesCell";
import type { Tables } from "@/types/database.types";

function att(
  id: string,
  over: Partial<Tables<"attachments">> = {},
): Tables<"attachments"> {
  return {
    id,
    org_id: "o",
    board_id: "b",
    item_id: "i",
    column_id: "c",
    update_id: null,
    uploaded_by: "u",
    storage_path: `o/b/i/c/${id}-x.png`,
    file_name: "report.png",
    mime_type: "image/png",
    size_bytes: 2048,
    created_at: "2026-06-17T00:00:00Z",
    ...over,
  } as Tables<"attachments">;
}

describe("FilesCell", () => {
  it("shows the first three files, an overflow badge, and reports the count", () => {
    const files = [att("1"), att("2"), att("3"), att("4")];
    render(
      <FilesCell
        files={files}
        previewUrls={{}}
        onOpen={vi.fn()}
        onUpload={vi.fn()}
      />,
    );

    // aria-label reports the full count.
    expect(screen.getByLabelText("4 files")).toBeInTheDocument();
    // Three thumbnail buttons (titled with the file name) are shown.
    expect(screen.getAllByTitle("report.png")).toHaveLength(3);
    // The fourth file collapses into a "+1" overflow badge.
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("opens the file at the clicked index", () => {
    const onOpen = vi.fn();
    const files = [att("1"), att("2")];
    render(
      <FilesCell
        files={files}
        previewUrls={{}}
        onOpen={onOpen}
        onUpload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByTitle("report.png")[1]);
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("renders an Add file affordance and no overflow when empty", () => {
    render(
      <FilesCell
        files={[]}
        previewUrls={{}}
        onOpen={vi.fn()}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Add file")).toBeInTheDocument();
    expect(screen.getByLabelText("0 files")).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });
});
