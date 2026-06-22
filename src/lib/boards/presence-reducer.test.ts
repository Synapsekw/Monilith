import { describe, expect, it } from "vitest";
import { flashDecision, toFocusMap, toRoster } from "./presence-reducer";
import type { PresenceState } from "./presence-types";

const mk = (over: Partial<PresenceState>): PresenceState => ({
  userId: "u1",
  name: "Dani",
  avatarUrl: null,
  color: "#2d9cdb",
  focus: null,
  ...over,
});
const raw = (states: PresenceState[]): Record<string, PresenceState[]> =>
  Object.fromEntries(states.map((s, i) => [`key-${i}`, [s]]));

describe("toRoster", () => {
  it("dedups multiple tabs of one user into a single entry", () => {
    const state = raw([mk({ userId: "u1" }), mk({ userId: "u1" }), mk({ userId: "u2", name: "Sam" })]);
    const roster = toRoster(state, "u2");
    expect(roster).toHaveLength(2);
    expect(roster.find((r) => r.userId === "u2")?.isSelf).toBe(true);
    expect(roster.find((r) => r.userId === "u1")?.isSelf).toBe(false);
  });
});
describe("toFocusMap", () => {
  it("maps targetId -> occupants currently focused there", () => {
    const state = raw([
      mk({ userId: "u1", focus: { viewKind: "table", targetId: "cell:i1:c1" } }),
      mk({ userId: "u2", focus: { viewKind: "table", targetId: "cell:i1:c1" } }),
      mk({ userId: "u3", focus: null }),
    ]);
    const map = toFocusMap(state);
    expect(map.get("cell:i1:c1")?.map((o) => o.userId).sort()).toEqual(["u1", "u2"]);
    expect(map.has("cell:i2:c1")).toBe(false);
  });
});
describe("flashDecision", () => {
  it("flashes only when the incoming change hits the focused target and differs", () => {
    expect(flashDecision({ incomingTargetId: "cell:i1:c1", focusedTargetId: "cell:i1:c1", valueChanged: true })).toBe(true);
  });
  it("does not flash a different target", () => {
    expect(flashDecision({ incomingTargetId: "cell:i1:c2", focusedTargetId: "cell:i1:c1", valueChanged: true })).toBe(false);
  });
  it("does not flash when nothing is focused or value is unchanged", () => {
    expect(flashDecision({ incomingTargetId: "cell:i1:c1", focusedTargetId: null, valueChanged: true })).toBe(false);
    expect(flashDecision({ incomingTargetId: "cell:i1:c1", focusedTargetId: "cell:i1:c1", valueChanged: false })).toBe(false);
  });
});
