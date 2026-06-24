import { describe, it, expect } from "vitest";
import { agendaGroups } from "@/lib/boards/calendar-agenda";

const items = [
  { id: "i1", name: "Early span" },
  { id: "i2", name: "Mid single" },
  { id: "i3", name: "Out of range" },
];
const cells = [
  {
    item_id: "i1",
    column_id: "d1",
    value: { date: "2026-05-30", end: "2026-06-02" },
  },
  { item_id: "i2", column_id: "d1", value: { date: "2026-06-02" } },
  { item_id: "i3", column_id: "d1", value: { date: "2026-07-15" } },
] as never;

describe("agendaGroups", () => {
  const groups = agendaGroups("2026-06-01", "2026-06-30", items, cells, "d1");

  it("returns only days that have items, chronologically", () => {
    expect(groups.map((g) => g.dateISO)).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("anchors a span that started before the window on fromISO", () => {
    const first = groups[0];
    expect(first.dateISO).toBe("2026-06-01");
    expect(first.items[0].itemId).toBe("i1");
    expect(first.items[0].range).toEqual({
      start: "2026-05-30",
      end: "2026-06-02",
    });
  });

  it("excludes items outside the window", () => {
    expect(groups.flatMap((g) => g.items).some((i) => i.itemId === "i3")).toBe(
      false,
    );
  });
});
