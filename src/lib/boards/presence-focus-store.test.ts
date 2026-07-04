import { afterEach, describe, expect, it } from "vitest";
import { mergeFocusMap, usePresenceFocusStore } from "./presence-focus-store";
import type { RosterOccupant } from "./presence-types";

const occ = (userId: string, color = "#111", name = "N"): RosterOccupant => ({
  userId,
  name,
  avatarUrl: null,
  color,
  isSelf: false,
});

afterEach(() => usePresenceFocusStore.getState().reset());

describe("mergeFocusMap", () => {
  it("returns the previous map when nothing changed (stable identity)", () => {
    const prev = new Map([["cell:a", [occ("u1")]]]);
    const next = new Map([["cell:a", [occ("u1")]]]);
    expect(mergeFocusMap(prev, next)).toBe(prev);
  });

  it("preserves per-target array identity for unchanged targets", () => {
    const aOcc = [occ("u1")];
    const prev = new Map([
      ["cell:a", aOcc],
      ["cell:b", [occ("u2")]],
    ]);
    // cell:a unchanged (by value), cell:b gains a second occupant.
    const next = new Map([
      ["cell:a", [occ("u1")]],
      ["cell:b", [occ("u2"), occ("u3")]],
    ]);
    const merged = mergeFocusMap(prev, next);
    expect(merged).not.toBe(prev); // something changed → new map
    expect(merged.get("cell:a")).toBe(aOcc); // unchanged target keeps identity
    expect(merged.get("cell:b")).toHaveLength(2);
  });

  it("returns a new map when a target is removed", () => {
    const prev = new Map([
      ["cell:a", [occ("u1")]],
      ["cell:b", [occ("u2")]],
    ]);
    const next = new Map([["cell:a", [occ("u1")]]]);
    const merged = mergeFocusMap(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.has("cell:b")).toBe(false);
  });

  it("detects a color change on the same user", () => {
    const prev = new Map([["cell:a", [occ("u1", "#111")]]]);
    const next = new Map([["cell:a", [occ("u1", "#999")]]]);
    expect(mergeFocusMap(prev, next)).not.toBe(prev);
  });
});

describe("usePresenceFocusStore.syncPresence", () => {
  it("updates only the slices that changed", () => {
    const setFocus = () => {};
    const map = new Map([["cell:a", [occ("u1")]]]);
    usePresenceFocusStore.getState().syncPresence({
      focusMap: map,
      flashTargetId: null,
      selfUserId: "me",
      setFocus,
    });
    const s1 = usePresenceFocusStore.getState();
    expect(s1.selfUserId).toBe("me");
    expect(s1.setFocus).toBe(setFocus);
    expect(s1.focusMap.get("cell:a")).toHaveLength(1);

    // Re-sync an equal focusMap but a new flash target: focusMap identity must
    // be preserved (no re-render for cells), flashTargetId updates.
    usePresenceFocusStore.getState().syncPresence({
      focusMap: new Map([["cell:a", [occ("u1")]]]),
      flashTargetId: "cell:a",
      selfUserId: "me",
      setFocus,
    });
    const s2 = usePresenceFocusStore.getState();
    expect(s2.focusMap).toBe(s1.focusMap); // preserved identity
    expect(s2.flashTargetId).toBe("cell:a");
  });

  it("reset clears focus and flash", () => {
    usePresenceFocusStore.getState().syncPresence({
      focusMap: new Map([["cell:a", [occ("u1")]]]),
      flashTargetId: "cell:a",
      selfUserId: "me",
      setFocus: () => {},
    });
    usePresenceFocusStore.getState().reset();
    const s = usePresenceFocusStore.getState();
    expect(s.focusMap.size).toBe(0);
    expect(s.flashTargetId).toBeNull();
    expect(s.selfUserId).toBe("");
  });
});
