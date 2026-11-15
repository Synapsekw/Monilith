import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { loadGrid } from "@/lib/folders/tower";

vi.mock("next/link", () => ({
  default: ({
    prefetch,
    href,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean; href: string }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest} />
  ),
}));
import { FIXTURE_LOAD_WEEKS } from "@/lib/folders/fixture";
import { LoadPanel } from "./LoadPanel";

const boards = [
  { id: "b1", name: "Backend", position: 0 },
  { id: "b2", name: "Mobile", position: 1 },
];
const f = { stageKey: null, boardId: null };

describe("LoadPanel", () => {
  it("draws the heat map with its key on the server's weeks", () => {
    const grid = loadGrid(
      [
        {
          boardId: "b1",
          stageKey: "build",
          weekStart: "2026-09-14",
          openDue: 3,
        },
      ],
      boards,
      f,
      "2026-09-15",
      FIXTURE_LOAD_WEEKS,
    );
    render(
      <LoadPanel kicker="03" grid={grid} failed={false} onRetry={vi.fn()} />,
    );
    expect(
      screen.getByRole("heading", { name: "Load by board and week" }),
    ).toBeInTheDocument();
    const cell = screen.getByRole("link", {
      name: "Backend, this week: 3 due",
    });
    // No prefetch storm for a grid of board links; a 44px target on touch.
    expect(cell).toHaveAttribute("data-prefetch", "false");
    expect(cell.className).toContain("pointer-coarse:min-h-11");
    expect(
      screen.getByText(/Red: still open from a past week/),
    ).toBeInTheDocument();
  });

  it("says so when nothing is open in the window", () => {
    const grid = loadGrid([], boards, f, "2026-09-15", FIXTURE_LOAD_WEEKS);
    render(
      <LoadPanel kicker="03" grid={grid} failed={false} onRetry={vi.fn()} />,
    );
    expect(
      screen.getByText("Nothing open in this window."),
    ).toBeInTheDocument();
  });

  it("offers Retry when the read failed", () => {
    const onRetry = vi.fn();
    render(<LoadPanel kicker="03" grid={null} failed onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
