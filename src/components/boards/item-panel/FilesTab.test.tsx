import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilesTab } from "@/components/boards/item-panel/FilesTab";
import type { AttachmentsCache } from "@/lib/collaboration/attachments-cache";
import type { Tables } from "@/types/database.types";

vi.mock("@/lib/collaboration/actions", () => ({
  getAttachmentDownloadUrl: vi.fn().mockResolvedValue({
    ok: true,
    data: { url: "https://signed/x" },
  }),
}));

const members = [{ userId: "u", fullName: "Ada" }];

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
    file_name: "report.png",
    mime_type: "image/png",
    size_bytes: 2048,
    created_at: "2026-06-17T00:00:00Z",
    ...over,
  } as Tables<"attachments">;
}

const base = {
  previewUrls: {} as Record<string, string>,
  members,
  currentUserId: "u", // att() default uploaded_by is "u" → Delete affordance shown
  isUploading: false,
  uploadError: null,
  onUpload: vi.fn(),
  onDelete: vi.fn(),
};

describe("FilesTab", () => {
  it("renders the empty state when there are no files", () => {
    render(<FilesTab cache={{ attachments: [] }} {...base} />);
    expect(screen.getByText(/No files yet/i)).toBeInTheDocument();
  });

  it("dropzone ring is transitioned, not popped", () => {
    render(<FilesTab cache={{ attachments: [] }} {...base} />);
    const zone = document.querySelector(".ring-2");
    expect(zone).toBeTruthy();
    expect(zone!.className).toContain("ring-transparent");
    expect(zone!.className).toContain("transition-shadow");
  });

  it("empty state uses the standardized inline EmptyState", () => {
    render(<FilesTab cache={{ attachments: [] }} {...base} />);
    const empty = screen.getByText(/No files yet/i);
    expect(empty.className).toContain("py-8");
    expect(empty.className).toContain("text-muted-foreground");
  });

  it("renders gallery cards with name + size", () => {
    const cache: AttachmentsCache = { attachments: [att("a")] };
    render(<FilesTab cache={cache} {...base} />);
    expect(screen.getByText("report.png")).toBeInTheDocument();
    // Card shows "<size> · <uploader>"; scope to that to avoid matching the
    // toolbar's total-size text which also renders "2 KB".
    expect(screen.getByText(/2 KB · Ada/)).toBeInTheDocument();
  });

  it("toggles to list view", () => {
    const cache: AttachmentsCache = { attachments: [att("a")] };
    render(<FilesTab cache={cache} {...base} />);
    fireEvent.click(screen.getByLabelText("List view"));
    expect(screen.getByLabelText("List view")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("exposes the view toggle as Button primitives with aria-pressed and swaps card↔row", () => {
    const cache: AttachmentsCache = { attachments: [att("a")] };
    render(<FilesTab cache={cache} {...base} />);
    const gallery = screen.getByLabelText("Gallery view");
    const list = screen.getByLabelText("List view");
    // routed through the Button primitive
    expect(gallery).toHaveAttribute("data-slot", "button");
    expect(list).toHaveAttribute("data-slot", "button");
    // segmented-control state
    expect(gallery).toHaveAttribute("aria-pressed", "true");
    expect(list).toHaveAttribute("aria-pressed", "false");

    // Gallery view shows the card overlay (a Download action button)
    expect(
      screen.getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();

    // Switching to list keeps a Download action and flips pressed state
    fireEvent.click(list);
    expect(screen.getByLabelText("Gallery view")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("List view")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Download" }),
    ).toBeInTheDocument();
  });

  it("shows the uploading state for an optimistic card", () => {
    const cache: AttachmentsCache = { attachments: [att("optimistic-1")] };
    render(<FilesTab cache={cache} {...base} />);
    expect(screen.getByText(/Uploading/i)).toBeInTheDocument();
  });

  it("surfaces an upload error inline", () => {
    render(
      <FilesTab
        cache={{ attachments: [] }}
        {...base}
        uploadError="File exceeds 50 MB."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("File exceeds 50 MB.");
  });
});
