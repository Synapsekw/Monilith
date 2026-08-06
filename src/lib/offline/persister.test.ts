import { describe, expect, it } from "vitest";
import { isPersistableKey } from "./persister";

describe("isPersistableKey", () => {
  it("persists the board snapshot", () => {
    expect(isPersistableKey(["boardSnapshot", "abc"])).toBe(true);
  });

  it("refuses everything not on the allowlist", () => {
    // Persisting these would write AI conversation text, widget aggregations
    // and notification bodies to disk for a capability that only needs boards.
    expect(isPersistableKey(["board", "abc"])).toBe(false);
    expect(isPersistableKey(["notifications", "u1"])).toBe(false);
    expect(isPersistableKey(["agent-runs", "a1"])).toBe(false);
    expect(isPersistableKey(["widget-data", "w1"])).toBe(false);
  });

  it("refuses a non-string first segment", () => {
    expect(isPersistableKey([42])).toBe(false);
    expect(isPersistableKey([])).toBe(false);
  });
});
