import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttachmentCard } from "./AttachmentCard";
import type { Attachment } from "@/lib/collaboration/attachments-cache";

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
