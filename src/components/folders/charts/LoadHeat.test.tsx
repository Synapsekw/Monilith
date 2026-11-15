import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loadGrid } from "@/lib/folders/tower";
import { LoadPanel } from "@/components/folders/panels/LoadPanel";
import { LoadHeat } from "./LoadHeat";

const boards = [
  { id: "b1", name: "Backend", position: 0 },
  { id: "b2", name: "Mobile", position: 1 },
];
const grid = loadGrid(
  [
    { boardId: "b1", stageKey: "build", weekStart: "2026-08-24", openDue: 7 },
    { boardId: "b1", stageKey: "build", weekStart: "2026-09-14", openDue: 3 },
    { boardId: "b2", stageKey: "build", weekStart: "2026-10-05", openDue: 4 },
  ],
  boards,
  { stageKey: null, boardId: null },
  "2026-09-15",
);

describe("LoadHeat", () => {
  it("renders a labelled table with one row per board and seven week columns", () => {
    render(<LoadHeat grid={grid} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(8);
    expect(
      screen.getByRole("rowheader", { name: "Backend" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("links a filled cell to its board and describes it in words", () => {
    render(<LoadHeat grid={grid} />);
    const cell = screen.getByRole("link", {
      name: "Backend, before 2026-08-31: 7 still open",
    });
    expect(cell).toHaveAttribute(
      "title",
      "Backend, before 2026-08-31: 7 still open",
    );
    expect(cell).toHaveAttribute("href", "/boards/b1");
    expect(cell).toHaveAttribute("data-tone", "late");
    expect(
      screen.getByRole("link", { name: "Mobile, in 3 weeks: 4 due" }),
    ).toHaveAttribute("data-tone", "ahead");
    expect(
      screen.getByRole("link", { name: "Backend, this week: 3 due" }),
    ).toHaveAttribute("data-tone", "ahead");
  });

  it("draws an empty cell as a dot with no link, named in words", () => {
    render(<LoadHeat grid={grid} />);
    expect(screen.getAllByText("·").length).toBe(14 - 3);
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByText("Backend, last week: none open")).toHaveClass(
      "sr-only",
    );
    expect(screen.getAllByText(/: none open$/)).toHaveLength(11);
  });

  it("only the first column is described as before a date", () => {
    render(<LoadHeat grid={grid} />);
    expect(
      screen.getByText("Mobile, before 2026-08-31: none open"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Backend, this week/ }),
    ).toHaveAttribute("title", "Backend, week of 2026-09-14: 3 due");
  });

  it("tints the largest cell more strongly than a smaller one", () => {
    render(<LoadHeat grid={grid} />);
    const pct = (name: RegExp) =>
      Number(
        /(\d+)%/.exec(
          screen.getByRole("link", { name }).getAttribute("style") ?? "",
        )?.[1],
      );
    expect(pct(/7 still open/)).toBeGreaterThan(pct(/3 due/));
  });

  it("renders an all-zero grid without NaN or links", () => {
    const zero = {
      ...grid,
      max: 0,
      rows: grid.rows.map((r) => ({ ...r, cells: r.cells.map(() => 0) })),
    };
    const { container } = render(<LoadHeat grid={zero} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("NaN");
    expect(screen.getAllByText("·")).toHaveLength(14);
  });
});

describe("LoadPanel", () => {
  it("shows the retry state when the read failed and nothing when there is no load", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <LoadPanel kicker="03" grid={null} failed onRetry={onRetry} />,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    rerender(
      <LoadPanel
        kicker="03"
        grid={{
          ...grid,
          max: 0,
          rows: grid.rows.map((r) => ({ ...r, cells: r.cells.map(() => 0) })),
        }}
        failed={false}
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByText("Nothing open in this window."),
    ).toBeInTheDocument();
  });

  it("prints a legend under the grid so colour is never the only signal", () => {
    render(
      <LoadPanel kicker="03" grid={grid} failed={false} onRetry={vi.fn()} />,
    );
    expect(
      screen.getByText(/still open from a past week/i),
    ).toBeInTheDocument();
  });
});
