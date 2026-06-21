import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpdatesTab } from "./UpdatesTab";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";
import type { UpdatesCache } from "@/lib/collaboration/cache";

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
});
