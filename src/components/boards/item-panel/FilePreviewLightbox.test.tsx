import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilePreviewLightbox } from "@/components/boards/item-panel/FilePreviewLightbox";
import type { Tables } from "@/types/database.types";

vi.mock("next/dynamic", () => ({
  default: () => (props: { src?: string; attachmentId?: string }) =>
    props.attachmentId ? (
      <div data-testid="sheet-preview" data-id={props.attachmentId} />
    ) : (
      <div data-testid="pdf-preview" data-src={props.src} />
    ),
}));
vi.mock("@/lib/collaboration/actions", () => ({
  getAttachmentPreviewUrl: vi.fn(async () => ({
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

  it("exposes header actions + nav as Button primitives that fire their handlers", () => {
    const onIndexChange = vi.fn();
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    const three = [att("a"), att("b"), att("c")];
    render(
      <FilePreviewLightbox
        attachments={three}
        index={1}
        previewUrls={{ a: "x", b: "y", c: "z" }}
        currentUserId="u"
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
        onDownload={onDownload}
        onDelete={onDelete}
      />,
    );

    const open = screen.getByRole("button", { name: "Open in new tab" });
    const download = screen.getByRole("button", { name: "Download" });
    const del = screen.getByRole("button", { name: "Delete" });
    const prev = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });

    // routed through the Button primitive (data-slot proves the swap)
    for (const el of [open, download, del, prev, next]) {
      expect(el).toHaveAttribute("data-slot", "button");
    }

    // "Open in new tab" opens the signed URL; only "Download" downloads.
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    fireEvent.click(open);
    expect(openSpy).toHaveBeenCalledWith("y", "_blank", "noopener");
    expect(onDownload).not.toHaveBeenCalled();
    fireEvent.click(download);
    expect(onDownload).toHaveBeenCalledTimes(1);
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledWith(three[1]);
    fireEvent.click(prev);
    expect(onIndexChange).toHaveBeenCalledWith(0);
    fireEvent.click(next);
    expect(onIndexChange).toHaveBeenCalledWith(2);
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
    const { getAttachmentPreviewUrl } =
      await import("@/lib/collaboration/actions");
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
    expect(getAttachmentPreviewUrl).toHaveBeenCalledWith({ attachmentId: "p" });
  });

  it("signs bytes and mounts a renderer for a .docx attachment", async () => {
    const { getAttachmentPreviewUrl } =
      await import("@/lib/collaboration/actions");
    const docx = [
      att("d", {
        mime_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_name: "d.docx",
      }),
    ];
    render(
      <FilePreviewLightbox
        attachments={docx}
        index={0}
        previewUrls={{}}
        currentUserId="u"
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await screen.findByTestId("pdf-preview");
    expect(getAttachmentPreviewUrl).toHaveBeenCalledWith({ attachmentId: "d" });
    expect(screen.queryByText(/No inline preview/i)).not.toBeInTheDocument();
  });

  it("mounts the sheet viewer for a spreadsheet without signing a URL", async () => {
    const { getAttachmentPreviewUrl } =
      await import("@/lib/collaboration/actions");
    vi.mocked(getAttachmentPreviewUrl).mockClear();
    const xlsx = [att("s", { mime_type: "text/csv", file_name: "rows.csv" })];
    render(
      <FilePreviewLightbox
        attachments={xlsx}
        index={0}
        previewUrls={{}}
        currentUserId="u"
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const node = await screen.findByTestId("sheet-preview");
    expect(node).toHaveAttribute("data-id", "s");
    // Sheets are parsed server-side — no signed URL is handed to the client.
    expect(getAttachmentPreviewUrl).not.toHaveBeenCalled();
  });

  it("opens at the kind preset and refines to the image's measured aspect", async () => {
    render(
      <FilePreviewLightbox
        attachments={[att("a")]}
        index={0}
        previewUrls={{ a: "https://signed/a" }}
        currentUserId="u"
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const panel = screen.getByRole("dialog");
    // image preset — no aspect term until the bitmap reports one
    expect(panel.style.getPropertyValue("--preview-w")).toBe(
      "min(92vw, 1100px)",
    );

    // The dialog renders through a portal, so query the screen, not `container`.
    const img = screen.getByAltText("a.png") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 1600 });
    Object.defineProperty(img, "naturalHeight", { value: 900 });
    fireEvent.load(img);

    expect(panel.style.getPropertyValue("--preview-w")).toBe(
      "min(92vw, calc(90vh * 1.778), 1100px)",
    );
  });

  it("opens a deck at the 16:9 preset even though it cannot render", () => {
    const deck = [
      att("k", {
        mime_type: "application/vnd.ms-powerpoint",
        file_name: "q3.pptx",
      }),
    ];
    render(
      <FilePreviewLightbox
        attachments={deck}
        index={0}
        previewUrls={{}}
        currentUserId="u"
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("dialog").style.getPropertyValue("--preview-w"),
    ).toBe("min(92vw, calc(90vh * 1.778), 1200px)");
    expect(screen.getByText("PPT")).toBeInTheDocument();
  });

  it("gives an unpreviewable archive a small card, not a huge empty frame", () => {
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
    expect(
      screen.getByRole("dialog").style.getPropertyValue("--preview-w"),
    ).toBe("min(92vw, 520px)");
  });
});
