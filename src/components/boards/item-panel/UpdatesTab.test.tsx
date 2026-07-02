import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpdatesTab } from "./UpdatesTab";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";
import type { UpdatesCache } from "@/lib/collaboration/cache";

vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(useCoarsePointer).mockReset();
});

const cache: UpdatesCache = {
  updates: [
    {
      id: "u1",
      org_id: "o1",
      board_id: "b1",
      item_id: "i1",
      author_id: "user-1",
      body: { text: "Shipped it", mentions: [] },
      body_text: "Shipped it",
      edited_at: null,
      created_at: "2026-06-21T15:45:00Z",
      updated_at: "2026-06-21T15:45:00Z",
    },
  ],
};

const members = [{ userId: "user-1", fullName: "Ada Lovelace" }];

describe("UpdatesTab", () => {
  it("renders the author name and a formatted timestamp", () => {
    render(
      <TimeZoneProvider timeZone="UTC">
        <UpdatesTab
          cache={cache}
          members={members}
          onAdd={vi.fn()}
          onDelete={vi.fn()}
        />
      </TimeZoneProvider>,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Shipped it/)).toBeInTheDocument();
  });

  it("reveals the per-update delete always-on for a coarse pointer and fires onDelete", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(true);
    const onDelete = vi.fn();
    render(
      <TimeZoneProvider timeZone="UTC">
        <UpdatesTab
          cache={cache}
          members={members}
          onAdd={vi.fn()}
          onDelete={onDelete}
        />
      </TimeZoneProvider>,
    );
    const del = screen.getByRole("button", { name: "Delete update" });
    const reveal = del.closest('[data-slot="reveal-on-hover"]') as HTMLElement;
    expect(reveal.className).toContain("opacity-100");
    expect(reveal.className).not.toContain("group-hover");
    expect(reveal.className).not.toContain("opacity-60");
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledWith("u1");
  });

  it("hover-gates the per-update delete for a fine pointer", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(false);
    render(
      <TimeZoneProvider timeZone="UTC">
        <UpdatesTab
          cache={cache}
          members={members}
          onAdd={vi.fn()}
          onDelete={vi.fn()}
        />
      </TimeZoneProvider>,
    );
    const reveal = screen
      .getByRole("button", { name: "Delete update" })
      .closest('[data-slot="reveal-on-hover"]') as HTMLElement;
    expect(reveal.className).toContain("opacity-0");
    expect(reveal.className).toContain("group-hover:opacity-100");
  });
});
