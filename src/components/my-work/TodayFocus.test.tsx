import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodayFocus } from "./TodayFocus";
import type { FocusItem, FocusResult } from "@/lib/focus/queries";
import type { FocusTier } from "@/lib/focus/reason";

// next/link needs the App Router context, which jsdom lacks.
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

function item(n: number, tier: FocusTier, reason: string): FocusItem {
  return {
    itemId: `item-${n}`,
    itemName: `Task ${n}`,
    boardId: `board-${n}`,
    boardName: `Board ${n}`,
    groupName: `Group ${n}`,
    status: "Working on it",
    dueDate: "2026-11-1" + (n % 10),
    tier,
    reason,
  };
}

function focusOf(count: number, over: Partial<FocusResult> = {}): FocusResult {
  const items = Array.from({ length: count }, (_, i) =>
    item(i + 1, i < 3 ? 1 : 3, i < 3 ? "2 days overdue" : "Due tomorrow"),
  );
  return {
    today: "2026-11-14",
    timezoneAssumed: false,
    items,
    totals: { 1: 3, 2: 0, 3: count - 3, 4: 0, 5: 0 },
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("TodayFocus", () => {
  it("renders the first 7 of 12 items as deep links with name, place, reason and due date", () => {
    render(<TodayFocus focus={focusOf(12)} canAsk={false} nextDue={null} />);
    const links = within(
      screen.getByRole("list", { name: "Ranked focus items" }),
    ).getAllByRole("link");
    expect(links).toHaveLength(7);
    expect(links[0]).toHaveAttribute("href", "/boards/board-1?item=item-1");
    expect(within(links[0]).getByText("Task 1")).toBeInTheDocument();
    expect(within(links[0]).getByText("Board 1 · Group 1")).toBeInTheDocument();
    expect(within(links[0]).getByText("2 days overdue")).toBeInTheDocument();
    expect(within(links[0]).getByText("Nov 11")).toBeInTheDocument();
    expect(screen.queryByText("Task 8")).not.toBeInTheDocument();
  });

  it("reveals the rest with no fetch and flips the toggle label", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<TodayFocus focus={focusOf(12)} canAsk={false} nextDue={null} />);
    const toggle = screen.getByRole("button", { name: "Show all 12" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(
      within(
        screen.getByRole("list", { name: "Ranked focus items" }),
      ).getAllByRole("link"),
    ).toHaveLength(12);
    const back = screen.getByRole("button", { name: "Show fewer" });
    expect(back).toHaveAttribute("aria-expanded", "true");
    expect(fetchSpy).not.toHaveBeenCalled();
    await user.click(back);
    expect(
      within(
        screen.getByRole("list", { name: "Ranked focus items" }),
      ).getAllByRole("link"),
    ).toHaveLength(7);
  });

  it("has no toggle with 7 or fewer items", () => {
    render(<TodayFocus focus={focusOf(7)} canAsk={false} nextDue={null} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("summarises the tiers from the database totals, not the visible rows", () => {
    render(<TodayFocus focus={focusOf(12)} canAsk={false} nextDue={null} />);
    const counts = screen.getByRole("list", { name: "Today by reason" });
    expect(within(counts).getByText("3")).toBeInTheDocument();
    expect(within(counts).getByText(/overdue/)).toBeInTheDocument();
    expect(within(counts).getByText("9")).toBeInTheDocument();
    expect(within(counts).getByText(/due soon/)).toBeInTheDocument();
    expect(within(counts).queryByText(/stalled/)).not.toBeInTheDocument();
  });

  it("shows the empty state with the next due item", () => {
    render(
      <TodayFocus
        focus={focusOf(0, { totals: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } })}
        canAsk={false}
        nextDue={{ name: "Q1 roadmap review", dueDate: "2026-11-19" }}
      />,
    );
    expect(screen.getByText("Nothing urgent")).toBeInTheDocument();
    expect(
      screen.getByText("Next due: Q1 roadmap review · Nov 19"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("omits the next-due line when the member has nothing dated", () => {
    render(
      <TodayFocus
        focus={focusOf(0, { totals: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } })}
        canAsk={false}
        nextDue={null}
      />,
    );
    expect(screen.getByText("Nothing urgent")).toBeInTheDocument();
    expect(screen.queryByText(/Next due/)).not.toBeInTheDocument();
  });

  it("shows only the failure line when focus could not load", () => {
    render(<TodayFocus focus={null} canAsk nextDue={null} />);
    expect(screen.getByText("Today could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Ask about my day")).not.toBeInTheDocument();
  });

  it("offers Ask about my day only when the member can ask, as a plain link", () => {
    const { rerender } = render(
      <TodayFocus focus={focusOf(2)} canAsk={false} nextDue={null} />,
    );
    expect(screen.queryByText("Ask about my day")).not.toBeInTheDocument();
    rerender(<TodayFocus focus={focusOf(2)} canAsk nextDue={null} />);
    expect(
      screen.getByRole("link", { name: "Ask about my day" }),
    ).toHaveAttribute("href", "/ask?start=today");
  });

  it("tells the member when dates fell back to UTC", () => {
    const { rerender } = render(
      <TodayFocus focus={focusOf(2)} canAsk={false} nextDue={null} />,
    );
    expect(screen.queryByText(/Dates use UTC/)).not.toBeInTheDocument();
    rerender(
      <TodayFocus
        focus={focusOf(2, { timezoneAssumed: true })}
        canAsk={false}
        nextDue={null}
      />,
    );
    const note = screen.getByText(/Dates use UTC\./);
    expect(note).toHaveTextContent(
      "Dates use UTC. Set your timezone in Preferences.",
    );
    expect(screen.getByRole("link", { name: "Preferences" })).toHaveAttribute(
      "href",
      "/settings/preferences",
    );
  });

  it("marks a past due date as overdue and keeps a future one muted", () => {
    render(<TodayFocus focus={focusOf(4)} canAsk={false} nextDue={null} />);
    expect(screen.getByText("Nov 11").className).toMatch(/text-destructive/);
    expect(screen.getByText("Nov 14").className).not.toMatch(
      /text-destructive/,
    );
  });
});
