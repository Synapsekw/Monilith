import { beforeEach, describe, expect, it } from "vitest";
import {
  boardMembershipKey,
  monoThreadOf,
  peopleIdsOf,
  useMyMonoStore,
} from "./my-mono";

beforeEach(() =>
  useMyMonoStore.setState({ threads: {}, membership: {}, ownMonoId: null }),
);

describe("my-mono store", () => {
  it("starts idle and keeps a thread per Mono", () => {
    expect(monoThreadOf(useMyMonoStore.getState().threads, "m1").status).toBe(
      "idle",
    );
    useMyMonoStore
      .getState()
      .setThread("m1", { status: "ready", conversationId: "c1" });
    const t = monoThreadOf(useMyMonoStore.getState().threads, "m1");
    expect(t).toMatchObject({ status: "ready", conversationId: "c1" });
  });

  it("new chat clears the thread and bumps the chat key", () => {
    const s = useMyMonoStore.getState();
    s.setThread("m1", { status: "ready", conversationId: "c1" });
    s.newChat("m1");
    expect(monoThreadOf(useMyMonoStore.getState().threads, "m1")).toEqual({
      status: "ready",
      conversationId: null,
      messages: [],
      chatKey: 1,
    });
  });

  it("reads user ids from a People cell value", () => {
    expect(peopleIdsOf({ userIds: ["a", "b"] })).toEqual(["a", "b"]);
    expect(peopleIdsOf(null)).toEqual([]);
    expect(peopleIdsOf({ text: "x" })).toEqual([]);
  });

  it("marks the viewer's own Mono on the board when a write newly adds it", () => {
    const s = useMyMonoStore.getState();
    s.setOwnMonoId("m1");
    s.notePeopleWrite("b1", { userIds: ["u1"] }, { userIds: ["u1", "m1"] });
    expect(
      useMyMonoStore.getState().membership[boardMembershipKey("m1", "b1")],
    ).toBe(true);
  });

  it("ignores writes that do not newly add the viewer's own Mono", () => {
    const s = useMyMonoStore.getState();
    // No own Mono known yet.
    s.notePeopleWrite("b1", undefined, { userIds: ["m1"] });
    s.setOwnMonoId("m1");
    // Someone else (a person or another Mono).
    s.notePeopleWrite("b1", undefined, { userIds: ["u2", "m2"] });
    // Already assigned before this write: the board row is not this write's.
    useMyMonoStore
      .getState()
      .setMembership(boardMembershipKey("m1", "b2"), false);
    s.notePeopleWrite("b2", { userIds: ["m1"] }, { userIds: ["m1", "u2"] });
    expect(useMyMonoStore.getState().membership).toEqual({
      [boardMembershipKey("m1", "b2")]: false,
    });
  });
});
