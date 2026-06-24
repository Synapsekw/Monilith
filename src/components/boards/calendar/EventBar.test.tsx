import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { EventBar, statusOptionColor } from "./EventBar";
import type { PlacedInterval } from "@/lib/boards/calendar";

const statusColumn = {
  id: "s1",
  kind: "status",
  name: "Status",
  settings: { options: [{ id: "o1", label: "Done", color: "#46d18a" }] },
} as never;

function placed(over: Partial<PlacedInterval>): PlacedInterval {
  return {
    itemId: "i1",
    name: "Task",
    startCol: 1,
    endCol: 1,
    continuesLeft: false,
    continuesRight: false,
    isSingle: true,
    lane: 0,
    ...over,
  };
}

const renderBar = (interval: PlacedInterval, cellMap = new Map()) =>
  render(
    <DndContext>
      <EventBar
        interval={interval}
        fromDayISO="2026-06-10"
        dateColumnId="d1"
        statusColumn={statusColumn}
        cellMap={cellMap}
      />
    </DndContext>,
  );

describe("statusOptionColor", () => {
  it("resolves the option color for an item's status value", () => {
    const cellMap = new Map([["i1:s1", { optionId: "o1" }]]);
    expect(statusOptionColor(statusColumn, cellMap, "i1")).toBe("#46d18a");
  });
  it("returns null when no status is set", () => {
    expect(statusOptionColor(statusColumn, new Map(), "i1")).toBeNull();
  });
});

describe("EventBar", () => {
  it("shows the item name on a span that starts in view", () => {
    renderBar(placed({ name: "Launch", isSingle: false, endCol: 3 }));
    expect(screen.getByText("Launch")).toBeInTheDocument();
  });
  it("renders a single-day item with its name", () => {
    renderBar(placed({ name: "Standup" }));
    expect(screen.getByText("Standup")).toBeInTheDocument();
  });
  it("hides the name on a span continuing from a previous week", () => {
    renderBar(
      placed({
        name: "Carryover",
        isSingle: false,
        endCol: 3,
        continuesLeft: true,
      }),
    );
    expect(screen.queryByText("Carryover")).not.toBeInTheDocument();
  });
});
