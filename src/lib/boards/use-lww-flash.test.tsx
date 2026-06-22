import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLwwFlash } from "./use-lww-flash";
import type { RosterOccupant } from "./presence-types";

const occ = (o: Partial<RosterOccupant>): RosterOccupant => ({
  userId: "u2", name: "Sam", avatarUrl: null, color: "#2d9cdb", isSelf: false, ...o,
});

describe("useLwwFlash", () => {
  it("flashes + attributes when a change hits the self-focused target", () => {
    const presence = {
      selfUserId: "self",
      selfFocusTargetId: "cell:i1:c1",
      focusMap: new Map([["cell:i1:c1", [occ({})]]]),
    };
    const { result } = renderHook(() => useLwwFlash(presence));
    act(() => result.current.onRemoteChange({ targetId: "cell:i1:c1", valueChanged: true }));
    expect(result.current.flashTargetId).toBe("cell:i1:c1");
    expect(result.current.lastMessage?.text).toMatch(/Sam changed this/i);
  });

  it("does not flash an unfocused target", () => {
    const presence = { selfUserId: "self", selfFocusTargetId: "cell:i1:c1", focusMap: new Map() };
    const { result } = renderHook(() => useLwwFlash(presence));
    act(() => result.current.onRemoteChange({ targetId: "cell:i2:c2", valueChanged: true }));
    expect(result.current.flashTargetId).toBeNull();
    expect(result.current.lastMessage).toBeNull();
  });

  it("falls back to a generic message when the changer has left", () => {
    const presence = { selfUserId: "self", selfFocusTargetId: "cell:i1:c1", focusMap: new Map() };
    const { result } = renderHook(() => useLwwFlash(presence));
    act(() => result.current.onRemoteChange({ targetId: "cell:i1:c1", valueChanged: true }));
    expect(result.current.lastMessage?.text).toMatch(/updated just now/i);
  });
});
