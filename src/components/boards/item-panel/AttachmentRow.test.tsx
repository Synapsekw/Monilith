import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttachmentRow } from "./AttachmentRow";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import type { Attachment } from "@/lib/collaboration/attachments-cache";

vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(useCoarsePointer).mockReset();
});

function att(over: Partial<Attachment> = {}): Attachment {
  return {
    id: "a",
    org_id: "o",
    board_id: "b",
    item_id: "i",
    update_id: null,
    uploaded_by: "u",
    storage_path: "o/b/i/a-d.png",
    file_name: "doc.png",
    mime_type: "image/png",
    size_bytes: 2048,
    created_at: "2026-06-20T00:00:00Z",
    ...over,
  } as Attachment;
}

describe("AttachmentRow actions", () => {
  it("renders Preview/Download/Delete by aria-label", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(true);
    render(
      <AttachmentRow
        attachment={att()}
        members={[]}
        canDelete
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hides Preview for a non-previewable type (zip)", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(true);
    render(
      <AttachmentRow
        attachment={att({ mime_type: "application/zip", file_name: "a.zip" })}
        members={[]}
        canDelete
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
  });
});

describe("AttachmentRow touch reveal", () => {
  it("shows the action cluster always-on for a coarse pointer", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(true);
    render(
      <AttachmentRow
        attachment={att()}
        members={[]}
        canDelete
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const cluster = screen
      .getByRole("button", { name: "Download" })
      .closest('[data-slot="reveal-on-hover"]') as HTMLElement;
    expect(cluster.className).toContain("opacity-100");
    expect(cluster.className).not.toContain("group-hover");
  });

  it("hover-gates the action cluster for a fine pointer", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(false);
    render(
      <AttachmentRow
        attachment={att()}
        members={[]}
        canDelete
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const cluster = screen
      .getByRole("button", { name: "Download" })
      .closest('[data-slot="reveal-on-hover"]') as HTMLElement;
    expect(cluster.className).toContain("opacity-0");
    expect(cluster.className).toContain("group-hover:opacity-100");
  });
});
