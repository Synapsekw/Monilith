import { describe, expect, it } from "vitest";
import { focusReason, type FocusFacts } from "./reason";

const base: FocusFacts = {
  tier: 1,
  daysOverdue: null,
  waitingCount: 0,
  waiting: [],
  unreadCount: 0,
  daysQuiet: null,
};

describe("focusReason", () => {
  it("words an item due today, with who is waiting when someone is", () => {
    expect(focusReason({ ...base, tier: 0, dueInDays: 0 })).toBe("Due today");
    expect(
      focusReason({
        ...base,
        tier: 0,
        dueInDays: 0,
        waitingCount: 1,
        waiting: [{ name: "Vendor contract", assignees: ["Ana Kovac"] }],
      }),
    ).toBe('Due today · Ana Kovac\'s "Vendor contract" waits on this');
  });

  it("words an overdue item, singular and plural", () => {
    expect(focusReason({ ...base, daysOverdue: 1 })).toBe("1 day overdue");
    expect(focusReason({ ...base, daysOverdue: 4 })).toBe("4 days overdue");
  });
  it("adds who is waiting to an overdue item", () => {
    expect(
      focusReason({
        ...base,
        daysOverdue: 2,
        waitingCount: 1,
        waiting: [{ name: "Vendor contract", assignees: ["Ana Kovac"] }],
      }),
    ).toBe('2 days overdue · Ana Kovac\'s "Vendor contract" waits on this');
  });
  it("words a blocking item with more waiting than named", () => {
    expect(
      focusReason({
        ...base,
        tier: 2,
        waitingCount: 3,
        waiting: [
          { name: "A", assignees: ["Ana Kovac"] },
          { name: "B", assignees: [] },
        ],
      }),
    ).toBe('Ana Kovac\'s "A" and 2 more wait on this');
  });
  it("words due today, tomorrow and in two days", () => {
    expect(focusReason({ ...base, tier: 3, dueInDays: 0 })).toBe("Due today");
    expect(focusReason({ ...base, tier: 3, dueInDays: 1 })).toBe(
      "Due tomorrow",
    );
    expect(focusReason({ ...base, tier: 3, dueInDays: 2 })).toBe(
      "Due in 2 days",
    );
  });
  it("words unread replies", () => {
    expect(focusReason({ ...base, tier: 4, unreadCount: 1 })).toBe(
      "1 unread reply for you",
    );
    expect(focusReason({ ...base, tier: 4, unreadCount: 3 })).toBe(
      "3 unread replies for you",
    );
  });
  it("words a stalled item", () => {
    expect(focusReason({ ...base, tier: 5, daysQuiet: 9 })).toBe(
      "No activity for 9 days",
    );
  });
});
