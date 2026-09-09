import { describe, expect, it } from "vitest";
import { isOptimisticId, newOptimisticId } from "./optimistic-id";

describe("optimistic ids", () => {
  it("mints a recognisably non-uuid temp id", () => {
    const id = newOptimisticId();
    expect(isOptimisticId(id)).toBe(true);
    expect(id.startsWith("optimistic-")).toBe(true);
  });

  it("mints a distinct id per call", () => {
    expect(newOptimisticId()).not.toBe(newOptimisticId());
  });

  it("does not treat a server uuid as optimistic", () => {
    expect(isOptimisticId("11111111-1111-4111-8111-111111111111")).toBe(false);
  });
});
