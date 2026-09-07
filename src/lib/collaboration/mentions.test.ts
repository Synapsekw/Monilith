import { describe, it, expect } from "vitest";
import {
  activeMentionQuery,
  applyMention,
  mentionLabel,
} from "@/lib/collaboration/mentions";

describe("mentions", () => {
  it("detects an @query at the caret", () => {
    expect(activeMentionQuery("hello @ad", 9)).toEqual({
      query: "ad",
      start: 6,
    });
    expect(activeMentionQuery("hello world", 11)).toBeNull();
    expect(activeMentionQuery("a@b @c", 6)).toEqual({ query: "c", start: 4 });
  });
  it("returns null once a space closes the token", () => {
    expect(activeMentionQuery("hi @ad lo", 9)).toBeNull();
  });
  it("inserts a display name for a user target", () => {
    const r = applyMention("hi @ad", 6, {
      kind: "user",
      userId: "u1",
      fullName: "Ada Lovelace",
    });
    expect(r.text).toBe("hi @Ada Lovelace ");
    expect(r.caret).toBe(r.text.length);
  });

  it("inserts a handle for an agent target", () => {
    const r = applyMention("hi @op", 6, {
      kind: "agent",
      agentId: "a1",
      handle: "ops",
      name: "Ops",
    });
    expect(r.text).toBe("hi @ops ");
  });

  it("labels each kind for display", () => {
    expect(mentionLabel({ kind: "user", userId: "u", fullName: null })).toBe(
      "@Someone",
    );
    expect(
      mentionLabel({ kind: "agent", agentId: "a", handle: "ops", name: "Ops" }),
    ).toBe("@ops");
  });
});
