import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Same shape as the `searchParamsOverride` mock in BoardTable.test.tsx: the
// factory closes over a mutable flag that is read at call time.
let coarse = false;
vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: () => coarse,
}));

import { COARSE_ROW_HEIGHT, ROW_HEIGHT, SUBITEM_ROW_HEIGHT } from "./shared";
import { useRowHeight } from "./use-row-height";

describe("useRowHeight", () => {
  beforeEach(() => {
    coarse = false;
  });

  it("returns the dense heights on a fine pointer", () => {
    const { result } = renderHook(() => useRowHeight());
    expect(result.current).toEqual({
      item: ROW_HEIGHT,
      subitem: SUBITEM_ROW_HEIGHT,
    });
  });

  it("returns 44px for item and subitem rows on a coarse pointer", () => {
    coarse = true;
    const { result } = renderHook(() => useRowHeight());
    expect(result.current).toEqual({
      item: COARSE_ROW_HEIGHT,
      subitem: COARSE_ROW_HEIGHT,
    });
    expect(COARSE_ROW_HEIGHT).toBe(44);
  });

  it("keeps one object identity per pointer type across renders", () => {
    const { result, rerender } = renderHook(() => useRowHeight());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
