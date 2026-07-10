import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyWorkList } from "./MyWorkList";
import { bucketMyWork, type MyWorkItem } from "@/lib/my-work/bucket";

// next/link needs the App Router context, which jsdom lacks. Render a plain
// anchor so we can assert the deep-link href.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const today = "2026-07-04";

function item(partial: Partial<MyWorkItem> & { itemId: string }): MyWorkItem {
  return {
    itemName: partial.itemId,
    boardId: "board-1",
    boardName: "Roadmap",
    groupName: null,
    status: null,
    dueDate: null,
    ...partial,
  };
}

describe("MyWorkList", () => {
  it("renders the empty state when nothing is assigned", () => {
    render(<MyWorkList groups={[]} today={today} />);
    expect(screen.getByText("Nothing assigned to you yet")).toBeInTheDocument();
  });

  it("renders bucket headings for the assigned items", () => {
    const groups = bucketMyWork(
      [
        item({ itemId: "a", dueDate: "2026-07-01" }), // overdue
        item({ itemId: "b" }), // no date
      ],
      today,
    );
    render(<MyWorkList groups={groups} today={today} />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("No date")).toBeInTheDocument();
  });

  it("deep-links each row to the item on its board", () => {
    const groups = bucketMyWork(
      [item({ itemId: "item-9", itemName: "Ship it", boardId: "board-7" })],
      today,
    );
    render(<MyWorkList groups={groups} today={today} />);
    const link = screen.getByRole("link", { name: /ship it/i });
    expect(link).toHaveAttribute("href", "/boards/board-7?item=item-9");
  });

  it("renders board context and a status label", () => {
    const groups = bucketMyWork(
      [
        item({
          itemId: "x",
          itemName: "Draft",
          boardName: "Launch",
          groupName: "This week",
          status: { label: "In progress", color: "#3b82f6" },
          dueDate: "2026-07-04",
        }),
      ],
      today,
    );
    render(<MyWorkList groups={groups} today={today} />);
    expect(screen.getByText(/Launch/)).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("renders the status label as a soft ColorChip carrying the status color", () => {
    const groups = bucketMyWork(
      [
        item({
          itemId: "x",
          itemName: "Draft",
          status: { label: "In progress", color: "#3b82f6" },
        }),
      ],
      today,
    );
    render(<MyWorkList groups={groups} today={today} />);
    const chip = screen.getByText("In progress");
    expect(chip.className).toContain("rounded-sm");
    expect(chip.style.getPropertyValue("--pill")).toBe("#3b82f6");
  });

  it("renders bucket headings as mono Kicker labels", () => {
    const groups = bucketMyWork([item({ itemId: "a" })], today); // no date
    render(<MyWorkList groups={groups} today={today} />);
    const heading = screen.getByText("No date");
    expect(heading.className).toContain("font-mono");
    expect(heading.className).toContain("text-kicker");
  });

  it("keeps the overdue bucket heading in the destructive color", () => {
    const groups = bucketMyWork(
      [item({ itemId: "a", dueDate: "2026-07-01" })], // overdue
      today,
    );
    render(<MyWorkList groups={groups} today={today} />);
    const heading = screen.getByText("Overdue");
    expect(heading.className).toContain("font-mono");
    expect(heading.className).toContain("text-destructive");
  });
});
