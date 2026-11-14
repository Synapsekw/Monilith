import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
import { attentionGroups } from "@/lib/folders/tower";
import { AttentionPanel } from "./AttentionPanel";

const fx = folderFixture();
const groups = attentionGroups(fx.rollup!, fx.attention!, FIXTURE_TODAY);

describe("AttentionPanel grouped", () => {
  it("shows one row per board with its counts and keeps items collapsed", () => {
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={groups}
        onRetry={vi.fn()}
      />,
    );
    const first = screen.getAllByTestId("attention-group")[0]!;
    expect(within(first).getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(first).getByRole("button")).toHaveTextContent(
      groups[0]!.boardName,
    );
    expect(screen.queryByRole("link", { name: /Auth refactor/ })).toBeNull();
  });

  it("expands a board in place to its items, linking to the board item", () => {
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={groups}
        onRetry={vi.fn()}
      />,
    );
    const backend = screen
      .getAllByTestId("attention-group")
      .find((g) =>
        within(g).getByRole("button").textContent?.includes("Backend"),
      )!;
    fireEvent.click(within(backend).getByRole("button"));
    expect(within(backend).getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      within(backend).getByRole("link", { name: /Auth refactor/ }),
    ).toHaveAttribute("href", "/boards/b1?item=i1");
  });

  it("says when the list is a sample of a larger total", () => {
    const big = [
      { ...groups[0]!, overdue: 140, items: groups[0]!.items.slice(0, 1) },
    ];
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={big}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Showing 1\./)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the board for all 140 overdue." }),
    ).toHaveAttribute("href", `/boards/${groups[0]!.boardId}`);
  });

  it("keeps the flat list when no groups are given, and the empty and failed states", () => {
    const { rerender } = render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption="Top 4 across the folder"
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Auth refactor/ }),
    ).toBeInTheDocument();
    rerender(
      <AttentionPanel
        kicker="06"
        attention={[]}
        caption={null}
        groups={[]}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("Nothing needs attention.")).toBeInTheDocument();
    rerender(
      <AttentionPanel
        kicker="06"
        attention={null}
        caption={null}
        groups={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
