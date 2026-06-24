import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { CalendarMonth } from "./CalendarMonth";
import { buildCellMap } from "@/lib/boards/cache";

const statusColumn = undefined;
// June 2026; pile 4 overlapping spans onto Jun 10 to force overflow (cap = 3).
const items = [
  { id: "a", name: "Span A" },
  { id: "b", name: "Span B" },
  { id: "c", name: "Span C" },
  { id: "d", name: "Span D" },
];
const cellValues = items.map((it) => ({
  item_id: it.id,
  column_id: "d1",
  value: { date: "2026-06-09", end: "2026-06-12" },
})) as never;

function renderMonth(onOpenItem = vi.fn()) {
  return render(
    <DndContext>
      <CalendarMonth
        monthISO="2026-06-01"
        today="2026-06-16"
        items={items}
        cellValues={cellValues}
        dateColumnId="d1"
        statusColumn={statusColumn}
        cellMap={buildCellMap(cellValues)}
        onDayClick={vi.fn()}
        onOpenItem={onOpenItem}
      />
    </DndContext>,
  );
}

describe("CalendarMonth", () => {
  it("renders at most the lane cap of bars and a +N more trigger", () => {
    renderMonth();
    // Each span renders as ONE grid bar (not one chip per day). 3 of the 4
    // overlapping spans are visible (lanes 0-2); the 4th overflows the cap.
    expect(screen.getAllByText(/Span [ABC]/)).toHaveLength(3);
    expect(screen.getAllByText(/\+1 more/).length).toBeGreaterThan(0);
  });

  it("opens a popover listing the hidden item when +N more is clicked", () => {
    renderMonth();
    fireEvent.click(screen.getAllByText(/\+1 more/)[0]);
    expect(screen.getByText("Span D")).toBeInTheDocument();
  });

  it("counts per-day overflow for a hidden item on an interior day of a hidden span", () => {
    // 4 full-week spans fill lanes 0-3 (lane 3 overflows the cap); a single-day
    // item on Wed adds a 2nd hidden item to that one day.
    const items = [
      { id: "a", name: "Span A" },
      { id: "b", name: "Span B" },
      { id: "c", name: "Span C" },
      { id: "d", name: "Span D" },
      { id: "e", name: "Single E" },
    ];
    const cv = [
      ...["a", "b", "c", "d"].map((id) => ({
        item_id: id,
        column_id: "d1",
        value: { date: "2026-06-07", end: "2026-06-13" }, // full week Sun..Sat
      })),
      { item_id: "e", column_id: "d1", value: { date: "2026-06-10" } }, // Wed, interior
    ] as never;
    render(
      <DndContext>
        <CalendarMonth
          monthISO="2026-06-01"
          today="2026-06-16"
          items={items}
          cellValues={cv}
          dateColumnId="d1"
          statusColumn={undefined}
          cellMap={buildCellMap(cv)}
          onDayClick={vi.fn()}
          onOpenItem={vi.fn()}
        />
      </DndContext>,
    );
    // Wed Jun 10 carries 2 hidden items (Span D + Single E) → "+2 more".
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("renders a week-crossing span as two accessibly-named segments", () => {
    const items = [{ id: "x", name: "Cross Span" }];
    const cv = [
      {
        item_id: "x",
        column_id: "d1",
        value: { date: "2026-06-11", end: "2026-06-17" },
      },
    ] as never;
    render(
      <DndContext>
        <CalendarMonth
          monthISO="2026-06-01"
          today="2026-06-16"
          items={items}
          cellValues={cv}
          dateColumnId="d1"
          statusColumn={undefined}
          cellMap={buildCellMap(cv)}
          onDayClick={vi.fn()}
          onOpenItem={vi.fn()}
        />
      </DndContext>,
    );
    // One segment in the week of Jun 7 (Thu–Sat), one in the week of Jun 14 (Sun–Wed).
    expect(screen.getAllByLabelText("Cross Span")).toHaveLength(2);
  });
});
