import { describe, it, expect } from "vitest";
import { activeMentionQuery, applyMention } from "@/lib/collaboration/mentions";

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
  it("applies a chosen member, replacing the @query with @Name", () => {
    const r = applyMention("hi @ad", 6, {
      userId: "u1",
      fullName: "Ada Lovelace",
    });
    expect(r.text).toBe("hi @Ada Lovelace ");
    expect(r.caret).toBe(r.text.length);
  });
});
