import { createRef } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  GanttCanvas,
  type GanttCanvasHandle,
  type GanttCanvasProps,
} from "@/components/boards/gantt/GanttCanvas";
import {
  placeLinkStubs,
  type ExternalLinkStub,
} from "@/components/boards/gantt/LinkStubs";
import type { GanttRow } from "@/lib/boards/gantt";

vi.mock("@/lib/dnd/sensors", () => ({ useTouchAwareSensors: () => [] }));

// Pin "today" for the whole file: the today line and the open-on-today scroll
// read todayISO(). The fixtures below sit in November 2026.
vi.mock("@/components/boards/gantt/utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/boards/gantt/utils")>();
  return { ...actual, todayISO: () => "2026-11-14" };
});

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

describe("GanttCanvas name rail", () => {
  it("draws every row kind at the same 32px height", () => {
    render(<GanttCanvas {...props()} />);
    expect(screen.getByTestId("gantt-section")).toHaveStyle({ height: "32px" });
    for (const row of screen.getAllByTestId("gantt-row")) {
      expect(row).toHaveStyle({ height: "32px" });
    }
  });

  it("defaults the rail to 300px and follows labelWidth", () => {
    const { rerender } = render(<GanttCanvas {...props()} />);
    expect(screen.getByTestId("gantt-rail-header")).toHaveStyle({
      width: "300px",
    });
    rerender(<GanttCanvas {...props({ labelWidth: 220 })} />);
    expect(screen.getByTestId("gantt-rail-header")).toHaveStyle({
      width: "220px",
    });
    // A band spans the rail plus the timeline track, whatever the day scale.
    const rail = parseFloat(
      screen.getByTestId("gantt-rail-header").style.width,
    );
    const track = parseFloat(
      screen.getByTestId("gantt-track-header").style.width,
    );
    expect(track).toBeGreaterThan(0);
    expect(parseFloat(screen.getByTestId("gantt-section").style.width)).toBe(
      rail + track,
    );
  });

  it("clamps an out-of-range labelWidth prop", () => {
    const { rerender } = render(
      <GanttCanvas {...props({ labelWidth: 9999 })} />,
    );
    expect(screen.getByTestId("gantt-rail-header")).toHaveStyle({
      width: "520px",
    });
    rerender(<GanttCanvas {...props({ labelWidth: 10 })} />);
    expect(screen.getByTestId("gantt-rail-header")).toHaveStyle({
      width: "160px",
    });
  });

  it("shows no resize handle unless onLabelWidthChange is given", () => {
    render(<GanttCanvas {...props()} />);
    expect(
      screen.queryByRole("separator", { name: /Resize name rail/ }),
    ).not.toBeInTheDocument();
  });

  it("reports one clamped width on drag end and none while dragging", () => {
    const onLabelWidthChange = vi.fn();
    render(<GanttCanvas {...props({ labelWidth: 300, onLabelWidthChange })} />);
    const handle = screen.getByRole("separator", { name: /Resize name rail/ });
    fireEvent.pointerDown(handle, { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 600 });
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(onLabelWidthChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    expect(onLabelWidthChange).toHaveBeenCalledTimes(1);
    expect(onLabelWidthChange).toHaveBeenCalledWith(520);
  });

  it("clamps a drag to the left at 160px", () => {
    const onLabelWidthChange = vi.fn();
    render(<GanttCanvas {...props({ labelWidth: 300, onLabelWidthChange })} />);
    const handle = screen.getByRole("separator", { name: /Resize name rail/ });
    fireEvent.pointerDown(handle, { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 0 });
    fireEvent.pointerUp(window);
    expect(onLabelWidthChange).toHaveBeenCalledWith(160);
  });

  it("resets the rail to 300px on double-click", () => {
    const onLabelWidthChange = vi.fn();
    render(<GanttCanvas {...props({ labelWidth: 420, onLabelWidthChange })} />);
    fireEvent.doubleClick(
      screen.getByRole("separator", { name: /Resize name rail/ }),
    );
    expect(onLabelWidthChange).toHaveBeenCalledWith(300);
  });

  it("gives rail names a title with the full name", () => {
    render(<GanttCanvas {...props()} />);
    expect(
      screen.getByRole("heading", { level: 3, name: "Procurement" }),
    ).toHaveAttribute("title", "Procurement");
    const first = screen.getAllByTestId("gantt-row")[0]!;
    expect(within(first).getByTitle("PO raised")).toBeInTheDocument();
  });
});

describe("GanttCanvas today line and weekends", () => {
  it("draws the today hairline on section bands as well as item rows", () => {
    render(<GanttCanvas {...props()} />);
    // Range starts 2026-11-01; today is the 14th → day 13 × 10px.
    const band = screen.getByTestId("gantt-section");
    expect(band.querySelector("[data-today-line]")).toHaveStyle({
      left: "130px",
    });
    for (const row of screen.getAllByTestId("gantt-row")) {
      expect(row.querySelector("[data-today-line]")).toHaveStyle({
        left: "130px",
      });
    }
  });

  it("shades weekends on item and band tracks at month zoom, not at quarter", () => {
    const { rerender } = render(<GanttCanvas {...props()} />);
    expect(screen.getAllByTestId("gantt-track")[0]!.style.backgroundSize).toBe(
      "70px 100%",
    );
    expect(screen.getByTestId("gantt-section-track").style.backgroundSize).toBe(
      "70px 100%",
    );
    // 2026-11-01 is a Sunday: six days after Monday at 10px a day.
    expect(
      screen.getAllByTestId("gantt-track")[0]!.style.backgroundPosition,
    ).toBe("-60px 0px");
    rerender(<GanttCanvas {...props({ zoom: "quarter" })} />);
    expect(screen.getAllByTestId("gantt-track")[0]!.style.backgroundSize).toBe(
      "",
    );
  });
});

describe("GanttCanvas opens on today", () => {
  // jsdom has no layout. Give every element a 1300px client width so the
  // scroller measures a 1300 − 300 (rail) = 1000px track. Scoped to this block
  // and removed afterwards: the suites above rely on the unmeasured track.
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 1300,
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  });

  // 2026-05-01 → 2026-11-14 is 197 days. 400 days at month zoom overflows the
  // track, so the base scale (10px/day) holds and the grid scrolls.
  const wide = { rangeStartISO: "2026-05-01", dayCount: 400 };
  const scrollerOf = (container: HTMLElement) =>
    container.querySelector("[data-scroll-container]") as HTMLElement;

  it("parks today 34% across the track once the track has a width", () => {
    const { container } = render(<GanttCanvas {...props(wide)} />);
    expect(scrollerOf(container).scrollLeft).toBe(197 * 10 - 340);
  });

  it("does not move the viewport when the data changes", () => {
    const { container, rerender } = render(<GanttCanvas {...props(wide)} />);
    const scroller = scrollerOf(container);
    scroller.scrollLeft = 40; // the user scrolled away
    rerender(<GanttCanvas {...props({ ...wide, rows: rows.slice(0, 2) })} />);
    expect(scroller.scrollLeft).toBe(40);
    // An earlier item moved the range start: today's offset changes, the
    // viewport still must not jump.
    rerender(
      <GanttCanvas
        {...props({ rangeStartISO: "2026-04-01", dayCount: 430 })}
      />,
    );
    expect(scroller.scrollLeft).toBe(40);
  });

  it("re-centres on today when the zoom changes", () => {
    const { container, rerender } = render(<GanttCanvas {...props(wide)} />);
    const scroller = scrollerOf(container);
    scroller.scrollLeft = 40;
    rerender(<GanttCanvas {...props({ ...wide, zoom: "week" })} />);
    expect(scroller.scrollLeft).toBe(197 * 28 - 340);
  });

  it("leaves the viewport alone when today is outside the range", () => {
    const { container } = render(
      <GanttCanvas
        {...props({ rangeStartISO: "2027-01-01", dayCount: 400 })}
      />,
    );
    expect(scrollerOf(container).scrollLeft).toBe(0);
  });

  it("smooth-scrolls to today through the handle", () => {
    const handleRef = createRef<GanttCanvasHandle>();
    const { container } = render(
      <GanttCanvas {...props({ ...wide, handleRef })} />,
    );
    const scroller = scrollerOf(container);
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    act(() => handleRef.current?.scrollToToday());
    expect(scrollTo).toHaveBeenCalledWith({ left: 1630, behavior: "smooth" });
  });

  it("scrolls instantly through the handle under prefers-reduced-motion", () => {
    const handleRef = createRef<GanttCanvasHandle>();
    const { container } = render(
      <GanttCanvas {...props({ ...wide, handleRef })} />,
    );
    const scroller = scrollerOf(container);
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    try {
      act(() => handleRef.current?.scrollToToday());
    } finally {
      vi.unstubAllGlobals();
    }
    expect(scrollTo).toHaveBeenCalledWith({ left: 1630, behavior: "auto" });
  });

  it("falls back to an instant scroll where scrollTo is missing", () => {
    const handleRef = createRef<GanttCanvasHandle>();
    const { container } = render(
      <GanttCanvas {...props({ ...wide, handleRef })} />,
    );
    const scroller = scrollerOf(container);
    scroller.scrollLeft = 0;
    act(() => handleRef.current?.scrollToToday());
    expect(scroller.scrollLeft).toBe(1630);
  });
});

describe("GanttCanvas bar labels", () => {
  // jsdom has no canvas. Stand in a measurer of 7px per character so the fit
  // decision is exercised; "PO raised" is 63px, "Delivery" 56px.
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (t: string) => ({ width: t.length * 7 }),
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  const firstRow = () => screen.getAllByTestId("gantt-row")[0]!;

  it("drops a name that does not fit and shows the end date beside the bar", () => {
    render(<GanttCanvas {...props()} />);
    // i1 is 5 days x 10px = 50px; the name needs 63 + 16 + 8. Rail only now.
    expect(screen.getAllByText("PO raised")).toHaveLength(1);
    const meta = within(firstRow()).getByTestId("gantt-bar-meta");
    expect(meta).toHaveTextContent("Nov 5");
    expect(meta).toHaveStyle({ left: "56px" }); // bar end 50 + 6px gap
    expect(meta).toHaveClass("text-muted-foreground");
    // The bar still names itself to assistive tech.
    expect(screen.getByLabelText("PO raised")).toBeInTheDocument();
  });

  it("keeps the name inside a bar that is wide enough", () => {
    const wide: GanttRow[] = [
      { ...rows[1]!, spanCols: 20, endISO: "2026-11-20" },
    ];
    render(<GanttCanvas {...props({ rows: wide, dependencies: [] })} />);
    expect(screen.getAllByText("PO raised")).toHaveLength(2);
    expect(screen.queryByTestId("gantt-bar-meta")).not.toBeInTheDocument();
  });

  it("marks a late bar with the destructive border and an 'Nd late' label", () => {
    render(
      <GanttCanvas
        {...props({ lateFor: (r) => (r.itemId === "i1" ? 21 : null) })}
      />,
    );
    // The bar's accessible name carries the lateness too.
    const handle = screen.getByLabelText("PO raised, 21d late");
    const bar = handle.parentElement as HTMLElement;
    expect(bar).toHaveClass("border", "border-destructive");
    const meta = within(firstRow()).getByTestId("gantt-bar-meta");
    expect(meta).toHaveTextContent("21d late");
    expect(meta).toHaveClass("text-destructive");
    // Its on-time neighbour is untouched.
    expect(screen.getByLabelText("Delivery").parentElement).not.toHaveClass(
      "border-destructive",
    );
  });

  it("gives a late milestone the border and the label too", () => {
    const dot: GanttRow[] = [
      {
        itemId: "m1",
        name: "Gate",
        scheduled: true,
        isMilestone: true,
        startCol: 10,
        spanCols: 1,
        startISO: "2026-11-11",
        endISO: "2026-11-11",
      },
    ];
    render(
      <GanttCanvas
        {...props({ rows: dot, dependencies: [], lateFor: () => 3 })}
      />,
    );
    const diamond = screen.getByLabelText("Gate, 3d late");
    expect(diamond).toHaveClass("border-destructive");
    expect(diamond).toHaveAttribute("title", "Gate, 3d late");
    expect(screen.getByTestId("gantt-bar-meta")).toHaveTextContent("3d late");
  });

  it("hides the label beside the bar while the bar is being resized", () => {
    HTMLElement.prototype.setPointerCapture = () => {};
    render(<GanttCanvas {...props()} />);
    expect(
      within(firstRow()).getByTestId("gantt-bar-meta"),
    ).toBeInTheDocument();
    const handle = screen.getByLabelText("Resize PO raised");
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 130, pointerId: 1 });
    expect(
      within(firstRow()).queryByTestId("gantt-bar-meta"),
    ).not.toBeInTheDocument();
  });

  it("leaves the after side to link stubs", () => {
    // The waiting-on stub flips after i1 (it starts at the track edge), and
    // there is no room before a bar that starts at x = 0.
    render(
      <GanttCanvas
        {...props({ externalLinks: new Map([["i1", [stub()]]]) })}
      />,
    );
    expect(
      within(firstRow()).queryByTestId("gantt-bar-meta"),
    ).not.toBeInTheDocument();
  });
});

describe("GanttCanvas section summaries and group bands", () => {
  const groupBand = (summary?: GanttRow["summary"]): GanttRow => ({
    itemId: "group:g1",
    name: "Phase 1",
    scheduled: false,
    kind: "section",
    level: 1,
    ...(summary ? { summary } : {}),
  });
  // Row order: 0 board band, 1 group band, 2 i1, 3 i2.
  const grouped = (summary?: GanttRow["summary"]): GanttRow[] => [
    rows[0]!,
    groupBand(summary),
    rows[1]!,
    rows[2]!,
  ];
  const full = { startCol: 2, spanCols: 10, donePct: 35, lateCount: 8 };
  const bandOf = (name: string) =>
    screen
      .getByRole("heading", { name })
      .closest('[data-testid="gantt-section"]') as HTMLElement;

  it("makes a group band a toggle too when onToggleExpand is given", () => {
    const onToggleExpand = vi.fn();
    render(
      <GanttCanvas
        {...props({
          rows: grouped(full),
          onToggleExpand,
          isExpanded: () => true,
        })}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Collapse Phase 1" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle.className).toContain("pointer-coarse:h-11");
    fireEvent.click(toggle);
    expect(onToggleExpand).toHaveBeenCalledWith("group:g1");
  });

  it("leaves a group band a plain level-4 heading without onToggleExpand", () => {
    render(<GanttCanvas {...props({ rows: grouped(full) })} />);
    expect(
      screen.getByRole("heading", { level: 4, name: "Phase 1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Phase 1/ }),
    ).not.toBeInTheDocument();
  });

  it("draws the summary span, its done share and the meta text", () => {
    render(<GanttCanvas {...props({ rows: grouped(full) })} />);
    const band = bandOf("Phase 1");
    // Day 2 → 20px; 10 days × 10px.
    expect(within(band).getByTestId("gantt-summary")).toHaveStyle({
      left: "20px",
      width: "100px",
    });
    expect(within(band).getByTestId("gantt-summary-fill")).toHaveStyle({
      width: "35%",
    });
    expect(within(band).getByTestId("gantt-section-meta")).toHaveTextContent(
      "35% · 8 late",
    );
  });

  it("gives the band a text equivalent of the summary bar", () => {
    render(
      <GanttCanvas
        {...props({
          rows: grouped(full),
          onToggleExpand: vi.fn(),
          isExpanded: () => true,
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Collapse Phase 1" }),
    ).toHaveAccessibleDescription("35% done, 8 late");
  });

  it("draws an unknown-progress span without a fill or meta text", () => {
    render(
      <GanttCanvas
        {...props({
          rows: grouped({ ...full, donePct: null, lateCount: null }),
        })}
      />,
    );
    const band = bandOf("Phase 1");
    expect(within(band).getByTestId("gantt-summary")).toBeInTheDocument();
    expect(
      within(band).queryByTestId("gantt-summary-fill"),
    ).not.toBeInTheDocument();
    expect(
      within(band).queryByTestId("gantt-section-meta"),
    ).not.toBeInTheDocument();
  });

  it("omits the late part when nothing is late", () => {
    render(
      <GanttCanvas
        {...props({ rows: grouped({ ...full, donePct: 100, lateCount: 0 }) })}
      />,
    );
    const meta = within(bandOf("Phase 1")).getByTestId("gantt-section-meta");
    expect(meta).toHaveTextContent("100%");
    expect(meta).not.toHaveTextContent("late");
  });

  it("draws no summary on a band that has none", () => {
    render(<GanttCanvas {...props({ rows: grouped(full) })} />);
    expect(
      within(bandOf("Procurement")).queryByTestId("gantt-summary"),
    ).not.toBeInTheDocument();
  });

  it("keeps every band one row tall and arrows on the right rows", () => {
    const { container } = render(
      <GanttCanvas {...props({ rows: grouped(full) })} />,
    );
    for (const band of screen.getAllByTestId("gantt-section")) {
      expect(band).toHaveStyle({ height: "32px" });
    }
    // i1 is row 2, i2 row 3. Rail 300px, 10px/day, 32px rows:
    // from (300 + 5×10, 2×32 + 16) to (300 + 6×10, 3×32 + 16).
    expect(
      container.querySelector("svg path[marker-end]")?.getAttribute("d"),
    ).toBe("M350,80 C355,80 355,112 360,112");
  });
});
