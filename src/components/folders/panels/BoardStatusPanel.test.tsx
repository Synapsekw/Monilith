import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BoardSummary } from "@/lib/folders/rollup";
import { BoardStatusPanel, sortBoardStatus } from "./BoardStatusPanel";

const b = (
  o: Partial<BoardSummary> &
    Pick<BoardSummary, "id" | "name" | "health" | "total">,
): BoardSummary => ({
  done: 0,
  inProgress: 0,
  overdue: 0,
  notStarted: 0,
  stale: 0,
  donePct: 0,
  nextMilestone: null,
  ...o,
});
const boards = [
  b({ id: "b1", name: "Zeta", health: "on_track", total: 50 }),
  b({ id: "b2", name: "Alpha", health: "off_track", total: 10, overdue: 6 }),
  b({ id: "b3", name: "Mid", health: "at_risk", total: 90, overdue: 2 }),
];
const names = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("BoardStatusPanel", () => {
  it("opens worst first with a health pill and a legend", () => {
    render(
      <BoardStatusPanel
        kicker="04"
        boards={boards}
        failed={false}
        onRetry={vi.fn()}
      />,
    );
    expect(names()).toEqual(["Alpha", "Mid", "Zeta"]);
    expect(screen.getByText("Off track")).toBeInTheDocument();
    for (const label of ["Done", "In progress", "Overdue", "Not started"])
      expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("re-sorts on the client by size and by name", () => {
    render(
      <BoardStatusPanel
        kicker="04"
        boards={boards}
        failed={false}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(names()).toEqual(["Mid", "Zeta", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "A–Z" }));
    expect(names()).toEqual(["Alpha", "Mid", "Zeta"]);
    expect(screen.getByRole("button", { name: "A–Z" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("hides the sort control for a single board", () => {
    render(
      <BoardStatusPanel
        kicker="04"
        boards={[boards[0]!]}
        failed={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole("group", { name: "Sort boards" })).toBeNull();
  });

  it("can be operated from the keyboard and reports the pressed sort", async () => {
    const user = userEvent.setup();
    render(
      <BoardStatusPanel
        kicker="04"
        boards={boards}
        failed={false}
        onRetry={vi.fn()}
      />,
    );
    const health = screen.getByRole("button", { name: "Health" });
    const size = screen.getByRole("button", { name: "Size" });
    expect(health).toHaveAttribute("aria-pressed", "true");
    expect(size).toHaveAttribute("aria-pressed", "false");
    await user.tab();
    // Every sort button is a tab stop; Enter and Space both press it.
    const stops = [health, size, screen.getByRole("button", { name: "A–Z" })];
    let reached = 0;
    for (let i = 0; i < 12 && reached < 3; i++) {
      if (stops.includes(document.activeElement as HTMLElement)) reached++;
      if (reached < 3) await user.tab();
    }
    expect(reached).toBe(3);
    size.focus();
    await user.keyboard("{Enter}");
    expect(size).toHaveAttribute("aria-pressed", "true");
    expect(health).toHaveAttribute("aria-pressed", "false");
    expect(names()).toEqual(["Mid", "Zeta", "Alpha"]);
    screen.getByRole("button", { name: "A–Z" }).focus();
    await user.keyboard(" ");
    expect(names()).toEqual(["Alpha", "Mid", "Zeta"]);
  });
});

describe("sortBoardStatus health order", () => {
  it("breaks a health tie by more overdue first, then by name", () => {
    const tied = [
      b({ id: "1", name: "Beta", health: "at_risk", total: 5, overdue: 1 }),
      b({ id: "2", name: "Delta", health: "at_risk", total: 5, overdue: 4 }),
      b({ id: "3", name: "Alpha", health: "at_risk", total: 5, overdue: 1 }),
      b({ id: "4", name: "Gamma", health: "on_track", total: 5, overdue: 9 }),
    ];
    expect(sortBoardStatus(tied, "health").map((x) => x.name)).toEqual([
      "Delta",
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });
});
