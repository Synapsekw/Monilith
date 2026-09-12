import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DockSeam } from "./DockSeam";
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from "./use-dock-state";

function mount(open: boolean) {
  const handlers = {
    onToggle: vi.fn(),
    onResizeStart: vi.fn(),
    onResizeStep: vi.fn(),
  };
  render(
    <>
      {/* The shell's slot on the content card (app-shell.tsx). */}
      <div id="card-seam-slot" />
      <DockSeam open={open} width={360} {...handlers} />
    </>,
  );
  const cap = screen.getByRole("button", {
    name: open ? /close agent dock/i : /open agent dock/i,
  });
  return { ...handlers, cap, strip: cap.parentElement as HTMLElement };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("DockSeam", () => {
  it("renders onto the card, not into the dock", () => {
    mount(false);
    const seam = document.querySelector('[data-seam="right"]');
    expect(seam?.closest("#card-seam-slot")).not.toBeNull();
  });

  it("claims no separator role while there is no width to drag", () => {
    // A closed dock cannot be resized; a separator announcing a value range it
    // will not honour is worse than no separator at all.
    const closed = mount(false);
    expect(screen.queryByRole("separator")).toBeNull();
    expect(closed.cap).toHaveAttribute("aria-expanded", "false");
  });

  it("announces the width it can be dragged to while open", () => {
    const open = mount(true);
    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("aria-valuenow", "360");
    expect(separator).toHaveAttribute("aria-valuemin", String(DOCK_MIN_WIDTH));
    expect(separator).toHaveAttribute("aria-valuemax", String(DOCK_MAX_WIDTH));
    expect(separator).toHaveAttribute("tabindex", "0");
    expect(open.cap).toHaveAttribute("aria-expanded", "true");
  });

  it("folds once — not twice — when the cap is clicked", () => {
    // The cap is nested INSIDE the strip, which also folds on click. Without
    // the cap stopping its own click, the strip's handler folds it right back.
    const { cap, onToggle } = mount(true);
    fireEvent.click(cap);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("folds when the edge itself is clicked", () => {
    const { strip, onToggle } = mount(false);
    fireEvent.click(strip);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("resizes on a drag, and that drag never also folds", () => {
    const { strip, onToggle, onResizeStart } = mount(true);

    fireEvent.pointerDown(strip, { clientX: 700 });
    expect(onResizeStart).toHaveBeenCalledTimes(1);
    // The drag ends 40px away — far past the slop that separates a click from
    // a resize. The browser still fires a click afterwards; it must be eaten.
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 660 }));
    fireEvent.click(strip);

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("still folds when a click wobbles by a pixel", () => {
    const { strip, onToggle } = mount(true);
    fireEvent.pointerDown(strip, { clientX: 700 });
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: 701 }));
    fireEvent.click(strip);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("never starts a resize on a closed dock", () => {
    const { strip, onResizeStart, onToggle } = mount(false);
    fireEvent.pointerDown(strip, { clientX: 700 });
    expect(onResizeStart).not.toHaveBeenCalled();
    fireEvent.click(strip);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("steps the width with the arrow keys, in the direction of the drag", () => {
    const { strip, onResizeStep } = mount(true);
    // The dock is on the RIGHT, so leftwards widens it — same as dragging.
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(onResizeStep).toHaveBeenCalledWith(1);
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(onResizeStep).toHaveBeenCalledWith(-1);
  });

  it("ignores the arrow keys while closed", () => {
    const { strip, onResizeStep } = mount(false);
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(onResizeStep).not.toHaveBeenCalled();
  });

  it("carries the marker the dock focuses after a fold", () => {
    // BoardDock hands focus back to this button on close, and looks it up by
    // this attribute — the seam is portalled, so it cannot scope to the aside.
    const { cap } = mount(true);
    expect(cap).toHaveAttribute("data-dock-seam-toggle");
  });
});
