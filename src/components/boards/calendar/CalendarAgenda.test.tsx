import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("CalendarAgenda dense-day clamp", () => {
  // N items all on the same day → one dense agenda group.
  function denseDay(count: number) {
    const dayItems = Array.from({ length: count }, (_, i) => ({
      id: `d-${i}`,
      name: `Event ${i}`,
    }));
    const dayCells = dayItems.map((it) => ({
      item_id: it.id,
      column_id: "d1",
      value: { date: "2026-06-10" },
    })) as never;
    return render(
      <CalendarAgenda
        fromISO="2026-06-01"
        toISO="2026-06-30"
        today="2026-06-16"
        items={dayItems}
        cellValues={dayCells}
        dateColumnId="d1"
        statusColumn={undefined}
        cellMap={buildCellMap(dayCells)}
      />,
    );
  }

  it("clamps a dense day to 8 items behind a +N more expander", async () => {
    denseDay(12);
    expect(screen.getAllByTestId("agenda-item")).toHaveLength(8);
    const more = screen.getByRole("button", { name: /\+4 more/i });
    await userEvent.click(more);
    expect(screen.getAllByTestId("agenda-item")).toHaveLength(12);
  });

  it("shows no expander when a day is at or under the cap", () => {
    denseDay(8);
    expect(screen.getAllByTestId("agenda-item")).toHaveLength(8);
    expect(
      screen.queryByRole("button", { name: /more/i }),
    ).not.toBeInTheDocument();
  });
});
