import { describe, expect, it } from "vitest";
import {
  candidateNativeIds,
  isDatedSnapshotOf,
  stripDateSuffix,
} from "@/lib/ai/models/model-ids";

/**
 * The shared seam. Two consumers read the same rule in opposite directions —
 * `verify-ids` asks "does anything in the provider's list extend my candidate
 * with a date?", `pricing` asks "what is this native id without its date?" —
 * so the tests below pin the rule itself rather than either caller.
 */
describe("model-ids", () => {
  it("proposes the hyphenated form of a dotted Gateway id, and nothing else", () => {
    expect(candidateNativeIds("claude-haiku-4.5")).toEqual([
      "claude-haiku-4.5",
      "claude-haiku-4-5",
    ]);
    // No dot, no second candidate — never a bare-prefix guess.
    expect(candidateNativeIds("gpt-4o")).toEqual(["gpt-4o"]);
  });

  it("strips ONLY an 8-digit trailing date", () => {
    expect(stripDateSuffix("claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5",
    );
    expect(stripDateSuffix("gpt-4-turbo")).toBe("gpt-4-turbo");
    expect(stripDateSuffix("claude-opus-4-8")).toBe("claude-opus-4-8");
    // Not 8 digits, so not a date.
    expect(stripDateSuffix("model-2025")).toBe("model-2025");
  });

  it("recognises a dated snapshot in the forward direction too", () => {
    expect(
      isDatedSnapshotOf("claude-haiku-4-5", "claude-haiku-4-5-20251001"),
    ).toBe(true);
    // A bare prefix is never enough: gpt-4 must not claim gpt-4o.
    expect(isDatedSnapshotOf("gpt-4", "gpt-4o")).toBe(false);
    expect(isDatedSnapshotOf("gpt-4", "gpt-4-turbo")).toBe(false);
    // An identical id is an exact match, not a snapshot of itself — the
    // callers handle exact matches first and must not double-count them.
    expect(isDatedSnapshotOf("claude-opus-5", "claude-opus-5")).toBe(false);
  });
});
