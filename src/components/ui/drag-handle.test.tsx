import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DragHandle } from "./drag-handle";

test("renders an accessible button with a coarse-pointer 44px target", () => {
  render(<DragHandle />);
  const handle = screen.getByRole("button", { name: "Drag to reorder" });
  // size-11 == 44px (2.75rem) — only applied under (pointer: coarse).
  expect(handle.className).toContain("pointer-coarse:size-11");
  // touch-action:none so dragging from the handle never scrolls the page.
  expect(handle.className).toContain("touch-none");
});

test("forwards dnd-kit listeners/attributes (e.g. onPointerDown)", () => {
  const onPointerDown = vi.fn();
  render(<DragHandle onPointerDown={onPointerDown} />);
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Drag to reorder" }),
  );
  expect(onPointerDown).toHaveBeenCalledTimes(1);
});

test("accepts a custom aria-label", () => {
  render(<DragHandle aria-label="Resize column" />);
  expect(
    screen.getByRole("button", { name: "Resize column" }),
  ).toBeInTheDocument();
});
