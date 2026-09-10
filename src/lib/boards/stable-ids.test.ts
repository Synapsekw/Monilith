import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStableIds } from "@/lib/boards/stable-ids";

describe("useStableIds", () => {
  it("keeps the previous array when the ids are content-equal", () => {
    const first = ["a", "b"];
    const { result, rerender } = renderHook(({ ids }) => useStableIds(ids), {
      initialProps: { ids: first },
    });
    expect(result.current).toBe(first);

    rerender({ ids: ["a", "b"] });

    expect(result.current).toBe(first);
  });

  it("adopts the new array when the ids change", () => {
    const { result, rerender } = renderHook(({ ids }) => useStableIds(ids), {
      initialProps: { ids: ["a", "b"] },
    });
    const next = ["a", "c"];

    rerender({ ids: next });

    expect(result.current).toBe(next);
  });

  it("adopts the new array when an id is appended", () => {
    const { result, rerender } = renderHook(({ ids }) => useStableIds(ids), {
      initialProps: { ids: ["a"] },
    });

    rerender({ ids: ["a", "b"] });

    expect(result.current).toEqual(["a", "b"]);
  });
});

describe("useStableIds identity is per hook instance", () => {
  it("does not leak one consumer's array into another's", () => {
    const a = renderHook(({ ids }) => useStableIds(ids), {
      initialProps: { ids: ["a"] },
    });
    const b = renderHook(({ ids }) => useStableIds(ids), {
      initialProps: { ids: ["a"] },
    });

    expect(a.result.current).not.toBe(b.result.current);
    expect(a.result.current).toEqual(b.result.current);
  });
});
