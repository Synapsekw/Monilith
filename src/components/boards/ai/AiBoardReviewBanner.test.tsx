import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiBoardReviewBanner } from "./AiBoardReviewBanner";
import { deleteBoard } from "@/lib/boards/actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/boards/actions", () => ({
  deleteBoard: vi.fn(),
}));

const mockDelete = vi.mocked(deleteBoard);

beforeEach(() => {
  vi.clearAllMocks();
  mockDelete.mockResolvedValue({ ok: true, data: undefined });
  window.history.replaceState(null, "", "/boards/b1?review=1");
});

describe("AiBoardReviewBanner", () => {
  it("Keep drops ?review=1 via replaceState and hides the banner", async () => {
    const user = userEvent.setup();
    render(<AiBoardReviewBanner boardId="b1" />);
    await user.click(screen.getByRole("button", { name: /keep this board/i }));
    expect(window.location.search).toBe("");
    expect(
      screen.queryByRole("button", { name: /keep this board/i }),
    ).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("Discard deletes the board and routes to /boards", async () => {
    const user = userEvent.setup();
    render(<AiBoardReviewBanner boardId="b1" />);
    await user.click(
      screen.getByRole("button", { name: /discard this board/i }),
    );
    expect(mockDelete).toHaveBeenCalledWith({ boardId: "b1" });
    expect(push).toHaveBeenCalledWith("/boards");
  });

  it("Regenerate deletes the board and routes to /boards?ai=1", async () => {
    const user = userEvent.setup();
    render(<AiBoardReviewBanner boardId="b1" />);
    await user.click(
      screen.getByRole("button", { name: /regenerate board with ai/i }),
    );
    expect(mockDelete).toHaveBeenCalledWith({ boardId: "b1" });
    expect(push).toHaveBeenCalledWith("/boards?ai=1");
  });

  it("surfaces a delete failure in an alert", async () => {
    mockDelete.mockResolvedValue({ ok: false, error: "Only the owner." });
    const user = userEvent.setup();
    render(<AiBoardReviewBanner boardId="b1" />);
    await user.click(
      screen.getByRole("button", { name: /discard this board/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the owner.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
