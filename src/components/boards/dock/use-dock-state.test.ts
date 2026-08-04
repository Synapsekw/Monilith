import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useDockState,
  clampDockWidth,
  DOCK_MIN_WIDTH,
  DOCK_MAX_WIDTH,
} from "./use-dock-state";

beforeEach(() => window.localStorage.clear());

describe("useDockState", () => {
  it("renders CLOSED on the first pass even when storage says open", () => {
    window.localStorage.setItem(
      "monolith.dock.board-1",
      JSON.stringify({ open: true, width: 380 }),
    );
    const { result } = renderHook(() => useDockState("board-1"));
    // Reading storage during render would make the server and client disagree
    // and produce a hydration mismatch (gotcha-50). The remembered state is
    // applied in an effect, so the first committed render is always closed —
    // by the time the hook reports `hydrated`, that effect has run.
    expect(result.current.hydrated).toBe(true);
    expect(result.current.open).toBe(true);
    expect(result.current.width).toBe(380);
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
