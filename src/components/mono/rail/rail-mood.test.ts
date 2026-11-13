import { describe, expect, it } from "vitest";
import { railMood } from "./rail-mood";

describe("railMood", () => {
  it("dozes when asleep, thinks while a turn runs, greets when new", () => {
    expect(railMood({ brain: "none", busy: true, justCreated: true })).toBe(
      "dozing",
    );
    expect(railMood({ brain: "key", busy: true, justCreated: true })).toBe(
      "thinking",
    );
    expect(railMood({ brain: "key", busy: false, justCreated: true })).toBe(
      "hello",
    );
    expect(railMood({ brain: "key", busy: false, justCreated: false })).toBe(
      "idle",
    );
  });
});
