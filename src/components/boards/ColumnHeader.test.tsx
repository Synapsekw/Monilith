import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  ColumnHeader,
  type ColumnReorder,
} from "@/components/boards/ColumnHeader";
import type { CacheColumn } from "@/lib/boards/cache";

function col(over: Partial<CacheColumn> = {}): CacheColumn {
  return {
    id: "c1",
    org_id: "o",
    board_id: "b",
    kind: "text",
    name: "Notes",
    settings: {},
    position: 0,
    width: null,
    created_at: "2026-06-17T00:00:00Z",
    updated_at: "2026-06-17T00:00:00Z",
    ...over,
  } as CacheColumn;
}

describe("ColumnHeader", () => {
  it("renames via the menu → inline input → Enter", () => {
    const onRename = vi.fn();
    render(
      <ColumnHeader
        column={col()}
        width={180}
        onRename={onRename}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByLabelText("Column name");
    fireEvent.change(input, { target: { value: "Priority" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Priority");
  });

  it("shows 'Edit labels' for an option-bearing column and fires onEditOptions", () => {
    const onEditOptions = vi.fn();
    render(
      <ColumnHeader
        column={col({ kind: "status", name: "Status" })}
        width={180}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
        onEditOptions={onEditOptions}
      />,
    );
    fireEvent.click(screen.getByLabelText("Status column menu"));
    fireEvent.click(screen.getByText("Edit labels"));
    expect(onEditOptions).toHaveBeenCalledTimes(1);
  });

  it("hides 'Edit labels' for a column kind without options", () => {
    render(
      <ColumnHeader
        column={col({ kind: "text", name: "Notes" })}
        width={180}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
        onEditOptions={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    expect(screen.queryByText("Edit labels")).not.toBeInTheDocument();
  });

  it("offers 'Change currency' for currency columns only and fires onEditCurrency", () => {
    const onEditCurrency = vi.fn();
    render(
      <ColumnHeader
        column={col({ kind: "currency" as never, name: "Budget" })}
        width={180}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
        onEditCurrency={onEditCurrency}
      />,
    );
    fireEvent.click(screen.getByLabelText("Budget column menu"));
    fireEvent.click(screen.getByText("Change currency"));
    expect(onEditCurrency).toHaveBeenCalledTimes(1);
  });

  it("hides 'Change currency' for non-currency columns", () => {
    render(
      <ColumnHeader
        column={col({ kind: "text", name: "Notes" })}
        width={180}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
        onEditCurrency={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    expect(screen.queryByText("Change currency")).not.toBeInTheDocument();
  });

  it("confirms before delete", () => {
    const onDelete = vi.fn();
    render(
      <ColumnHeader
        column={col()}
        width={180}
        onRename={vi.fn()}
        onDelete={onDelete}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).not.toHaveBeenCalled(); // dialog open, not yet confirmed
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });

  // ── TOUCH Batch-2 (iPad) ────────────────────────────────────────────────
  it("gives the resize separator a ≥44px coarse hit area + touch-none, keeping a 4px visible line", () => {
    render(
      <ColumnHeader
        column={col()}
        width={180}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    const handle = screen.getByRole("separator", { name: "Resize Notes" });
    // Desktop: still a 4px (w-1) line.
    expect(handle.className).toContain("w-1");
    // Coarse: 44px-wide hit band centred on the edge, no scroll-hijack.
    expect(handle.className).toContain("pointer-coarse:w-11");
    expect(handle.className).toContain("pointer-coarse:-right-5");
    expect(handle.className).toContain("touch-none");
    // The visible feedback moved to a 4px `before:` pseudo so the line stays 4px.
    expect(handle.className).toContain("before:w-1");
  });

  it("makes the column menu trigger always-visible + 44px on coarse pointers", () => {
    render(
      <ColumnHeader
        column={col()}
        width={180}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    const menu = screen.getByLabelText("Notes column menu");
    expect(menu.className).toContain("pointer-coarse:opacity-100");
    expect(menu.className).toContain("pointer-coarse:size-11");
    // Mouse hover-reveal preserved.
    expect(menu.className).toContain("group-hover/col:opacity-100");
  });

  it("still runs the resize pointer-event logic (regression): drag persists the clamped width", () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    render(
      <ColumnHeader
        column={col()}
        width={180}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    );
    const handle = screen.getByRole("separator", { name: "Resize Notes" });
    fireEvent.pointerDown(handle, { clientX: 200 });
    // window-level move/up listeners drive the live + commit callbacks.
    fireEvent(
      window,
      new (class extends Event {
        clientX = 260;
        constructor() {
          super("pointermove");
        }
      })(),
    );
    // Live updates are frame-throttled, so nothing is sent synchronously on
    // the move; the release flushes the final width before persisting it.
    expect(onResize).not.toHaveBeenCalled();
    fireEvent(window, new Event("pointerup"));
    expect(onResize).toHaveBeenCalledWith(240); // 180 + (260-200)
    expect(onResizeEnd).toHaveBeenCalledWith(240);
  });
});

function reorder(over: Partial<ColumnReorder> = {}): ColumnReorder {
  return {
    setNodeRef: () => {},
    style: {},
    isDragging: false,
    handleAttributes: {} as ColumnReorder["handleAttributes"],
    handleListeners: undefined,
    onMoveLeft: vi.fn(),
    onMoveRight: vi.fn(),
    ...over,
  };
}

describe("ColumnHeader reorder affordances", () => {
  const base = {
    width: 180,
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onResize: vi.fn(),
    onResizeEnd: vi.fn(),
  };

  it("renders a reorder grip when reorder props are provided", () => {
    render(<ColumnHeader column={col()} {...base} reorder={reorder()} />);
    expect(
      screen.getByRole("button", { name: "Reorder Notes column" }),
    ).toBeInTheDocument();
  });

  it("renders no grip and no move items without reorder props", () => {
    render(<ColumnHeader column={col()} {...base} />);
    expect(
      screen.queryByRole("button", { name: "Reorder Notes column" }),
    ).toBeNull();
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    expect(screen.queryByText("Move left")).toBeNull();
  });

  it("fires onMoveRight from the menu", () => {
    const onMoveRight = vi.fn();
    render(
      <ColumnHeader
        column={col()}
        {...base}
        reorder={reorder({ onMoveRight })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    fireEvent.click(screen.getByText("Move right"));
    expect(onMoveRight).toHaveBeenCalledTimes(1);
  });

  it("disables Move left at the left edge", () => {
    render(
      <ColumnHeader
        column={col()}
        {...base}
        reorder={reorder({ onMoveLeft: null })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Notes column menu"));
    expect(
      screen.getByText("Move left").closest("[role=menuitem]"),
    ).toHaveAttribute("aria-disabled", "true");
  });
});

describe("ColumnHeader — Quiet Grid", () => {
  it("paints no vertical rule and pads to 16px", () => {
    const { container } = render(
      <ColumnHeader
        column={col()}
        width={200}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    const header = container.firstElementChild as HTMLElement;
    expect(header.className).not.toMatch(/\bborder-l\b/);
    expect(header.className).toContain("px-4");
  });

  it("dims the column kicker", () => {
    render(
      <ColumnHeader
        column={col({ name: "Budget" })}
        width={200}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    expect(screen.getByText("Budget").className).toContain("opacity-[0.74]");
  });
});

describe("ColumnHeader — resize is frame-throttled", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    render(
      <ColumnHeader
        column={col()}
        width={180}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    );
    const handle = screen.getByLabelText("Resize Notes");
    return { onResize, onResizeEnd, handle };
  }
  function move(clientX: number) {
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX }));
    });
  }
  function release() {
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
  }

  it("coalesces the moves within one frame into a single live update", () => {
    const { onResize, handle } = setup();
    fireEvent.pointerDown(handle, { clientX: 100 });
    move(110);
    move(120);
    move(130);
    expect(onResize).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersToNextFrame());
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(210);
  });

  it("applies and persists the final width on release, with no stale trailing frame", () => {
    const { onResize, onResizeEnd, handle } = setup();
    fireEvent.pointerDown(handle, { clientX: 100 });
    move(110);
    act(() => void vi.advanceTimersToNextFrame());
    move(140); // still waiting on its frame when the pointer lifts
    release();
    expect(onResize).toHaveBeenLastCalledWith(220);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledWith(220);
    const calls = onResize.mock.calls.length;
    act(() => void vi.advanceTimersToNextFrame());
    expect(onResize).toHaveBeenCalledTimes(calls);
  });

  it("a click on the handle without a move sends no live update", () => {
    const { onResize, onResizeEnd, handle } = setup();
    fireEvent.pointerDown(handle, { clientX: 100 });
    release();
    act(() => void vi.advanceTimersToNextFrame());
    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).toHaveBeenCalledWith(180);
  });
});
