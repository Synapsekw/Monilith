import { beforeEach, describe, expect, it } from "vitest";
import { monoThreadOf, useMyMonoStore } from "./my-mono";

beforeEach(() => useMyMonoStore.setState({ threads: {} }));

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
});
