import { beforeEach, describe, expect, it } from "vitest";
import { useBoardSelection } from "./board-selection";

function reset() {
  useBoardSelection.setState({
    selectedIds: new Set<string>(),
    anchorId: null,
    orderedIds: [],
  });
}

const s = () => useBoardSelection.getState();

describe("board-selection store", () => {
  beforeEach(reset);

  it("toggles a single id on and off, tracking the anchor", () => {
    s().toggle("a");
    expect(s().selectedIds.has("a")).toBe(true);
    expect(s().anchorId).toBe("a");
    s().toggle("a");
    expect(s().selectedIds.has("a")).toBe(false);
  });

  it("shift-toggle selects the inclusive range between anchor and target", () => {
    s().setOrderedIds(["a", "b", "c", "d", "e"]);
    s().toggle("b"); // anchor = b
    s().toggle("d", true); // range b..d
    expect([...s().selectedIds].sort()).toEqual(["b", "c", "d"]);
    // Anchor is preserved so the range can be extended.
    expect(s().anchorId).toBe("b");
  });

  it("shift-toggle resolves the range regardless of click direction", () => {
    s().setOrderedIds(["a", "b", "c", "d"]);
    s().toggle("d");
    s().toggle("a", true); // reverse direction
    expect([...s().selectedIds].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("shift without an anchor falls back to a plain toggle", () => {
    s().setOrderedIds(["a", "b"]);
    s().toggle("b", true);
    expect([...s().selectedIds]).toEqual(["b"]);
  });

  it("setSelected adds and removes a batch (group select-all / deselect)", () => {
    s().setSelected(["a", "b", "c"], true);
    expect(s().selectedIds.size).toBe(3);
    s().setSelected(["a", "b"], false);
    expect([...s().selectedIds]).toEqual(["c"]);
  });

  it("clear removes everything and drops the anchor", () => {
    s().setSelected(["a", "b"], true);
    s().clear();
    expect(s().selectedIds.size).toBe(0);
    expect(s().anchorId).toBeNull();
  });

  it("creates a fresh Set on each mutation (immutability for React subscribers)", () => {
    const before = s().selectedIds;
    s().toggle("a");
    expect(s().selectedIds).not.toBe(before);
  });
});
