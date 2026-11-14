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

  const row = (
    i: number,
    boardId: string,
    reason: "overdue" | "blocked" | "unassigned" | "stale",
  ) => ({
    itemId: `${boardId}-${reason}-${i}`,
    itemName: `Item ${boardId} ${reason} ${i}`,
    boardId,
    boardName: boardId,
    groupId: null,
    groupName: null,
    reason,
    ageDays: i,
    severity: 1,
  });
  const base = {
    unassigned: 0,
    stale: 0,
    oldestOverdueDays: null,
  };

  it("says how many overdue are shown when the overdue list is cut", () => {
    const cut = [
      {
        ...base,
        boardId: "b9",
        boardName: "Big",
        overdue: 140,
        blocked: 0,
        items: Array.from({ length: 20 }, (_, i) => row(i, "b9", "overdue")),
      },
    ];
    render(
      <AttentionPanel
        kicker="06"
        attention={[]}
        caption={null}
        groups={cut}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Big/ }));
    const note = screen.getByTestId("attention-cut");
    expect(note.textContent).toBe(
      "Showing 20 of 140 overdue. Open the board for all.",
    );
    expect(
      within(note).getByRole("link", { name: "Open the board for all." }),
    ).toHaveAttribute("href", "/boards/b9");
  });

  it("also says so when the blocked list is cut but overdue is complete", () => {
    const cut = [
      {
        ...base,
        boardId: "b8",
        boardName: "Ops",
        overdue: 2,
        blocked: 12,
        items: [
          row(1, "b8", "overdue"),
          row(2, "b8", "overdue"),
          ...Array.from({ length: 5 }, (_, i) => row(i, "b8", "blocked")),
        ],
      },
    ];
    render(
      <AttentionPanel
        kicker="06"
        attention={[]}
        caption={null}
        groups={cut}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ops/ }));
    expect(screen.getByTestId("attention-cut").textContent).toBe(
      "Showing 5 of 12 blocked. Open the board for all.",
    );
  });

  it("shows no notice when every counted item is listed", () => {
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={[
          {
            ...base,
            boardId: "b7",
            boardName: "Whole",
            overdue: 2,
            blocked: 1,
            items: [
              row(1, "b7", "overdue"),
              row(2, "b7", "overdue"),
              row(3, "b7", "blocked"),
            ],
          },
        ]}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Whole/ }));
    expect(screen.queryByTestId("attention-cut")).toBeNull();
  });

  it("prints each board's counts and oldest overdue exactly as the group has them", () => {
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={groups}
        onRetry={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId("attention-group");
    expect(rows).toHaveLength(groups.length);
    groups.forEach((g, i) => {
      const text = within(rows[i]!).getByRole("button").textContent ?? "";
      expect(text).toContain(g.boardName);
      for (const k of ["overdue", "blocked", "unassigned", "stale"] as const)
        if (g[k] > 0) expect(text).toContain(`${g[k]} ${k}`);
        else expect(text).not.toContain(` ${k}`);
      if (g.oldestOverdueDays !== null)
        expect(text).toContain(`oldest ${g.oldestOverdueDays}d`);
      else expect(text).not.toContain("oldest");
    });
  });

  it("expanding one board never shows another board's items", () => {
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={groups}
        onRetry={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId("attention-group");
    const backend = rows.find((g) =>
      within(g).getByRole("button").textContent?.includes("Backend"),
    )!;
    fireEvent.click(within(backend).getByRole("button"));
    expect(
      screen.getAllByRole("link", { name: /Auth refactor|Push/ }),
    ).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Onboarding flow/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Crash reporting/ })).toBeNull();
  });

  it("always points aria-controls at an element that exists", () => {
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={groups}
        onRetry={vi.fn()}
      />,
    );
    for (const btn of screen.getAllByRole("button")) {
      const target = document.getElementById(
        btn.getAttribute("aria-controls") ?? "",
      );
      expect(target).not.toBeNull();
      expect(target).toHaveAttribute("hidden");
    }
    const first = screen.getAllByRole("button")[0]!;
    fireEvent.click(first);
    expect(
      document.getElementById(first.getAttribute("aria-controls")!),
    ).not.toHaveAttribute("hidden");
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
