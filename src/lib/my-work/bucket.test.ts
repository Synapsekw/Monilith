import { describe, expect, it } from "vitest";
import { bucketFor, bucketMyWork, endOfWeek, type MyWorkItem } from "./bucket";

function item(partial: Partial<MyWorkItem> & { itemId: string }): MyWorkItem {
  return {
    itemName: partial.itemId,
    boardId: "b1",
    boardName: "Board",
    groupName: null,
    status: null,
    dueDate: null,
    ...partial,
  };
}

describe("endOfWeek", () => {
  it("returns the Sunday of a Monday-start week", () => {
    // 2026-07-01 is a Wednesday → end of week is Sunday 2026-07-05.
    expect(endOfWeek("2026-07-01")).toBe("2026-07-05");
    // On the Sunday itself, end of week is the same day.
    expect(endOfWeek("2026-07-05")).toBe("2026-07-05");
    // On the Monday, end of week is the coming Sunday.
    expect(endOfWeek("2026-06-29")).toBe("2026-07-05");
  });
});

describe("bucketFor", () => {
  const today = "2026-07-04";
  const weekEnd = endOfWeek(today); // 2026-07-05 (Sat) → week ends Sun 2026-07-05

  it("classifies each temporal case", () => {
    expect(bucketFor(null, today, weekEnd)).toBe("none");
    expect(bucketFor("2026-07-01", today, weekEnd)).toBe("overdue");
    expect(bucketFor("2026-07-04", today, weekEnd)).toBe("today");
    expect(bucketFor("2026-07-05", today, weekEnd)).toBe("week");
    expect(bucketFor("2026-07-20", today, weekEnd)).toBe("later");
  });
});

describe("bucketMyWork", () => {
  const today = "2026-07-04";

  it("groups items into ordered, non-empty buckets", () => {
    const groups = bucketMyWork(
      [
        item({ itemId: "later", dueDate: "2026-08-01" }),
        item({ itemId: "overdue", dueDate: "2026-07-01" }),
        item({ itemId: "today", dueDate: "2026-07-04" }),
        item({ itemId: "none" }),
      ],
      today,
    );
    expect(groups.map((g) => g.bucket)).toEqual([
      "overdue",
      "today",
      "later",
      "none",
    ]);
    // "This week" is omitted because nothing falls in it.
    expect(groups.map((g) => g.label)).toEqual([
      "Overdue",
      "Today",
      "Later",
      "No date",
    ]);
  });

  it("sorts dated buckets by due date then name", () => {
    const [overdue] = bucketMyWork(
      [
        item({ itemId: "b-early", itemName: "Zed", dueDate: "2026-07-01" }),
        item({ itemId: "a-early", itemName: "Ann", dueDate: "2026-07-01" }),
        item({
          itemId: "later-overdue",
          itemName: "Bob",
          dueDate: "2026-07-02",
        }),
      ],
      today,
    );
    // Same date → tie-break by name (Ann before Zed); earlier date first overall.
    expect(overdue.items.map((i) => i.itemName)).toEqual(["Ann", "Zed", "Bob"]);
  });

  it("sorts the no-date bucket by name", () => {
    const groups = bucketMyWork(
      [
        item({ itemId: "z", itemName: "Zebra" }),
        item({ itemId: "a", itemName: "Apple" }),
      ],
      today,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.itemName)).toEqual(["Apple", "Zebra"]);
  });

  it("returns an empty array when there is nothing assigned", () => {
    expect(bucketMyWork([], today)).toEqual([]);
  });
});
