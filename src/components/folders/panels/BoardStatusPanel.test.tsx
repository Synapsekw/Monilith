import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BoardSummary } from "@/lib/folders/rollup";
import { BoardStatusPanel } from "./BoardStatusPanel";

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
    fireEvent.click(screen.getByRole("radio", { name: "Size" }));
    expect(names()).toEqual(["Mid", "Zeta", "Alpha"]);
    fireEvent.click(screen.getByRole("radio", { name: "A–Z" }));
    expect(names()).toEqual(["Alpha", "Mid", "Zeta"]);
    expect(screen.getByRole("radio", { name: "A–Z" })).toHaveAttribute(
      "aria-checked",
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
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
