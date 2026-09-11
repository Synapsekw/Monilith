import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const touchBoardVisit = vi.fn(async () => ({
  ok: true as const,
  data: undefined,
}));
vi.mock("./visit-actions", () => ({
  touchBoardVisit: (...a: unknown[]) => touchBoardVisit(...(a as [])),
}));

import { useBoardVisitTouch } from "./use-board-visit";

const BOARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => touchBoardVisit.mockClear());
afterEach(() => setVisibility("visible"));

describe("useBoardVisitTouch", () => {
  it("writes once when the tab is hidden, and not again until it was visible", () => {
    renderHook(() => useBoardVisitTouch(BOARD));
    expect(touchBoardVisit).not.toHaveBeenCalled();

    act(() => setVisibility("hidden"));
    expect(touchBoardVisit).toHaveBeenCalledTimes(1);
    expect(touchBoardVisit).toHaveBeenCalledWith(BOARD);

    act(() => setVisibility("hidden"));
    expect(touchBoardVisit).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    act(() => setVisibility("hidden"));
    expect(touchBoardVisit).toHaveBeenCalledTimes(2);
  });

  it("writes on unmount when the visit has not been stamped yet", () => {
    const { unmount } = renderHook(() => useBoardVisitTouch(BOARD));
    unmount();
    expect(touchBoardVisit).toHaveBeenCalledTimes(1);
  });

  it("does not write twice when hidden then unmounted", () => {
    const { unmount } = renderHook(() => useBoardVisitTouch(BOARD));
    act(() => setVisibility("hidden"));
    unmount();
    expect(touchBoardVisit).toHaveBeenCalledTimes(1);
  });

  it("is inert when disabled (offline replay)", () => {
    const { unmount } = renderHook(() => useBoardVisitTouch(BOARD, false));
    act(() => setVisibility("hidden"));
    unmount();
    expect(touchBoardVisit).not.toHaveBeenCalled();
  });

  it("swallows a rejected write", async () => {
    touchBoardVisit.mockRejectedValueOnce(new Error("offline"));
    const { unmount } = renderHook(() => useBoardVisitTouch(BOARD));
    expect(() => unmount()).not.toThrow();
    await Promise.resolve();
  });
});
