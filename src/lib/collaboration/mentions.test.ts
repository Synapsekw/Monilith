import { describe, it, expect } from "vitest";
import {
  activeMentionQuery,
  applyMention,
  keepOwnMonoMentions,
  mentionLabel,
  type MentionTarget,
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

  it("mentions are people only", () => {
    const t: MentionTarget = {
      kind: "user",
      userId: "u1",
      fullName: "Mira Kovač",
    };
    expect(mentionLabel(t)).toBe("@Mira Kovač");
    expect(mentionLabel({ kind: "user", userId: "u2", fullName: null })).toBe(
      "@Someone",
    );
  });

  it("labels a Mono mention with the Mono's name", () => {
    expect(
      mentionLabel({
        kind: "mono",
        userId: "m1",
        name: "Nova",
        ownerName: "Ada",
        color: "#7395ff",
      }),
    ).toBe("@Nova");
  });

  it("keeps only Mono mentions of the author's own Mono", () => {
    expect(
      keepOwnMonoMentions(
        [
          { kind: "user", userId: "u2" },
          { kind: "mono", userId: "m1" },
          { kind: "mono", userId: "m2" },
        ],
        ["m1"],
      ),
    ).toEqual([
      { kind: "user", userId: "u2" },
      { kind: "mono", userId: "m1" },
    ]);
  });
});
