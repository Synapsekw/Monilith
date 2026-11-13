import { describe, expect, it } from "vitest";
import { estimateTokens } from "./estimate-tokens";

describe("estimateTokens", () => {
  it("rounds characters / 4 up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
