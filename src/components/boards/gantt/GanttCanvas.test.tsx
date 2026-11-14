import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  GanttCanvas,
  type GanttCanvasProps,
} from "@/components/boards/gantt/GanttCanvas";
import {
  placeLinkStubs,
  type ExternalLinkStub,
} from "@/components/boards/gantt/LinkStubs";
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
    canRemoveDependency: () => true,
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

// jsdom measures no layout, so the canvas runs at the month base scale:
// 10px/day × 30 days → a 300px track. i1 spans x 0–50; "late" spans 250–300.
function stub(over: Partial<ExternalLinkStub> = {}): ExternalLinkStub {
  return {
    dependencyId: "x1",
    direction: "waiting_on",
    itemId: "f1",
    itemName: "Permit",
    boardId: "b9",
    boardName: "Regulatory",
    endISO: "2026-11-08",
    late: false,
    ...over,
  };
}

const edgeRows: GanttRow[] = [
  ...rows,
  {
    itemId: "i3",
    name: "Handover",
    scheduled: true,
    startCol: 25,
    spanCols: 5,
    startISO: "2026-11-26",
    endISO: "2026-11-30",
  },
];

describe("GanttCanvas link stub placement", () => {
  it("flips a waiting-on stub after a bar that starts at the track edge", () => {
    const { container } = render(
      <GanttCanvas
        {...props({ externalLinks: new Map([["i1", [stub()]]]) })}
      />,
    );
    const sides = container.querySelectorAll("[data-stub-side]");
    expect(sides).toHaveLength(1);
    expect(sides[0]).toHaveAttribute("data-stub-side", "after");
    expect(
      screen.getByRole("button", { name: /Waiting on Permit/ }),
    ).toBeInTheDocument();
  });

  it("flips a blocking stub before a bar that ends at the track edge", () => {
    const { container } = render(
      <GanttCanvas
        {...props({
          rows: edgeRows,
          externalLinks: new Map([
            ["i3", [stub({ direction: "blocking", dependencyId: "x2" })]],
          ]),
        })}
      />,
    );
    const side = container.querySelector("[data-stub-side]");
    expect(side).toHaveAttribute("data-stub-side", "before");
    expect(side).toHaveStyle({ right: `${300 - 250 + 4}px` });
  });
});

describe("placeLinkStubs", () => {
  const base = { gap: 4, waitingOnCount: 1, blockingCount: 1 };
  it("keeps natural sides when both have room", () => {
    expect(
      placeLinkStubs({ ...base, barStartX: 400, barEndX: 500, trackW: 1000 }),
    ).toEqual({ waitingOn: "before", blocking: "after" });
  });
  it("overlays the bar end when neither side has room", () => {
    expect(
      placeLinkStubs({ ...base, barStartX: 0, barEndX: 300, trackW: 300 }),
    ).toEqual({ waitingOn: "inside", blocking: "inside" });
  });
  it("needs more room for an overflowing (+N) group", () => {
    // One chip fits 150px of room; three (2 chips + "+N") do not.
    const args = { ...base, barStartX: 160, barEndX: 200, trackW: 200 };
    expect(placeLinkStubs(args).waitingOn).toBe("before");
    expect(placeLinkStubs({ ...args, waitingOnCount: 3 }).waitingOn).toBe(
      "inside",
    );
  });
});

describe("GanttCanvas callbacks", () => {
  beforeAll(() => {
    // jsdom has no pointer capture.
    HTMLElement.prototype.setPointerCapture = () => {};
  });

  it("commits a right-edge resize through onResizeBar(id, newEnd)", () => {
    const onResizeBar = vi.fn();
    render(<GanttCanvas {...props({ onResizeBar })} />);
    const handle = screen.getByLabelText("Resize PO raised");
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 130, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 130, pointerId: 1 });
    expect(onResizeBar).toHaveBeenCalledWith("i1", "2026-11-08");
  });

  it("hides the resize handle when canEditItem is false", () => {
    render(<GanttCanvas {...props({ canEditItem: (id) => id !== "i1" })} />);
    expect(screen.queryByLabelText("Resize PO raised")).toBeNull();
    expect(screen.getByLabelText("Resize Delivery")).toBeInTheDocument();
  });

  it("collapses more than two stubs into a +N popover listing all", () => {
    const onStubTap = vi.fn();
    const many = ["A", "B", "C"].map((n, i) =>
      stub({ dependencyId: `x${i}`, itemName: `Permit ${n}` }),
    );
    render(
      <GanttCanvas
        {...props({ externalLinks: new Map([["i2", many]]), onStubTap })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Permit C/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show all 3 linked items" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Permit C/ }));
    expect(onStubTap).toHaveBeenCalledWith(many[2]);
  });

  it("offers Remove dep only for links the viewer may remove", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<GanttCanvas {...props()} />);
    await user.click(
      screen.getByRole("button", { name: "Options for Delivery" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /Remove dep/ }),
    ).toBeInTheDocument();
    unmount();
    render(<GanttCanvas {...props({ canRemoveDependency: () => false })} />);
    await user.click(
      screen.getByRole("button", { name: "Options for Delivery" }),
    );
    await screen.findByRole("menu");
    expect(
      screen.queryByRole("menuitem", { name: /Remove dep/ }),
    ).not.toBeInTheDocument();
  });

  it("renders section bands as headings, not bar rows", () => {
    render(<GanttCanvas {...props()} />);
    expect(
      screen.getByRole("heading", { level: 3, name: "Procurement" }),
    ).toBeInTheDocument();
  });

  it("makes a board band a collapse toggle only when onToggleExpand is given", () => {
    const { unmount } = render(<GanttCanvas {...props()} />);
    expect(
      screen.queryByRole("button", { name: /Collapse Procurement/ }),
    ).not.toBeInTheDocument();
    unmount();
    const onToggleExpand = vi.fn();
    render(
      <GanttCanvas
        {...props({ onToggleExpand, isExpanded: (id) => id !== "sec-b1" })}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Expand Procurement" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(onToggleExpand).toHaveBeenCalledWith("sec-b1");
  });
});
