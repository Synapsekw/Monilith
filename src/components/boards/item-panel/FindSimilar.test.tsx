import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FindSimilar } from "./FindSimilar";
import { findSimilarItems } from "@/lib/ai/embeddings/search";

vi.mock("@/lib/ai/embeddings/search", () => ({
  findSimilarItems: vi.fn(),
}));

const mockFindSimilar = vi.mocked(findSimilarItems);

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FindSimilar", () => {
  it("does not fetch on mount — the server round-trip is click-only (perf budget)", () => {
    render(<FindSimilar itemId={ITEM_ID} />);
    expect(mockFindSimilar).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /find similar/i }),
    ).toBeInTheDocument();
  });

  it("fetches on click and renders ranked hits as board-item deep links", async () => {
    mockFindSimilar.mockResolvedValue({
      status: "ok",
      items: [
        {
          id: "i2",
          name: "New-hire checklist",
          boardId: "b9",
          boardName: "HR",
        },
      ],
    });

    render(<FindSimilar itemId={ITEM_ID} />);
    await userEvent.click(
      screen.getByRole("button", { name: /find similar/i }),
    );

    expect(mockFindSimilar).toHaveBeenCalledWith(ITEM_ID);
    const link = await screen.findByRole("link", {
      name: /new-hire checklist/i,
    });
    expect(link).toHaveAttribute("href", "/boards/b9?item=i2");
    expect(screen.getByText("HR")).toBeInTheDocument();
  });

  it("shows an indexing state when the item has no embedding yet", async () => {
    mockFindSimilar.mockResolvedValue({ status: "not_indexed" });

    render(<FindSimilar itemId={ITEM_ID} />);
    await userEvent.click(
      screen.getByRole("button", { name: /find similar/i }),
    );

    expect(await screen.findByText(/still being indexed/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no similar items", async () => {
    mockFindSimilar.mockResolvedValue({ status: "ok", items: [] });

    render(<FindSimilar itemId={ITEM_ID} />);
    await userEvent.click(
      screen.getByRole("button", { name: /find similar/i }),
    );

    expect(await screen.findByText(/no similar items/i)).toBeInTheDocument();
  });
});
