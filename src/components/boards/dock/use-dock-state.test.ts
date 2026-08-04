import { describe, it, expect, beforeEach } from "vitest";
import { createElement } from "react";
import { render, renderHook, act } from "@testing-library/react";
import {
  useDockState,
  clampDockWidth,
  DOCK_MIN_WIDTH,
  DOCK_MAX_WIDTH,
} from "./use-dock-state";

beforeEach(() => window.localStorage.clear());

/** Every value the hook has ever returned, oldest first. `renderHook` only
 *  exposes the LATEST one, which is exactly the render this constraint is not
 *  about. */
function recordRenders(boardId: string) {
  const seen: { open: boolean; width: number; hydrated: boolean }[] = [];
  function Probe() {
    const s = useDockState(boardId);
    seen.push({ open: s.open, width: s.width, hydrated: s.hydrated });
    return null;
  }
  render(createElement(Probe));
  return seen;
}

describe("useDockState", () => {
  it("commits its FIRST render closed, even when storage says open", () => {
    window.localStorage.setItem(
      "monolith.dock.board-1",
      JSON.stringify({ open: true, width: 380 }),
    );
    const seen = recordRenders("board-1");

    // THE constraint (gotcha-50): a hook that seeded useState from
    // localStorage during render would emit `open: true` on render 0, and the
    // server — which has no localStorage — would have emitted `false`. That
    // disagreement is the hydration mismatch. Asserting only the settled value
    // (as an earlier version of this test did) passes either way, which makes
    // it no guard at all.
    expect(seen[0]).toEqual({
      open: false,
      width: DOCK_MIN_WIDTH,
      hydrated: false,
    });
    // The remembered state arrives afterwards, from the effect.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toEqual({ open: true, width: 380, hydrated: true });
  });

  it("persists open state per board", () => {
    const { result } = renderHook(() => useDockState("board-1"));
    act(() => result.current.setOpen(true));
    expect(
      JSON.parse(window.localStorage.getItem("monolith.dock.board-1")!).open,
    ).toBe(true);
    expect(window.localStorage.getItem("monolith.dock.board-2")).toBeNull();
  });

  it("clamps a width outside the allowed range", () => {
    const { result } = renderHook(() => useDockState("board-1"));
    act(() => result.current.setWidth(10_000));
    expect(result.current.width).toBe(DOCK_MAX_WIDTH);
    act(() => result.current.setWidth(1));
    expect(result.current.width).toBe(DOCK_MIN_WIDTH);
  });

  it("survives corrupt stored JSON", () => {
    window.localStorage.setItem("monolith.dock.board-1", "{not json");
    const { result } = renderHook(() => useDockState("board-1"));
    expect(result.current.open).toBe(false);
    expect(result.current.width).toBe(DOCK_MIN_WIDTH);
  });

  it("clamps through one shared helper, so the drag cannot invent a range", () => {
    expect(clampDockWidth(DOCK_MIN_WIDTH - 50)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(DOCK_MAX_WIDTH + 50)).toBe(DOCK_MAX_WIDTH);
    expect(clampDockWidth(400.6)).toBe(401);
  });
});
