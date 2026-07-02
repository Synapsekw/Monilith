import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnHeader } from "@/components/boards/ColumnHeader";
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
    expect(onResize).toHaveBeenCalledWith(240); // 180 + (260-200)
    fireEvent(window, new Event("pointerup"));
    expect(onResizeEnd).toHaveBeenCalledWith(240);
  });
});
