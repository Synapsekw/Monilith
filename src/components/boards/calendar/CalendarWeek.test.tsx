import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { CalendarWeek } from "./CalendarWeek";
import { buildCellMap } from "@/lib/boards/cache";

const items = [
  { id: "a", name: "Span A" },
  { id: "b", name: "Span B" },
  { id: "c", name: "Span C" },
  { id: "d", name: "Span D" },
];
// 4 overlapping spans — all must render in week view (no cap).
const cellValues = items.map((it) => ({
  item_id: it.id,
  column_id: "d1",
  value: { date: "2026-06-08", end: "2026-06-11" },
})) as never;

describe("CalendarWeek", () => {
  it("renders all overlapping spans (no lane cap)", () => {
    render(
      <DndContext>
        <CalendarWeek
          weekStartISO="2026-06-07"
          today="2026-06-16"
          items={items}
          cellValues={cellValues}
          dateColumnId="d1"
          statusColumn={undefined}
          cellMap={buildCellMap(cellValues)}
          onDayClick={vi.fn()}
          onOpenItem={vi.fn()}
        />
      </DndContext>,
    );
    for (const name of ["Span A", "Span B", "Span C", "Span D"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
