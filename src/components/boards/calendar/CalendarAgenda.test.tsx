import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CalendarAgenda } from "./CalendarAgenda";
import { buildCellMap } from "@/lib/boards/cache";

const items = [
  { id: "i1", name: "Launch" },
  { id: "i2", name: "Standup" },
];
const cellValues = [
  {
    item_id: "i1",
    column_id: "d1",
    value: { date: "2026-06-09", end: "2026-06-16" },
  },
  { item_id: "i2", column_id: "d1", value: { date: "2026-06-10" } },
] as never;

function renderAgenda(onItemTap = vi.fn()) {
  return render(
    <CalendarAgenda
      fromISO="2026-06-01"
      toISO="2026-06-30"
      today="2026-06-16"
      items={items}
      cellValues={cellValues}
      dateColumnId="d1"
      statusColumn={undefined}
      cellMap={buildCellMap(cellValues)}
      onItemTap={onItemTap}
    />,
  );
}

describe("CalendarAgenda", () => {
  it("lists items grouped by day", () => {
    renderAgenda();
    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(screen.getByText("Standup")).toBeInTheDocument();
  });
  it("shows a date range for multi-day items", () => {
    renderAgenda();
    expect(screen.getByText(/Jun 9.*Jun 16/)).toBeInTheDocument();
  });
  it("fires onItemTap with the item id and the tapped row's rect", () => {
    const onItemTap = vi.fn();
    renderAgenda(onItemTap);
    fireEvent.click(screen.getByText("Standup"));
    expect(onItemTap).toHaveBeenCalledWith("i2", expect.any(Object));
  });
});
