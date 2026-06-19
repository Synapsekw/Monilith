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
});
