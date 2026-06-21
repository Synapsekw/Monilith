import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilePreviewLightbox } from "@/components/boards/item-panel/FilePreviewLightbox";
import type { Tables } from "@/types/database.types";

vi.mock("next/dynamic", () => ({
  default: () => (props: { src: string }) => (
    <div data-testid="pdf-preview" data-src={props.src} />
  ),
}));
vi.mock("@/lib/collaboration/actions", () => ({
  getAttachmentPdfUrl: vi.fn(async () => ({
    ok: true,
    data: { url: "https://signed/pdf" },
  })),
}));

function att(
  id: string,
  over: Partial<Tables<"attachments">> = {},
): Tables<"attachments"> {
  return {
    id,
    org_id: "o",
    board_id: "b",
    item_id: "i",
    update_id: null,
    uploaded_by: "u",
    storage_path: `o/b/i/${id}-x.png`,
    file_name: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 2048,
    created_at: "2026-06-17T00:00:00Z",
    ...over,
  } as Tables<"attachments">;
}

describe("FilePreviewLightbox", () => {
  const files = [att("a"), att("b")];
  const urls = { a: "https://signed/a", b: "https://signed/b" };

  it("navigates with ArrowRight/ArrowLeft and closes on Escape", () => {
    const onIndexChange = vi.fn();
    const onClose = vi.fn();
    render(
      <FilePreviewLightbox
        attachments={files}
        index={0}
        previewUrls={urls}
        currentUserId="u"
        onIndexChange={onIndexChange}
        onClose={onClose}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenCalledWith(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders a Download fallback for a non-previewable file", () => {
    const zip = [
      att("z", { mime_type: "application/zip", file_name: "z.zip" }),
    ];
    render(
      <FilePreviewLightbox
        attachments={zip}
        index={0}
        previewUrls={{}}
        currentUserId="u"
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/No inline preview/i)).toBeInTheDocument();
  });

  it("renders the PDF preview branch for a pdf attachment", async () => {
    const { getAttachmentPdfUrl } = await import("@/lib/collaboration/actions");
    const pdf = [
      att("p", { mime_type: "application/pdf", file_name: "p.pdf" }),
    ];
    render(
      <FilePreviewLightbox
        attachments={pdf}
        index={0}
        previewUrls={{}}
        currentUserId="u"
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const node = await screen.findByTestId("pdf-preview");
    expect(node).toHaveAttribute("data-src", "https://signed/pdf");
    expect(getAttachmentPdfUrl).toHaveBeenCalledWith({ attachmentId: "p" });
  });
});
