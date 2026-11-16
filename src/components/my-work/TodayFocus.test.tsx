import type { ReactNode } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRowAction, TodayFocus } from "./TodayFocus";
import { consumeAskStart } from "@/lib/ai/ask/start-prompts";
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

const markFocusItemDone = vi.fn();
const setFocusItemDueDate = vi.fn();
vi.mock("@/lib/focus/actions", () => ({
  markFocusItemDone: (...a: unknown[]) => markFocusItemDone(...a),
  setFocusItemDueDate: (...a: unknown[]) => setFocusItemDueDate(...a),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));

function item(
  n: number,
  tier: FocusTier,
  reason: string,
  over: Partial<FocusItem> = {},
): FocusItem {
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
    canEdit: true,
    canMarkDone: true,
    canSetDue: true,
    ...over,
  };
}

/** `count` rows in database order: 3 overdue, then the rest due soon. */
function focusOf(count: number, over: Partial<FocusResult> = {}): FocusResult {
  const items = Array.from({ length: count }, (_, i) =>
    item(i + 1, i < 3 ? 1 : 3, i < 3 ? "2 days overdue" : "Due tomorrow"),
  );
  return {
    today: "2026-11-14",
    timezoneAssumed: false,
    items,
    totals: { 0: 0, 1: 3, 2: 0, 3: count - 3, 4: 0, 5: 0 },
    ordering: "current",
    ...over,
  };
}

const NO_TOTALS = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as const;

/** The item names on screen, top to bottom. */
function shownNames(): string[] {
  return within(document.getElementById("today-focus-items")!)
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")!.textContent ?? "");
}

/** A promise the test settles by hand, to hold an action "in flight". */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  markFocusItemDone.mockReset();
  setFocusItemDueDate.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("TodayFocus", () => {
  it("renders the first 7 of 12 rows with name, place, reason and a link to the item", () => {
    render(<TodayFocus focus={focusOf(12)} canAsk={false} nextDue={null} />);
    expect(shownNames()).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `Task ${n}`));
    const first = screen.getByRole("link", { name: /^Task 1/ });
    expect(first).toHaveAttribute("href", "/boards/board-1?item=item-1");
    expect(within(first).getByText("Board 1 · Group 1")).toBeInTheDocument();
    expect(within(first).getByText("2 days overdue")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Task 1 on its board" }),
    ).toHaveAttribute("href", "/boards/board-1?item=item-1");
    expect(screen.queryByText("Task 8")).not.toBeInTheDocument();
  });

  it("groups rows by reason in the order given, due today first, and never re-sorts", () => {
    const items = [
      item(1, 0, "Due today", { dueDate: "2026-11-14" }),
      item(2, 0, "Due today", { dueDate: "2026-11-14" }),
      // Most recent overdue first, as the database ranked them.
      item(3, 1, "1 day overdue", { dueDate: "2026-11-13" }),
      item(4, 1, "9 days overdue", { dueDate: "2026-11-05" }),
      item(5, 2, "Someone is waiting on this"),
    ];
    render(
      <TodayFocus
        focus={focusOf(0, {
          items,
          totals: { 0: 2, 1: 128, 2: 1, 3: 0, 4: 0, 5: 0 },
        })}
        canAsk={false}
        nextDue={null}
      />,
    );
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual(["Due today", "Overdue", "Blocking"]);
    expect(shownNames()).toEqual([
      "Task 1",
      "Task 2",
      "Task 3",
      "Task 4",
      "Task 5",
    ]);
    const overdue = screen.getByRole("region", { name: "Overdue" });
    expect(within(overdue).getAllByRole("listitem")).toHaveLength(2);
    // The group's count is the database total, not the rows on screen.
    expect(within(overdue).getByText("2 of 128")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Due today" })).getByText("2"),
    ).toBeInTheDocument();
  });

  it("shows more in bounded steps from rows already loaded, with no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    render(<TodayFocus focus={focusOf(20)} canAsk={false} nextDue={null} />);
    expect(screen.getByText("Showing 7 of 20")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 10 more" }));
    expect(shownNames()).toHaveLength(17);
    expect(screen.getByText("Showing 17 of 20")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(shownNames()).toHaveLength(20);
    expect(
      screen.queryByRole("button", { name: /Show \d+ more/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(shownNames()).toHaveLength(7);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(markFocusItemDone).not.toHaveBeenCalled();
  });

  it("says how many exist beyond the loaded rows and where they are", async () => {
    const user = userEvent.setup();
    render(
      <TodayFocus
        focus={focusOf(8, { totals: { 0: 0, 1: 3, 2: 0, 3: 60, 4: 0, 5: 0 } })}
        canAsk={false}
        nextDue={null}
      />,
    );
    expect(screen.getByText("Showing 7 of 63")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(
      screen.getByText("Showing 8 of 63. The rest is in the list below."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Show \d+ more/ }),
    ).not.toBeInTheDocument();
  });

  it("has no footer with 7 or fewer items", () => {
    render(<TodayFocus focus={focusOf(7)} canAsk={false} nextDue={null} />);
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Show/ }),
    ).not.toBeInTheDocument();
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

  it("leaves out a tier whose total is unknown, never showing it as 0 (deferred minor m1)", () => {
    render(
      <TodayFocus
        focus={focusOf(12, {
          ordering: "legacy",
          totals: { 0: null, 1: 3, 2: 0, 3: 9, 4: null, 5: null },
        })}
        canAsk={false}
        nextDue={null}
      />,
    );
    const counts = screen.getByRole("list", { name: "Today by reason" });
    expect(within(counts).getAllByRole("listitem")).toHaveLength(2);
    expect(within(counts).queryByText(/stalled/)).not.toBeInTheDocument();
    expect(within(counts).queryByText("0")).not.toBeInTheDocument();
    // An unknown total is not presented as the list's size.
    expect(screen.getByText("Showing 7 of 12")).toBeInTheDocument();
  });

  it("shows the empty state with the next due item", () => {
    render(
      <TodayFocus
        focus={focusOf(0, { totals: { ...NO_TOTALS } })}
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
        focus={focusOf(0, { totals: { ...NO_TOTALS } })}
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

  it("arms the one-shot ask token when the Ask link is clicked, and not before", async () => {
    const user = userEvent.setup();
    render(<TodayFocus focus={focusOf(2)} canAsk nextDue={null} />);
    expect(consumeAskStart("What should I focus on today?")).toBe(false);
    await user.click(screen.getByRole("link", { name: "Ask about my day" }));
    expect(consumeAskStart("What should I focus on today?")).toBe(true);
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
    // The same tint on a row the member can only view (a plain label there).
    cleanup();
    render(
      <TodayFocus
        focus={focusOf(0, {
          items: [item(1, 1, "3 days overdue", { canEdit: false })],
          totals: { ...NO_TOTALS, 1: 1 },
        })}
        canAsk={false}
        nextDue={null}
      />,
    );
    expect(screen.getByText("Nov 11").className).toMatch(/text-destructive/);
  });
});

describe("TodayFocus row actions", () => {
  it("offers no action controls on a board the member can only view", () => {
    const items = [
      item(1, 1, "2 days overdue"),
      item(2, 1, "3 days overdue", { canEdit: false }),
    ];
    render(
      <TodayFocus
        focus={focusOf(0, { items, totals: { ...NO_TOTALS, 1: 2 } })}
        canAsk={false}
        nextDue={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Mark done: Task 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Change due date for Task 1/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Task 2/ }),
    ).not.toBeInTheDocument();
    // Still readable and still opens.
    expect(screen.getByText("Nov 12")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Task 2 on its board" }),
    ).toBeInTheDocument();
  });

  it("offers only the actions the board supports", () => {
    const items = [
      item(1, 1, "2 days overdue", { canMarkDone: false }),
      item(2, 4, "1 unread reply for you", { canSetDue: false, dueDate: null }),
    ];
    render(
      <TodayFocus
        focus={focusOf(0, { items, totals: { ...NO_TOTALS, 1: 1, 4: 1 } })}
        canAsk={false}
        nextDue={null}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Mark done: Task 1" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Change due date for Task 1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark done: Task 2" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /due date for Task 2/ }),
    ).not.toBeInTheDocument();
  });

  it("mark done: the row leaves and the counts drop at once, with one action call", async () => {
    const pending = deferred<{ ok: true; data: { optionLabel: string } }>();
    markFocusItemDone.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<TodayFocus focus={focusOf(12)} canAsk={false} nextDue={null} />);
    await user.click(screen.getByRole("button", { name: "Mark done: Task 2" }));

    expect(markFocusItemDone).toHaveBeenCalledTimes(1);
    expect(markFocusItemDone).toHaveBeenCalledWith({ itemId: "item-2" });
    // Gone while the write is still in flight; the next row fills the page.
    expect(shownNames()).toEqual([1, 3, 4, 5, 6, 7, 8].map((n) => `Task ${n}`));
    const counts = screen.getByRole("list", { name: "Today by reason" });
    expect(within(counts).getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Showing 7 of 11")).toBeInTheDocument();

    await act(async () => {
      pending.resolve({ ok: true, data: { optionLabel: "Done" } });
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("mark done refused: the row comes back and the member is told why", async () => {
    const pending = deferred<{ ok: false; error: string }>();
    markFocusItemDone.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<TodayFocus focus={focusOf(3)} canAsk={false} nextDue={null} />);
    await user.click(screen.getByRole("button", { name: "Mark done: Task 2" }));
    expect(shownNames()).toEqual(["Task 1", "Task 3"]);

    await act(async () => {
      pending.resolve({ ok: false, error: "This board has no done status." });
    });
    expect(shownNames()).toEqual(["Task 1", "Task 2", "Task 3"]);
    expect(toastError).toHaveBeenCalledWith(
      '"Task 2" was not marked done. This board has no done status.',
    );
  });

  it("the server's fresh list replaces the optimistic one when the action settles", async () => {
    const pending = deferred<{ ok: true; data: { optionLabel: string } }>();
    markFocusItemDone.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    const { rerender } = render(
      <TodayFocus focus={focusOf(3)} canAsk={false} nextDue={null} />,
    );
    await user.click(screen.getByRole("button", { name: "Mark done: Task 1" }));
    // What revalidation delivers: the item is gone and a new one ranked in.
    const fresh = focusOf(0, {
      items: [item(2, 1, "2 days overdue"), item(9, 3, "Due tomorrow")],
      totals: { ...NO_TOTALS, 1: 1, 3: 1 },
    });
    await act(async () => {
      rerender(<TodayFocus focus={fresh} canAsk={false} nextDue={null} />);
      pending.resolve({ ok: true, data: { optionLabel: "Done" } });
    });
    expect(shownNames()).toEqual(["Task 2", "Task 9"]);
  });

  it("change due date: the row shows the new date at once, dimmed, with one action call", async () => {
    const pending = deferred<{ ok: true; data: { dueDate: string } }>();
    setFocusItemDueDate.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<TodayFocus focus={focusOf(3)} canAsk={false} nextDue={null} />);
    const trigger = screen.getByRole("button", {
      name: "Change due date for Task 1, now Nov 11",
    });
    expect(trigger.className).toMatch(/text-destructive/);
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));

    expect(setFocusItemDueDate).toHaveBeenCalledTimes(1);
    expect(setFocusItemDueDate).toHaveBeenCalledWith({
      itemId: "item-1",
      dueDate: "2026-11-15",
    });
    const moved = screen.getByRole("button", {
      name: "Change due date for Task 1, now Nov 15",
    });
    expect(moved.className).not.toMatch(/text-destructive/);
    expect(moved).toBeDisabled();
    expect(moved.closest("li")).toHaveAttribute("aria-busy", "true");
    // It keeps its place: only the database can say where it belongs now.
    expect(shownNames()).toEqual(["Task 1", "Task 2", "Task 3"]);

    await act(async () => {
      pending.resolve({ ok: true, data: { dueDate: "2026-11-15" } });
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("change due date refused: the old date comes back with the reason", async () => {
    setFocusItemDueDate.mockResolvedValue({ ok: false, error: "denied" });
    const user = userEvent.setup();
    render(<TodayFocus focus={focusOf(3)} canAsk={false} nextDue={null} />);
    await user.click(
      screen.getByRole("button", { name: /Change due date for Task 1/ }),
    );
    await user.click(screen.getByRole("button", { name: "In a week" }));
    expect(
      await screen.findByRole("button", {
        name: "Change due date for Task 1, now Nov 11",
      }),
    ).toBeEnabled();
    expect(toastError).toHaveBeenCalledWith(
      'The due date of "Task 1" was not changed. denied',
    );
  });

  it("picking the date it already has writes nothing", async () => {
    const user = userEvent.setup();
    const items = [item(1, 0, "Due today", { dueDate: "2026-11-14" })];
    render(
      <TodayFocus
        focus={focusOf(0, { items, totals: { ...NO_TOTALS, 0: 1 } })}
        canAsk={false}
        nextDue={null}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Change due date for Task 1/ }),
    );
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(setFocusItemDueDate).not.toHaveBeenCalled();
  });

  it("offers 'Set date' on an editable row with no due date", () => {
    const items = [item(1, 4, "1 unread reply for you", { dueDate: null })];
    render(
      <TodayFocus
        focus={focusOf(0, { items, totals: { ...NO_TOTALS, 4: 1 } })}
        canAsk={false}
        nextDue={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Set a due date for Task 1" }),
    ).toHaveTextContent("Set date");
  });
});

describe("applyRowAction", () => {
  const state = {
    items: [item(1, 1, "x"), item(2, 3, "y")],
    totals: { 0: 0, 1: 1, 2: 0, 3: null, 4: 0, 5: 0 },
  };

  it("done removes the row and lowers its tier's total, keeping unknown unknown", () => {
    expect(applyRowAction(state, { type: "done", itemId: "item-1" })).toEqual({
      items: [state.items[1]],
      totals: { ...state.totals, 1: 0 },
    });
    expect(
      applyRowAction(state, { type: "done", itemId: "item-2" }).totals[3],
    ).toBeNull();
  });

  it("done for a row that is not there changes nothing", () => {
    expect(applyRowAction(state, { type: "done", itemId: "nope" })).toBe(state);
  });

  it("due keeps the row in place with the new date, marked pending", () => {
    const next = applyRowAction(state, {
      type: "due",
      itemId: "item-2",
      dueDate: "2026-12-01",
    });
    expect(next.items.map((i) => i.itemId)).toEqual(["item-1", "item-2"]);
    expect(next.items[1]).toMatchObject({
      dueDate: "2026-12-01",
      pending: true,
    });
    expect(next.totals).toBe(state.totals);
  });
});
