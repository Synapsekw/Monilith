import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttachmentCard } from "./AttachmentCard";
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
    storage_path: "o/b/i/a-d.pdf",
    file_name: "doc.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    created_at: "2026-06-20T00:00:00Z",
    ...over,
  } as Attachment;
}

describe("AttachmentCard preview affordance", () => {
  it("shows Preview for a PDF attachment", () => {
    render(
      <AttachmentCard
        attachment={att()}
        members={[]}
        canDelete={false}
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
  });

  it("hides Preview for a non-previewable type (zip)", () => {
    render(
      <AttachmentCard
        attachment={att({ mime_type: "application/zip", file_name: "a.zip" })}
        members={[]}
        canDelete={false}
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
  });
});

describe("AttachmentCard touch reveal", () => {
  it("shows the action overlay always-on for a coarse pointer", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(true);
    render(
      <AttachmentCard
        attachment={att({ mime_type: "image/png", file_name: "a.png" })}
        members={[]}
        canDelete
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const overlay = screen
      .getByRole("button", { name: "Download" })
      .closest('[data-slot="reveal-on-hover"]') as HTMLElement;
    expect(overlay.className).toContain("opacity-100");
    expect(overlay.className).not.toContain("group-hover");
    // overlay keeps its scrim so the thumbnail dims behind the controls
    expect(overlay.className).toContain("bg-background/70");
    // all three actions resolve by aria-label
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hover-gates the overlay for a fine pointer", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(false);
    render(
      <AttachmentCard
        attachment={att({ mime_type: "image/png", file_name: "a.png" })}
        members={[]}
        canDelete
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const overlay = screen
      .getByRole("button", { name: "Download" })
      .closest('[data-slot="reveal-on-hover"]') as HTMLElement;
    expect(overlay.className).toContain("opacity-0");
    expect(overlay.className).toContain("group-hover:opacity-100");
  });
});
