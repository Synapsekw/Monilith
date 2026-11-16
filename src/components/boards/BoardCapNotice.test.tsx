import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardCapNotice } from "@/components/boards/BoardCapNotice";
import type { BoardTruncation } from "@/lib/boards/caps";

const NONE: BoardTruncation = {
  cells: false,
  relationLinks: false,
  linkedItemNames: false,
};

describe("BoardCapNotice", () => {
  it("renders nothing when no read hit a cap", () => {
    render(<BoardCapNotice truncation={NONE} />);
    expect(screen.queryByTestId("board-cap-notice")).toBeNull();
  });

  it("renders nothing for a payload that carries no flags", () => {
    render(<BoardCapNotice truncation={undefined} />);
    expect(screen.queryByTestId("board-cap-notice")).toBeNull();
  });

  it("says the board shows the first 60,000 cells, as a polite status", () => {
    render(<BoardCapNotice truncation={{ ...NONE, cells: true }} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Showing the first 60,000 cells. Some values are not loaded.",
    );
  });

  it("lists every cap that was hit", () => {
    render(
      <BoardCapNotice
        truncation={{ cells: true, relationLinks: true, linkedItemNames: true }}
      />,
    );
    const notice = screen.getByTestId("board-cap-notice");
    expect(notice.querySelectorAll("p")).toHaveLength(3);
    expect(notice.textContent).toContain("2,000 links to other boards");
    expect(notice.textContent).toContain("1,000 linked items");
  });
});
