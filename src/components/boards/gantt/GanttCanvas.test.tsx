import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  GanttCanvas,
  type GanttCanvasProps,
} from "@/components/boards/gantt/GanttCanvas";
import type { GanttRow } from "@/lib/boards/gantt";

vi.mock("@/lib/dnd/sensors", () => ({ useTouchAwareSensors: () => [] }));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 1200,
  });
});

const rows: GanttRow[] = [
  {
    itemId: "sec-b1",
    name: "Procurement",
    scheduled: false,
    kind: "section",
    level: 0,
  },
  {
    itemId: "i1",
    name: "PO raised",
    scheduled: true,
    startCol: 0,
    spanCols: 5,
    startISO: "2026-11-01",
    endISO: "2026-11-05",
  },
  {
    itemId: "i2",
    name: "Delivery",
    scheduled: true,
    startCol: 6,
    spanCols: 3,
    startISO: "2026-11-07",
    endISO: "2026-11-09",
  },
];

function props(over: Partial<GanttCanvasProps> = {}): GanttCanvasProps {
  return {
    rows,
    dependencies: [{ id: "d1", predecessor_id: "i1", successor_id: "i2" }],
    violations: new Set(),
    rangeStartISO: "2026-11-01",
    dayCount: 30,
    zoom: "month",
    colorFor: () => "#8ea2eb",
    canEditItem: () => true,
    onMoveBar: vi.fn(),
    onResizeBar: vi.fn(),
    onAddDependency: vi.fn(),
    onRemoveDependency: vi.fn(),
    linkCandidates: () => [],
    onItemTap: vi.fn(),
    onStubTap: vi.fn(),
    ...over,
  };
}

describe("GanttCanvas", () => {
  it("renders section bands and item rows", () => {
    render(<GanttCanvas {...props()} />);
    expect(screen.getByText("Procurement")).toBeInTheDocument();
    // An item's name renders twice (name rail + bar label).
    expect(screen.getAllByText("PO raised")).toHaveLength(2);
    // Section rows are bands, not bars: no draggable row for them.
    expect(screen.getAllByTestId("gantt-row")).toHaveLength(2);
  });

  it("renders a stub for an external link and reports taps", () => {
    const onStubTap = vi.fn();
    const stub = {
      dependencyId: "x1",
      direction: "waiting_on" as const,
      itemId: "f1",
      itemName: "Permit",
      boardId: "b9",
      boardName: "Regulatory",
      endISO: "2026-11-08",
      late: true,
    };
    render(
      <GanttCanvas
        {...props({ externalLinks: new Map([["i1", [stub]]]), onStubTap })}
      />,
    );
    const el = screen.getByRole("button", {
      name: /Waiting on Permit · Regulatory/,
    });
    fireEvent.click(el);
    expect(onStubTap).toHaveBeenCalledWith(stub);
    expect(el).toHaveTextContent(/Late/);
  });

  it("draws an arrow between two scheduled linked bars", () => {
    const { container } = render(<GanttCanvas {...props()} />);
    const arrows = container.querySelectorAll("svg path[marker-end]");
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toHaveClass("stroke-muted-foreground");
  });

  it("draws a late link in the destructive stroke", () => {
    const { container } = render(
      <GanttCanvas {...props({ violations: new Set(["d1"]) })} />,
    );
    const arrows = container.querySelectorAll("svg path[marker-end]");
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toHaveClass("stroke-destructive");
  });

  it("draws no arrow when one end is unscheduled", () => {
    const { container } = render(
      <GanttCanvas
        {...props({
          dependencies: [
            { id: "d2", predecessor_id: "sec-b1", successor_id: "i2" },
          ],
        })}
      />,
    );
    expect(container.querySelectorAll("svg path[marker-end]")).toHaveLength(0);
  });
});
